import { forwardRef, type SelectHTMLAttributes } from "react";

import { cn } from "@/utilities/cn";
import { ChevronDownIcon } from "@/components/atoms/icons";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  options: { value: string; label: string }[];
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, className, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "h-8 w-full appearance-none rounded-md border border-slate-300 bg-white pl-2.5 pr-8 text-[13px] text-slate-900 transition-shadow focus:border-accent-9 focus:outline-none focus:ring-3 focus:ring-accent-9/20",
          className,
        )}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500"
      />
    </div>
  );
});
