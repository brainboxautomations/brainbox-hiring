"use client";

import { cn } from "@/utilities/cn";

type ToggleProps = {
  on: boolean;
  onToggle: () => void;
  label: string;
  className?: string;
};

export function Toggle({ on, onToggle, label, className }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      className={cn("flex items-center gap-2.5 text-left", className)}
    >
      <span
        className={cn(
          "relative h-4.75 w-8 shrink-0 rounded-full transition-colors",
          on ? "bg-accent-9" : "bg-slate-300",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3.75 w-3.75 rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,0.2)] transition-[left]",
            on ? "left-3.75" : "left-0.5",
          )}
        />
      </span>
      <span className="text-[13px] text-slate-700">{label}</span>
    </button>
  );
}
