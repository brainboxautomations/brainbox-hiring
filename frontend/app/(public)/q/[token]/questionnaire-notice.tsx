import type { ReactNode } from "react";

import { cn } from "@/utilities/cn";
import { AlertCircle, Check } from "lucide-react";

export type NoticeTone = "success" | "neutral" | "warning";

const TONE_BACKGROUND: Record<NoticeTone, string> = {
  success: "bg-green-50",
  neutral: "bg-slate-100",
  warning: "bg-amber-50",
};

function NoticeIcon({ tone }: { tone: NoticeTone }) {
  if (tone === "success") {
    return <Check size={30} aria-hidden />;
  }

  return <AlertCircle size={30} aria-hidden />;
}

export function QuestionnaireNotice({
  tone,
  title,
  children,
}: {
  tone: NoticeTone;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full items-center justify-center px-8 py-20">
      <div className="w-full max-w-120 rounded-[18px] border border-slate-200 bg-white px-9 py-11 text-center shadow-card">
        <div
          className={cn(
            "mx-auto mb-6 flex h-15 w-15 items-center justify-center rounded-2xl",
            TONE_BACKGROUND[tone],
          )}
        >
          <NoticeIcon tone={tone} />
        </div>
        <h1 className="mb-2.5 text-[26px] font-semibold tracking-[-0.02em] text-slate-900">
          {title}
        </h1>
        <div className="mx-auto max-w-95 text-[15px] leading-relaxed text-slate-500">
          {children}
        </div>
      </div>
    </div>
  );
}
