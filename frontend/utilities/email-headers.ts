import { normalizeEmailAddress } from "@/utilities/email-address";
import { stripQuotedReply } from "@/utilities/quoted-reply";

export type EmailHeaders = Record<string, string>;

const MAX_MESSAGE_ID_LENGTH = 512;
const MAX_REFERENCE_IDS = 32;
const NO_SUBJECT = "(no subject)";
const REPLY_PREFIX = /^\s*(?:re|fw|fwd|aw|antw|sv|vs|res|rif)\s*(?:\[\d+\])?\s*:\s*/i;

export function headerValue(headers: EmailHeaders | null | undefined, name: string): string | null {
  if (!headers) return null;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const stripped = raw.trim().replace(/^</, "").replace(/>$/, "").trim().toLowerCase();
  if (stripped.length === 0 || stripped.length > MAX_MESSAGE_ID_LENGTH) return null;
  if (!stripped.includes("@")) return null;
  if (/[\s<>]/.test(stripped)) return null;
  return stripped;
}

export function parseMessageIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const bracketed = raw.match(/<[^<>\s]+>/g);
  const tokens = bracketed ?? raw.split(/[\s,]+/);
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const token of tokens) {
    const id = normalizeMessageId(token);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_REFERENCE_IDS) break;
  }

  return ids;
}

export function threadReferenceIds(headers: EmailHeaders | null | undefined): string[] {
  const inReplyTo = parseMessageIds(headerValue(headers, "in-reply-to"));
  const references = parseMessageIds(headerValue(headers, "references")).reverse();

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of [...inReplyTo, ...references]) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

export function normalizeSubject(subject: string | null | undefined): string {
  let working = (subject ?? "").replace(/\s+/g, " ").trim();

  let previous = "";
  while (working !== previous) {
    previous = working;
    working = working.replace(REPLY_PREFIX, "").trim();
  }

  const normalized = working.toLowerCase();
  return normalized.length > 0 ? normalized.slice(0, 400) : NO_SUBJECT;
}

export function replySubject(subject: string | null | undefined): string {
  const trimmed = (subject ?? "").trim();
  if (trimmed.length === 0) return "Re:";
  if (REPLY_PREFIX.test(trimmed)) return trimmed;
  return `Re: ${trimmed}`;
}

export function extractAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const angled = raw.match(/<([^<>]+)>/);
  const candidate = angled?.[1] ?? raw;
  return normalizeEmailAddress(candidate);
}

export function extractDisplayName(raw: string | null | undefined): string {
  if (!raw) return "";
  const angled = raw.match(/^\s*(.*?)\s*<[^<>]+>\s*$/);
  if (!angled?.[1]) return "";
  return angled[1].replace(/^"(.*)"$/, "$1").trim();
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return "";

  const withoutHiddenBlocks = html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const withBreaks = withoutHiddenBlocks
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<(li)\b[^>]*>/gi, "- ");

  return decodeEntities(withBreaks.replace(/<[^>]*>/g, ""))
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function inboundBodyText(input: { text?: string | null; html?: string | null }): string {
  const text = (input.text ?? "").trim();
  if (text.length > 0) {
    return text
      .replace(/\r\n?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return htmlToPlainText(input.html);
}

export function messagePreview(body: string | null | undefined, limit = 180): string {
  const collapsed = stripQuotedReply(body).replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit - 1).trimEnd()}…`;
}
