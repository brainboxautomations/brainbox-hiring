import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { serverEnv } from "@/configurations/env-configuration";

/**
 * Every uploaded file lives in one private Cloudflare R2 bucket per
 * environment. The three folders are the three Supabase Storage buckets the
 * app used before, so a stored path (`documents.storage_path`, an answer's
 * `storagePath`, a message attachment's `path`) still means the same file:
 * `resumes` + `applications/<position>/<file>` is the key
 * `resumes/applications/<position>/<file>`.
 *
 * This is the only module that talks to file storage. R2 speaks the S3 API, so
 * the standard AWS SDK is pointed at it.
 */
export type StorageFolder = "resumes" | "videos" | "message-attachments";

export class MissingObjectStorageError extends Error {
  constructor() {
    super("File storage is not configured (R2_* environment variables are missing)");
    this.name = "MissingObjectStorageError";
  }
}

/** How long an upload URL handed to a browser stays usable. */
export const UPLOAD_URL_TTL_SECONDS = 10 * 60;

/** How long a preview or download link stays usable. */
export const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

/** DeleteObjects takes at most 1000 keys per request. */
const MAX_DELETE_BATCH = 1000;

export function objectKey(folder: StorageFolder, path: string): string {
  if (!path || path.startsWith("/") || path.split("/").includes("..")) {
    throw new Error(`Invalid storage path: ${path}`);
  }
  return `${folder}/${path}`;
}

type Storage = { client: S3Client; bucket: string };

let cached: Storage | null = null;

function storage(): Storage {
  if (cached) return cached;
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = serverEnv();
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new MissingObjectStorageError();
  }
  cached = {
    bucket: R2_BUCKET,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    }),
  };
  return cached;
}

/**
 * A URL the browser can PUT exactly one file to, for a short while.
 *
 * R2 cannot enforce a size or type limit per folder the way Supabase buckets
 * did, so the caller checks both first and they are signed into the URL: an
 * upload with any other Content-Length or Content-Type is refused by R2.
 */
export async function signUpload(
  folder: StorageFolder,
  path: string,
  file: { contentType: string; size: number },
): Promise<string> {
  const { client, bucket } = storage();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey(folder, path),
    ContentType: file.contentType,
    ContentLength: file.size,
  });
  return getSignedUrl(client, command, {
    expiresIn: UPLOAD_URL_TTL_SECONDS,
    signableHeaders: new Set(["content-type", "content-length"]),
  });
}

/** A time-limited link to view or download one file. */
export async function signDownload(
  folder: StorageFolder,
  path: string,
  expiresIn: number = DOWNLOAD_URL_TTL_SECONDS,
): Promise<string> {
  const { client, bucket } = storage();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: objectKey(folder, path) }),
    { expiresIn },
  );
}

/**
 * Stores a file the server already holds. Never overwrites: every path the app
 * writes is unique, so an existing object means something is wrong.
 */
export async function putObject(
  folder: StorageFolder,
  path: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const { client, bucket } = storage();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey(folder, path),
      Body: body,
      ContentType: contentType,
      IfNoneMatch: "*",
    }),
  );
}

export async function getObject(
  folder: StorageFolder,
  path: string,
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const { client, bucket } = storage();
  const result = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: objectKey(folder, path) }),
  );
  if (!result.Body) throw new Error(`Empty object: ${folder}/${path}`);
  return {
    bytes: await result.Body.transformToByteArray(),
    contentType: result.ContentType ?? null,
  };
}

export type StoredObject = {
  /** The path inside the folder, as the database stores it. */
  path: string;
  size: number | null;
  lastModified: Date | null;
};

/** Every object under `prefix` inside a folder, following pagination. */
export async function listObjects(folder: StorageFolder, prefix: string): Promise<StoredObject[]> {
  const { client, bucket } = storage();
  const folderPrefix = `${folder}/`;
  const objects: StoredObject[] = [];
  let continuationToken: string | undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${folderPrefix}${prefix}`,
        ContinuationToken: continuationToken,
      }),
    );
    for (const item of page.Contents ?? []) {
      if (!item.Key) continue;
      objects.push({
        path: item.Key.slice(folderPrefix.length),
        size: item.Size ?? null,
        lastModified: item.LastModified ?? null,
      });
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

/** Deletes files and returns the paths R2 confirms it removed. */
export async function removeObjects(
  folder: StorageFolder,
  paths: string[],
): Promise<{ removed: string[]; error: string | null }> {
  const { client, bucket } = storage();
  const removed: string[] = [];
  let error: string | null = null;

  for (let start = 0; start < paths.length; start += MAX_DELETE_BATCH) {
    const batch = paths.slice(start, start + MAX_DELETE_BATCH);
    try {
      const result = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: batch.map((path) => ({ Key: objectKey(folder, path) })),
            Quiet: false,
          },
        }),
      );
      for (const deleted of result.Deleted ?? []) {
        if (deleted.Key) removed.push(deleted.Key.slice(folder.length + 1));
      }
      if (result.Errors?.length) {
        error = result.Errors.map((e) => `${e.Key}: ${e.Message ?? e.Code}`).join("; ");
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Delete failed";
    }
  }

  return { removed, error };
}
