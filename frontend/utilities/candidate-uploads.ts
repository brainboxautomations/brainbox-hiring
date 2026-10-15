export const MAX_RESUME_BYTES = 15 * 1024 * 1024;

export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export const MAX_APPLY_REQUEST_BYTES = 50 * 1024 * 1024;

const OBJECT_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[a-zA-Z0-9._-]{1,120}$/;

export function applicationStoragePrefix(positionId: string): string {
  return `applications/${positionId}/`;
}

export function applicationStoragePath(positionId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "upload";
  return `${applicationStoragePrefix(positionId)}${crypto.randomUUID()}-${safe}`;
}

export function isApplicationStoragePath(path: string, positionId: string): boolean {
  const prefix = applicationStoragePrefix(positionId);
  if (!path.startsWith(prefix)) return false;
  return OBJECT_NAME.test(path.slice(prefix.length));
}

const FALLBACK_CONTENT_TYPE = "application/octet-stream";

/** The Content-Type a candidate file is stored and signed with. */
export function uploadContentType(reported: string): string {
  return reported.trim() || FALLBACK_CONTENT_TYPE;
}

/**
 * Why a candidate file may not be uploaded, or null when it may.
 *
 * Storage cannot hold a per-folder limit, so these are checked before an
 * upload URL is signed. Resumes and questionnaire file answers share the
 * resumes folder and accept any type (a file answer can be anything); videos
 * must be video.
 */
export function candidateUploadError(
  bucket: "resumes" | "videos",
  file: { contentType: string; size: number },
): string | null {
  if (bucket === "videos") {
    if (!file.contentType.startsWith("video/")) return "Upload a video file.";
    if (file.size > MAX_VIDEO_BYTES) return "That video is too large (50 MB at most).";
    return null;
  }
  if (file.size > MAX_RESUME_BYTES) return "That file is too large (15 MB at most).";
  return null;
}
