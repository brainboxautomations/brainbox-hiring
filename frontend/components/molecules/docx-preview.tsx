"use client";

import { useEffect, useRef, useState } from "react";

import { isSafeDocumentLink } from "@/utilities/resume-preview";

type DocxPreviewProps = {
  url: string;
  className?: string;
};

type Status = "loading" | "ready" | "error";

/** Leaves only links that are safe to click; see `isSafeDocumentLink`. */
function neutraliseLinks(container: HTMLElement) {
  container.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href") ?? "";
    if (!isSafeDocumentLink(href)) {
      link.removeAttribute("href");
      return;
    }
    if (!href.startsWith("#")) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
  });
}

/**
 * Renders a Word .docx in the page. Browsers cannot show one in a frame the
 * way they show a PDF, so the file is fetched and converted to HTML here.
 * The converter is loaded only when a .docx is actually opened.
 */
export function DocxPreview({ url, className }: DocxPreviewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    const body = bodyRef.current;
    const styles = styleRef.current;
    if (!body || !styles) return;

    const controller = new AbortController();
    setStatus("loading");

    (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Download failed: ${response.status}`);
        const blob = await response.blob();
        const { renderAsync } = await import("docx-preview");
        if (controller.signal.aborted) return;

        await renderAsync(blob, body, styles, {
          inWrapper: true,
          ignoreLastRenderedPageBreak: true,
          useBase64URL: true,
          renderComments: false,
        });
        if (controller.signal.aborted) return;

        neutraliseLinks(body);
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    })();

    return () => {
      controller.abort();
      body.replaceChildren();
      styles.replaceChildren();
    };
  }, [url]);

  return (
    <div className={className}>
      {status === "loading" && (
        <div className="p-6 text-center text-xs text-slate-400">Loading preview…</div>
      )}
      {status === "error" && (
        <div className="p-6 text-center text-xs text-slate-400">
          Couldn’t preview this document. Use Download to open it.
        </div>
      )}
      <div ref={styleRef} hidden />
      <div ref={bodyRef} hidden={status !== "ready"} />
    </div>
  );
}
