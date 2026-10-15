"use client";

import { cn } from "@/utilities/cn";

type SegmentedProps<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
};

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex h-8.5 shrink-0 items-center overflow-hidden rounded-md border border-slate-300"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-full items-center px-2.5 text-xs transition-colors",
              index > 0 && "border-l border-slate-200",
              selected ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-50",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
