export type QuotedReplySplit = {
  visible: string;
  quoted: string;
};

const QUOTE_MARKER = ">";
const SEPARATOR_LINE = /^[_-]{5,}$/;
const ORIGINAL_MESSAGE_LINE = /^-{2,}\s*(original|forwarded)\s+message\s*-{2,}$/i;
const BEGIN_FORWARDED_LINE = /^begin forwarded message:$/i;
const DASHED_ATTRIBUTION_LINE = /^-{2,}.*\bwrote\b.*-{2,}$/i;
const ENDS_WITH_WROTE = /\bwrote:$/i;
const STARTS_WITH_ON = /^on\b/i;
const CONTAINS_ADDRESS = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const HEADER_BLOCK_START = /^from:\s*\S/i;
const HEADER_BLOCK_FOLLOWER = /^(to|cc|bcc|sent|date|subject|reply-to):/i;

const ATTRIBUTION_WRAP_LINES = 2;
const HEADER_BLOCK_LOOKAHEAD = 5;
const HEADER_BLOCK_FOLLOWERS_REQUIRED = 2;

function lineAt(lines: string[], index: number): string {
  return (lines[index] ?? "").trim();
}

function isQuotedLine(line: string): boolean {
  return line.startsWith(QUOTE_MARKER);
}

function isSeparatorLine(line: string): boolean {
  return ORIGINAL_MESSAGE_LINE.test(line) || BEGIN_FORWARDED_LINE.test(line);
}

function startsAttribution(lines: string[], index: number): boolean {
  const first = lineAt(lines, index);
  if (first.length === 0) return false;
  if (DASHED_ATTRIBUTION_LINE.test(first)) return true;
  if (!STARTS_WITH_ON.test(first) && !CONTAINS_ADDRESS.test(first)) return false;

  let joined = first;
  for (let ahead = 0; ahead <= ATTRIBUTION_WRAP_LINES; ahead += 1) {
    if (ahead > 0) {
      const next = lineAt(lines, index + ahead);
      if (next.length === 0) return false;
      joined = `${joined} ${next}`;
    }
    if (ENDS_WITH_WROTE.test(joined)) return true;
  }

  return false;
}

function startsHeaderBlock(lines: string[], index: number): boolean {
  if (!HEADER_BLOCK_START.test(lineAt(lines, index))) return false;

  let followers = 0;
  for (let ahead = 1; ahead <= HEADER_BLOCK_LOOKAHEAD; ahead += 1) {
    const line = lineAt(lines, index + ahead);
    if (line.length === 0) continue;
    if (!HEADER_BLOCK_FOLLOWER.test(line)) return false;
    followers += 1;
    if (followers >= HEADER_BLOCK_FOLLOWERS_REQUIRED) return true;
  }

  return false;
}

function quoteBoundaryIndex(lines: string[]): number {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lineAt(lines, index);
    if (line.length === 0) continue;

    if (isQuotedLine(line)) return index;
    if (isSeparatorLine(line)) return index;
    if (startsAttribution(lines, index)) return index;
    if (startsHeaderBlock(lines, index)) return index;
  }

  return -1;
}

function withoutTrailingNoise(lines: string[]): string[] {
  const kept = lines.slice();
  while (kept.length > 0) {
    const last = (kept[kept.length - 1] ?? "").trim();
    if (last.length > 0 && !SEPARATOR_LINE.test(last)) break;
    kept.pop();
  }
  return kept;
}

export function splitQuotedReply(body: string | null | undefined): QuotedReplySplit {
  const normalized = (body ?? "").replace(/\r\n?/g, "\n");
  const whole = { visible: normalized.trim(), quoted: "" };
  if (whole.visible.length === 0) return { visible: "", quoted: "" };

  const lines = normalized.split("\n");
  const boundary = quoteBoundaryIndex(lines);
  if (boundary < 0) return whole;

  const visible = withoutTrailingNoise(lines.slice(0, boundary))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (visible.length === 0) return whole;

  return { visible, quoted: lines.slice(boundary).join("\n").trim() };
}

export function stripQuotedReply(body: string | null | undefined): string {
  return splitQuotedReply(body).visible;
}
