"use client";

import { useRef, useState } from "react";

import { FloatingMenu } from "@/components/molecules/floating-menu";
import { cn } from "@/utilities/cn";
import { formatReportMonth } from "@/utilities/report-month";
import { Calendar, ChevronDown } from "lucide-react";

export type MonthFilterProps = {
  label: string;
  selectedMonth: string | null;
  months: string[];
  onSelect: (month: string) => void;
};

export function MonthFilter({ label, selectedMonth, months, onSelect }: MonthFilterProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="flex h-9 items-center gap-[9px] rounded-lg border border-slate-300 bg-white px-[13px] transition-colors hover:bg-slate-50"
      >
        <span className="text-slate-500">
          <Calendar size={15} aria-hidden="true" />
        </span>
        <span className="text-[13px] font-medium text-slate-700">{label}</span>
        <span className="text-slate-500">
          <ChevronDown size={13} aria-hidden="true" />
        </span>
      </button>

      <FloatingMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} align="end">
        <div
          role="listbox"
          className="max-h-[280px] w-[180px] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-popover"
        >
          {months.length === 0 ? (
            <div className="px-[9px] py-2 text-[13px] text-slate-400">No months yet</div>
          ) : (
            months.map((month) => (
              <button
                key={month}
                type="button"
                role="option"
                aria-selected={month === selectedMonth}
                onClick={() => {
                  onSelect(month);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center rounded-md px-[9px] py-2 text-left text-[13px] transition-colors hover:bg-slate-100",
                  month === selectedMonth ? "text-accent-11" : "text-slate-700",
                )}
              >
                {formatReportMonth(month)}
              </button>
            ))
          )}
        </div>
      </FloatingMenu>
    </div>
  );
}
