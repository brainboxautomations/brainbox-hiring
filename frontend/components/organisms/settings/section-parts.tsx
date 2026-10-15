import type { ReactNode } from "react";

import { cn } from "@/utilities/cn";
import { AlertCircle } from "lucide-react";

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-[22px] flex items-end justify-between gap-4">
      <div>
        <h1 className="mb-1 text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
        <p className="text-[13px] text-slate-500">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function InfoIcon() {
  return (
    <AlertCircle size={14} className="mt-px flex-shrink-0 text-slate-500" aria-hidden="true" />
  );
}

export function InfoNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-[9px] rounded-[9px] border border-slate-100 bg-slate-50 px-[13px] py-[11px]",
        className,
      )}
    >
      <InfoIcon />
      <span className="text-xs leading-relaxed text-slate-500">{children}</span>
    </div>
  );
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-11 animate-pulse rounded-lg bg-slate-100" />
      ))}
    </div>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-9 text-center">
      <div className="text-[13px] font-semibold text-slate-700">{title}</div>
      <p className="mx-auto mt-1 max-w-[380px] text-xs leading-relaxed text-slate-500">{message}</p>
    </div>
  );
}

export function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-slate-100 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="w-[160px] flex-shrink-0 text-xs font-medium text-slate-500">{label}</div>
      <div className="min-w-0 flex-1 break-words font-mono text-[13px] text-slate-900">{value}</div>
    </div>
  );
}
