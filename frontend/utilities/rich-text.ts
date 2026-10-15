import { escapeHtml } from "@/utilities/merge-variables";

const ALLOWED_SCHEMES = /^(https?|mailto):/i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BARE_DOMAIN = /^[\w-]+(\.[\w-]+)+(\/[^\s]*)?$/;

export function safeLinkUrl(url: string): string | null {
  const trimmed = url.trim().replace(/&amp;/g, "&");
  if (!trimmed) return null;
  if (/[\s<>"'`]/.test(trimmed)) return null;
  if (trimmed.startsWith("//")) return null;
  if (ALLOWED_SCHEMES.test(trimmed)) return trimmed;
  if (ANY_SCHEME.test(trimmed)) return null;
  if (BARE_DOMAIN.test(trimmed)) return `https://${trimmed}`;
  return null;
}

function renderInline(escapedLine: string): string {
  return escapedLine
    .replace(
      /\[([^\]\n]+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/g,
      (match, label: string, url: string) => {
        const href = safeLinkUrl(url);
        if (!href) return label;
        return `<a href="${escapeHtml(href)}">${label}</a>`;
      },
    )
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<u>$1</u>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
}

type Block = { kind: "heading" | "list" | "paragraph"; lines: string[] };

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];

  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    const previous = blocks[blocks.length - 1];

    if (line.trim().length === 0) {
      if (previous) blocks.push({ kind: "paragraph", lines: [] });
      continue;
    }

    if (line.startsWith("## ")) {
      blocks.push({ kind: "heading", lines: [line.slice(3).trim()] });
      continue;
    }

    if (line.startsWith("- ")) {
      if (previous?.kind === "list") previous.lines.push(line.slice(2).trim());
      else blocks.push({ kind: "list", lines: [line.slice(2).trim()] });
      continue;
    }

    if (previous?.kind === "paragraph" && previous.lines.length > 0) previous.lines.push(line);
    else blocks.push({ kind: "paragraph", lines: [line] });
  }

  return blocks.filter((block) => block.lines.length > 0);
}

export function richTextToHtml(text: string | null | undefined): string {
  if (!text || text.trim().length === 0) return "";

  const rendered = toBlocks(text)
    .map((block) => {
      const lines = block.lines.map((line) => renderInline(escapeHtml(line)));
      if (block.kind === "heading") return `<h2>${lines[0]}</h2>`;
      if (block.kind === "list") return `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>`;
      return `<p>${lines.join("<br />")}</p>`;
    })
    .join("");

  return rendered;
}

export function richTextToPlainText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^## /gm, "")
    .replace(
      /\[([^\]\n]+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/g,
      (match, label: string, url: string) => {
        const href = safeLinkUrl(url);
        return href ? `${label} (${href})` : label;
      },
    )
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2")
    .trim();
}

export const RICH_TEXT_MARKS = {
  bold: { before: "**", after: "**" },
  italic: { before: "*", after: "*" },
  underline: { before: "__", after: "__" },
  heading: { before: "## ", after: "" },
  list: { before: "- ", after: "" },
  link: { before: "[", after: "](https://)" },
} as const;

export type RichTextMark = keyof typeof RICH_TEXT_MARKS;

export function applyRichTextMark(
  value: string,
  mark: RichTextMark,
  selectionStart: number,
  selectionEnd: number,
): { value: string; selectionStart: number; selectionEnd: number } {
  const { before, after } = RICH_TEXT_MARKS[mark];
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));

  if (mark === "heading" || mark === "list") {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const next = `${value.slice(0, lineStart)}${before}${value.slice(lineStart)}`;
    return {
      value: next,
      selectionStart: start + before.length,
      selectionEnd: end + before.length,
    };
  }

  const selected = value.slice(start, end);
  const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
  return {
    value: next,
    selectionStart: start + before.length,
    selectionEnd: start + before.length + selected.length,
  };
}
