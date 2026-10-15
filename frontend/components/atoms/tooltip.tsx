"use client";

import type { ReactNode } from "react";

import { cn } from "@/utilities/cn";

type TooltipSide = "top" | "bottom" | "left" | "right";

type TooltipProps = {
  label: ReactNode;
  children: ReactNode;
  side?: TooltipSide;
  multiline?: boolean;
  className?: string;
};

const SIDE_CLASS: Record<TooltipSide, string> = {
  top: "bottom-full left-1/2 mb-1.5 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-1.5 -translate-x-1/2",
  left: "right-full top-1/2 mr-1.5 -translate-y-1/2",
  right: "left-full top-1/2 ml-1.5 -translate-y-1/2",
};

export function Tooltip({ label, children, side = "top", multiline, className }: TooltipProps) {
  return (
    <span className={cn("group/tooltip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity delay-300 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100",
          multiline ? "w-48 whitespace-normal leading-relaxed" : "whitespace-nowrap",
          SIDE_CLASS[side],
        )}
      >
        {label}
      </span>
    </span>
  );
}
