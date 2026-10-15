"use client";

import { DATE_WINDOW_OPTIONS, type DateWindow } from "@/utilities/candidate-filters";

export type DateWindowFilterProps = {
  legend: string;
  name: string;
  value: DateWindow;
  onChange: (value: DateWindow) => void;
};

export function DateWindowFilter({ legend, name, value, onChange }: DateWindowFilterProps) {
  return (
    <fieldset className="mb-4">
      <legend className="mb-2 text-[11px] font-semibold text-slate-600">{legend}</legend>
      <div className="flex flex-col gap-px">
        {DATE_WINDOW_OPTIONS.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-slate-50"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="h-3.5 w-3.5 shrink-0 appearance-none rounded-full border-[1.5px] border-slate-300 checked:border-accent-9 checked:bg-accent-9 checked:shadow-[inset_0_0_0_2.5px_white]"
            />
            <span className="text-xs text-slate-700">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
