import type { StorageFolder, StoredObject } from "@/configurations/object-storage";

/**
 * In-memory stand-in for Cloudflare R2, mocked at the module boundary the same
 * way the email transport is. L3 runs against a real Supabase database but has
 * no R2 credentials, and tests should not leave files in a real bucket.
 */
const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

const key = (folder: StorageFolder, path: string) => `${folder}/${path}`;

/** What a test stored, or undefined. */
export function storedObject(folder: StorageFolder, path: string) {
  return objects.get(key(folder, path));
}

export const fakeObjectStorage = {
  MissingObjectStorageError: class MissingObjectStorageError extends Error {},
  UPLOAD_URL_TTL_SECONDS: 600,
  DOWNLOAD_URL_TTL_SECONDS: 3600,
  objectKey: key,
  signUpload: async (folder: StorageFolder, path: string) =>
    `https://r2.l3.invalid/${key(folder, path)}?signature=upload`,
  signDownload: async (folder: StorageFolder, path: string) =>
    `https://r2.l3.invalid/${key(folder, path)}?signature=download`,
  putObject: async (
    folder: StorageFolder,
    path: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> => {
    if (objects.has(key(folder, path))) throw new Error("PreconditionFailed");
    objects.set(key(folder, path), { bytes: new Uint8Array(bytes), contentType });
  },
  getObject: async (folder: StorageFolder, path: string) => {
    const object = objects.get(key(folder, path));
    if (!object) throw new Error("NoSuchKey");
    return { bytes: object.bytes, contentType: object.contentType };
  },
  listObjects: async (folder: StorageFolder, prefix: string): Promise<StoredObject[]> =>
    [...objects.entries()]
      .filter(([k]) => k.startsWith(`${folder}/${prefix}`))
      .map(([k, v]) => ({
        path: k.slice(folder.length + 1),
        size: v.bytes.byteLength,
        lastModified: new Date(),
      })),
  removeObjects: async (folder: StorageFolder, paths: string[]) => {
    const removed = paths.filter((path) => objects.delete(key(folder, path)));
    return { removed, error: null };
  },
};
