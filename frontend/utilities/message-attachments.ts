export const MESSAGE_ATTACHMENT_BUCKET = "message-attachments";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_COUNT = 10;
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const MAX_FILENAME_LENGTH = 120;

export function safeAttachmentFilename(filename: string): string {
  const leaf = filename.split(/[/\\]/).pop() ?? "";
  const normalized = leaf.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-MAX_FILENAME_LENGTH);
  const stripped = normalized.replace(/^[._]+/, "");
  return stripped || "attachment";
}

export function messageAttachmentPath(userId: string, filename: string): string {
  return `outbound/${userId}/${crypto.randomUUID()}-${safeAttachmentFilename(filename)}`;
}

export const MAX_INBOUND_ATTACHMENT_COUNT = 20;
export const MAX_INBOUND_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export function inboundAttachmentPath(emailId: string, filename: string): string {
  return `inbound/${safeAttachmentFilename(emailId)}/${crypto.randomUUID()}-${safeAttachmentFilename(filename)}`;
}

const UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rendered = unit === 0 || value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rendered} ${UNITS[unit]}`;
}
