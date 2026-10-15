"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/utilities/cn";
import { useVideoRecorder } from "@/hooks/use-video-recorder";

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type VideoRecorderProps = {
  maxDurationSeconds?: number | null;

  onComplete: (file: File) => void;
  className?: string;
};

export function VideoRecorder({ maxDurationSeconds, onComplete, className }: VideoRecorderProps) {
  const { supported, status, elapsed, error, result, streamRef, start, stop } = useVideoRecorder({
    maxDurationSeconds,
  });

  const liveRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = liveRef.current;
    if (!el) return;
    if (status === "recording" || status === "ready") {
      el.srcObject = streamRef.current;
      void el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [status, streamRef]);

  // One delivery per recording, latched on the result itself.
  //
  // `onComplete` is an inline arrow in the parent, so its identity changes on
  // every keystroke anywhere in the application form. With it in the dep array
  // this effect re-fired while `result` was unchanged, handing the same
  // recording to the uploader again and again: each pass created a fresh object
  // URL, and the cleanup that ran for the superseded one revoked a URL the
  // preview `<video>` was still playing. That is why a recording so often would
  // not replay. Each pass also re-uploaded the clip to storage under a new path.
  const deliveredRef = useRef<typeof result | null>(null);
  useEffect(() => {
    if (!result || deliveredRef.current === result) return;
    deliveredRef.current = result;

    const file = new File([result.blob], `recording.${result.extension}`, {
      type: result.mimeType,
    });
    onComplete(file);
  }, [result, onComplete]);

  if (!supported) {
    return (
      <div
        className={cn(
          "rounded-xl border border-slate-200 bg-slate-50 p-4 text-[13px] text-slate-500",
          className,
        )}
      >
        Recording isn&apos;t available in this browser. Upload a video file or paste a link instead.
      </div>
    );
  }

  const remaining = maxDurationSeconds ? Math.max(0, maxDurationSeconds - elapsed) : null;

  return (
    <div className={cn("overflow-hidden rounded-xl border border-slate-300", className)}>
      <div className="relative aspect-video bg-slate-900">
        <video ref={liveRef} muted playsInline className="h-full w-full object-cover" />

        {status === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/70">
            <span className="flex h-13 w-13 items-center justify-center rounded-full bg-white/[0.14]">
              <span className="h-4 w-4 rounded-full bg-red-500" />
            </span>
            <span className="px-4 text-center text-xs">Record a short intro from your camera</span>
          </div>
        )}

        {status === "requesting" && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-white/70">
            Waiting for camera permission…
          </div>
        )}

        {status === "recording" && (
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-slate-900/70 px-2.5 py-1">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            <span className="font-mono text-[11px] tabular-nums text-white">
              {formatClock(elapsed)}
              {remaining !== null && ` / ${formatClock(maxDurationSeconds ?? 0)}`}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 bg-white px-3.5 py-2.5">
        <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
          {error ? (
            <span className="text-red-600">{error.message}</span>
          ) : maxDurationSeconds ? (
            `Max ${Math.round(maxDurationSeconds / 60)} min`
          ) : (
            "Short clip"
          )}
        </span>

        <div className="flex shrink-0 items-center gap-2">
          {status === "recording" ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              Stop recording
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void start()}
              disabled={status === "requesting"}
              className="rounded-lg bg-accent-9 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-10 disabled:opacity-60"
            >
              {status === "requesting" ? "Starting…" : "Start recording"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
