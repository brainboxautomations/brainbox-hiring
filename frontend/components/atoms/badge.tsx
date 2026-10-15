import type { ReactNode } from "react";

import { cn } from "@/utilities/cn";

export type BadgeTone = "accent" | "green" | "amber" | "red" | "neutral";

type BadgeProps = {
  tone?: BadgeTone;
  dot?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
};

const toneStyles: Record<BadgeTone, { bg: string; text: string; dot: string }> = {
  accent: { bg: "bg-accent-3", text: "text-accent-10", dot: "bg-accent-9" },
  green: { bg: "bg-green-50", text: "text-green-700", dot: "bg-green-600" },
  amber: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-600" },
  red: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-600" },
  neutral: { bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400" },
};

export function Badge({ tone = "neutral", dot = false, icon, children, className }: BadgeProps) {
  const styles = toneStyles[tone];
  return (
    <span
      className={cn(
        "inline-flex h-5.5 items-center gap-1.5 rounded-full px-2.25 text-xs font-medium",
        styles.bg,
        styles.text,
        className,
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", styles.dot)} />}
      {icon}
      {children}
    </span>
  );
}
