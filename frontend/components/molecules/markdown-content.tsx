"use client";

import "@uiw/react-markdown-preview/markdown.css";

import MarkdownPreview from "@uiw/react-markdown-preview";

import { cn } from "@/utilities/cn";

type MarkdownContentProps = {
  content: string;
  className?: string;
};

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <MarkdownPreview
      source={content}
      wrapperElement={{ "data-color-mode": "light" }}
      className={cn("markdown-content-preview", className)}
      style={{
        backgroundColor: "transparent",
        fontSize: "15px",
        lineHeight: 1.75,
        color: "var(--color-slate-700)",
      }}
    />
  );
}
