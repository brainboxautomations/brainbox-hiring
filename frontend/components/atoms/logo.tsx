import { Instrument_Sans } from "next/font/google";

import { cn } from "@/utilities/cn";

// The company site's wordmark is set in Instrument Sans; only the weight it
// uses is loaded.
const instrumentSans = Instrument_Sans({ subsets: ["latin"], weight: ["600"], display: "swap" });

type LogoProps = {
  /** Font size of "brainbox" in px; "AUTOMATIONS" scales with it. */
  size?: number;
  showTag?: boolean;
  variant?: "default" | "onDark";
  className?: string;
};

/**
 * The Brainbox product wordmark:
 * "brainbox" in lowercase over a small, widely spaced "AUTOMATIONS" in blue.
 */
export function Logo({ size = 22, showTag = false, variant = "default", className }: LogoProps) {
  const onDark = variant === "onDark";

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className={cn(instrumentSans.className, "flex flex-col font-semibold leading-none")}>
        <span
          className={cn("lowercase tracking-tight", onDark ? "text-white" : "text-gray-900")}
          style={{ fontSize: size }}
        >
          brainbox
        </span>
        <span
          className={cn("uppercase tracking-[0.3em]", onDark ? "text-blue-400" : "text-blue-600")}
          style={{ fontSize: Math.max(7, Math.round(size * 0.45)), marginTop: size * 0.09 }}
        >
          automations
        </span>
      </span>
      {showTag && (
        <span className="rounded-sm border border-slate-200 px-1.5 py-0.5 font-mono text-[11px] text-slate-400">
          ATS
        </span>
      )}
    </span>
  );
}
