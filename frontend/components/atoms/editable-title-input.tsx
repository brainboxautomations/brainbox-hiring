"use client";

import { cn } from "@/utilities/cn";
import { Pencil } from "lucide-react";

function PencilIcon({ size = 13 }: { size?: number }) {
  return <Pencil size={size} aria-hidden="true" />;
}

type EditableTitleInputProps = {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  inputClassName?: string;
  wrapperClassName?: string;
};

export function EditableTitleInput({
  value,
  onChange,
  ariaLabel,
  placeholder,
  inputClassName,
  wrapperClassName,
}: EditableTitleInputProps) {
  return (
    <div className={cn("group relative flex items-center", wrapperClassName)}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn(
          "cursor-text rounded-md border border-slate-200 bg-transparent py-1 pl-2 pr-6 font-semibold tracking-[-0.01em] text-slate-900 outline-none transition-colors placeholder:text-slate-400 hover:border-slate-300 hover:bg-slate-50 focus:border-accent-9 focus:bg-white focus:ring-2 focus:ring-accent-9/15",
          inputClassName,
        )}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 transition-colors group-focus-within:text-accent-9 group-hover:text-slate-400">
        <PencilIcon size={13} />
      </span>
    </div>
  );
}
