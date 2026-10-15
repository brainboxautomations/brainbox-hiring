/**
 * How the Resume tab can show a file. Browsers render PDFs and images in a
 * frame themselves; a Word .docx has to be converted in the page, and anything
 * else (an old binary .doc, for one) cannot be previewed at all, only
 * downloaded. Pointing a frame at those just made the browser download them.
 */
export type ResumePreviewKind = "pdf" | "image" | "docx" | "none";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function extensionOf(filename: string | null): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename ?? "");
  return match ? match[1]!.toLowerCase() : "";
}

export function resumePreviewKind(
  mimeType: string | null,
  filename: string | null,
): ResumePreviewKind {
  const mime = (mimeType ?? "").toLowerCase();
  const extension = extensionOf(filename);

  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (mime === DOCX_MIME || extension === "docx") return "docx";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp"].includes(extension)) {
    return "image";
  }
  return "none";
}

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Whether a link inside a candidate's document may stay clickable. The file is
 * candidate-supplied and the converter copies its hyperlinks as they are, so a
 * `javascript:` link would otherwise run in a recruiter's signed-in session.
 * Links within the document ("#section") are kept.
 */
export function isSafeDocumentLink(href: string): boolean {
  const value = href.trim();
  if (value.startsWith("#")) return true;
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}
