"use client";

import { Tooltip } from "@/components/atoms/tooltip";
import { cn } from "@/utilities/cn";
import { AlarmClock } from "lucide-react";

export function ScheduleIcon({ size = 15 }: { size?: number }) {
  return <AlarmClock size={size} aria-hidden="true" />;
}

export function ScheduleSendToggle({
  scheduled,
  onToggle,
  compact = false,
}: {
  scheduled: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  return (
    <Tooltip label="Schedule send">
      <button
        type="button"
        onClick={onToggle}
        aria-label="Schedule send"
        aria-pressed={scheduled}
        className={cn(
          "flex items-center justify-center rounded-lg border transition-colors",
          compact ? "h-7.5 w-7.5" : "h-9 w-9",
          scheduled
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
        )}
      >
        <ScheduleIcon size={compact ? 13 : 15} />
      </button>
    </Tooltip>
  );
}

export function ScheduleSendPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.75 py-1.75 text-xs text-amber-800">
      <label htmlFor={id} className="text-amber-800">
        Send at
      </label>
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-amber-300 bg-white px-1.5 py-0.5 text-xs text-amber-900 outline-none"
      />
    </div>
  );
}
