import type { PublicUploadTicket } from "@/schemas/public-upload-schema";

export type CandidateBucket = "resumes" | "videos";

/** Which form a file belongs to: the apply form, or a hosted questionnaire. */
export type UploadScope = { positionId: string } | { questionnaireToken: string };

export type CandidateUploadResult = { storagePath: string } | { error: string };

/**
 * Puts a candidate's file into storage from the browser.
 *
 * The server first issues a one-time upload URL (`/api/public-uploads`) after
 * checking the form is open, the visitor is under the upload rate limit and the
 * file is within its size and type limits, and chooses the object path. The
 * bytes then go straight to storage (Cloudflare R2) with a PUT to that URL, so
 * a large file never passes through the app. The URL is signed for this file's
 * exact size and type, so R2 refuses anything else.
 */
export async function uploadCandidateFile(
  bucket: CandidateBucket,
  scope: UploadScope,
  file: File,
): Promise<CandidateUploadResult> {
  try {
    const response = await fetch("/api/public-uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket,
        filename: file.name,
        contentType: file.type,
        size: file.size,
        ...scope,
      }),
    });
    const ticket = (await response.json().catch(() => null)) as
      | (PublicUploadTicket & { error?: string })
      | null;
    if (!response.ok || !ticket?.uploadUrl) {
      return { error: ticket?.error ?? "Upload failed. Please try again." };
    }

    const upload = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": ticket.contentType },
      body: file,
    });
    return upload.ok
      ? { storagePath: ticket.storagePath }
      : { error: `Upload failed (${upload.status}). Please try again.` };
  } catch {
    // A dropped connection throws rather than returning an error.
    return { error: "Upload failed. Check your connection and try again." };
  }
}
