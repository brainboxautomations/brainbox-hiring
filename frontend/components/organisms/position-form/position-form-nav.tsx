"use client";

import { cn } from "@/utilities/cn";
import { CheckIcon } from "@/components/atoms/icons";
import type { PositionFormStep, PositionFormStepKey } from "./position-form-steps";

type PositionFormNavProps = {
  steps: PositionFormStep[];
  current: PositionFormStepKey;
  onSelect: (key: PositionFormStepKey) => void;
  completedBefore?: number;
};

export function PositionFormNav({
  steps,
  current,
  onSelect,
  completedBefore = -1,
}: PositionFormNavProps) {
  return (
    <nav aria-label="Position sections" className="mb-7 flex items-center">
      {steps.map((step, index) => {
        const isCurrent = step.key === current;
        const isComplete = index < completedBefore;
        return (
          <div key={step.key} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              aria-label={step.name}
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => onSelect(step.key)}
              className="flex items-center gap-2.5 text-left"
            >
              <span
                className={cn(
                  "flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full border-[1.5px] font-mono text-[11px] font-semibold",
                  isComplete && "border-accent-9 bg-accent-9 text-white",
                  isCurrent && "border-accent-9 bg-accent-3 text-accent-11",
                  !isComplete && !isCurrent && "border-slate-300 bg-white text-slate-400",
                )}
              >
                {isComplete ? <CheckIcon size={12} /> : index + 1}
              </span>
              <span
                className={cn(
                  "hidden text-[13px] font-medium sm:block",
                  isCurrent ? "text-accent-11" : isComplete ? "text-slate-900" : "text-slate-500",
                )}
              >
                {step.name}
              </span>
            </button>
            {index < steps.length - 1 && (
              <span
                className={cn("mx-3 h-px flex-1", isComplete ? "bg-accent-9" : "bg-slate-200")}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
