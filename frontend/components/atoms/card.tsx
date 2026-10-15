import type { ReactNode } from "react";

import { cn } from "@/utilities/cn";

export function Card({
  children,
  className,
  elevated = false,
}: {
  children: ReactNode;
  className?: string;
  elevated?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white",
        elevated && "shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("font-mono text-[11px] uppercase tracking-[0.08em] text-slate-400", className)}
    >
      {children}
    </div>
  );
}
