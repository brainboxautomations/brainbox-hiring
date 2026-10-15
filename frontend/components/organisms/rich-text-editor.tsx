"use client";

import {
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";

import { cn } from "@/utilities/cn";
import { applyRichTextMark, type RichTextMark } from "@/utilities/rich-text";

type ToolbarButton = {
  mark: RichTextMark;
  label: string;
  title: string;
  weight: number;
  italic?: boolean;
};

const TOOLBAR: ToolbarButton[] = [
  { mark: "bold", label: "B", title: "Bold", weight: 700 },
  { mark: "italic", label: "i", title: "Italic", weight: 500, italic: true },
  { mark: "underline", label: "U", title: "Underline", weight: 500 },
  { mark: "heading", label: "H2", title: "Heading", weight: 600 },
  { mark: "list", label: "• List", title: "Bulleted list", weight: 450 },
  { mark: "link", label: "Link", title: "Link", weight: 450 },
];

/**
 * Lets the surrounding screen insert text where the caret is.
 *
 * The editor owns its textarea, so a caller rendering its own control beside
 * the toolbar — the merge-variable menu, say — has no way to reach the
 * selection. Without this the templates screen could only append to the end of
 * the body, while the compose screen, whose textarea is its own, inserted at
 * the cursor. Same menu, two different behaviours.
 */
export type RichTextEditorHandle = {
  insertAtCursor: (text: string) => void;
};

type RichTextEditorProps = {
  value: string;
  handleRef?: Ref<RichTextEditorHandle>;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  toolbarExtra?: ReactNode;
  minHeightClassName?: string;
};

export function RichTextEditor({
  value,
  handleRef,
  onChange,
  ariaLabel,
  placeholder,
  className,
  toolbarExtra,
  minHeightClassName = "min-h-60",
}: RichTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(
    handleRef,
    () => ({
      insertAtCursor: (text: string) => {
        const textarea = textareaRef.current;
        const start = textarea?.selectionStart ?? value.length;
        const end = textarea?.selectionEnd ?? value.length;
        onChange(`${value.slice(0, start)}${text}${value.slice(end)}`);

        // Leave the caret after what was inserted, so typing continues where
        // the user was rather than jumping to the end.
        const caret = start + text.length;
        requestAnimationFrame(() => {
          textarea?.focus();
          textarea?.setSelectionRange(caret, caret);
        });
      },
    }),
    [onChange, value],
  );

  // The Link button used to drop a bare `[](https://)` into the body and leave
  // the user to type the label and the URL into the right halves of it by hand.
  // The renderer has always supported `[label](url)`, so the only thing missing
  // was somewhere to say what the link should read as.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const linkSelectionRef = useRef<{ start: number; end: number } | null>(null);

  const openLinkDialog = useCallback(() => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    linkSelectionRef.current = { start, end };
    // Selected text becomes the display text, so highlighting a word and
    // clicking Link only asks for the address.
    setLinkText(value.slice(start, end));
    setLinkUrl("");
    setLinkOpen(true);
  }, [value]);

  const confirmLink = useCallback(() => {
    const url = linkUrl.trim();
    if (!url) return;
    const label = linkText.trim() || url;
    const { start, end } = linkSelectionRef.current ?? { start: value.length, end: value.length };
    const snippet = `[${label}](${url})`;

    onChange(`${value.slice(0, start)}${snippet}${value.slice(end)}`);
    setLinkOpen(false);

    const caret = start + snippet.length;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  }, [linkText, linkUrl, onChange, value]);

  const applyMark = useCallback(
    (mark: RichTextMark) => {
      const textarea = textareaRef.current;
      const start = textarea?.selectionStart ?? value.length;
      const end = textarea?.selectionEnd ?? value.length;
      const next = applyRichTextMark(value, mark, start, end);
      onChange(next.value);
      requestAnimationFrame(() => {
        textarea?.focus();
        textarea?.setSelectionRange(next.selectionStart, next.selectionEnd);
      });
    },
    [onChange, value],
  );

  return (
    <div className={cn("overflow-hidden rounded-[9px] border border-slate-300", className)}>
      <div className="flex h-9.5 items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-2">
        {TOOLBAR.map((tool) => (
          <button
            key={tool.mark}
            type="button"
            title={tool.title}
            aria-label={tool.title}
            onClick={() => (tool.mark === "link" ? openLinkDialog() : applyMark(tool.mark))}
            className="flex h-6.5 min-w-7 items-center justify-center rounded-[5px] px-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-200"
            style={{ fontWeight: tool.weight, fontStyle: tool.italic ? "italic" : "normal" }}
          >
            {tool.label}
          </button>
        ))}
        <div className="flex-1" />
        {toolbarExtra}
      </div>

      {linkOpen && (
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[11px] font-medium text-slate-600">Text to show</span>
            <input
              autoFocus
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              placeholder="Book a time"
              className="h-8 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[13px] text-slate-700 outline-none focus:border-accent-9"
            />
          </label>
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[11px] font-medium text-slate-600">Link address</span>
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmLink();
                }
                if (e.key === "Escape") setLinkOpen(false);
              }}
              placeholder="https://"
              className="h-8 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[13px] text-slate-700 outline-none focus:border-accent-9"
            />
          </label>
          <button
            type="button"
            onClick={confirmLink}
            disabled={!linkUrl.trim()}
            className="h-8 rounded-md bg-slate-900 px-3 text-[12px] font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-40"
          >
            Add link
          </button>
          <button
            type="button"
            onClick={() => setLinkOpen(false)}
            className="h-8 px-2 text-[12px] text-slate-500 transition-colors hover:text-slate-700"
          >
            Cancel
          </button>
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn(
          "w-full resize-y border-none p-3.5 text-[13px] leading-[1.65] text-slate-700 outline-none placeholder:text-slate-400",
          minHeightClassName,
        )}
      />
    </div>
  );
}
