"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";

import { useNow } from "@/hooks/use-now";
import { useCancelScheduledAction, useRunScheduledActionNow } from "@/hooks/use-scheduled-actions";
import type { UpcomingAutomation } from "@/types/api";
import { apiErrorMessage } from "@/utilities/api-error";
import { messageTimestamp } from "@/utilities/relative-time";

const BUTTON =
  "inline-flex h-5 items-center whitespace-nowrap rounded-md px-1.5 text-[10px] font-semibold transition-colors disabled:opacity-60";

/** How often to look again while an automation is due, until the worker has run it. */
const REFRESH_WHILE_DUE_MS = 10_000;

/**
 * What the automations are about to do for this candidate, each with Cancel
 * (it never runs) and Send now (it runs on the worker's next pass, within a
 * minute, with the usual checks). Hidden when nothing is waiting.
 */
export function UpcomingAutomations({ items }: { items: UpcomingAutomation[] }) {
  const qc = useQueryClient();
  const cancel = useCancelScheduledAction();
  const runNow = useRunScheduledActionNow();
  const [error, setError] = useState<string | null>(null);
  const now = useNow(5_000);

  // A due automation is the worker's to run now. Keep the profile fresh until
  // it has, so the row leaves on its own instead of after a reload.
  const anyDue = items.some((item) => new Date(item.scheduledFor).getTime() <= now);
  useEffect(() => {
    if (!anyDue) return;
    const timer = setInterval(
      () => qc.invalidateQueries({ queryKey: ["candidate-profile"] }),
      REFRESH_WHILE_DUE_MS,
    );
    return () => clearInterval(timer);
  }, [anyDue, qc]);

  if (items.length === 0) return null;

  const busyId = cancel.isPending ? cancel.variables : runNow.isPending ? runNow.variables : null;

  async function act(id: string, kind: "cancel" | "now") {
    setError(null);
    try {
      if (kind === "cancel") await cancel.mutateAsync(id);
      else await runNow.mutateAsync(id);
    } catch (actionError) {
      setError(
        apiErrorMessage(
          actionError,
          kind === "cancel" ? "Couldn’t cancel that automation." : "Couldn’t run that now.",
        ),
      );
    }
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-800">
        <Clock size={13} aria-hidden="true" />
        Upcoming automations
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => {
          const due = new Date(item.scheduledFor).getTime() <= now;
          const running = due || (runNow.isPending && busyId === item.id);
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="text-slate-700">
                {item.stageName && <span className="font-medium">{item.stageName}: </span>}
                {item.action}
                {item.subject && <span className="text-slate-500"> · {item.subject}</span>}
              </span>
              {running ? (
                <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                  Running now…
                </span>
              ) : (
                <>
                  <span className="whitespace-nowrap text-slate-400">
                    at {messageTimestamp(item.scheduledFor)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void act(item.id, "cancel")}
                      disabled={busyId === item.id}
                      className={`${BUTTON} border border-slate-300 bg-white text-slate-600 hover:border-red-300 hover:text-red-600`}
                    >
                      {cancel.isPending && busyId === item.id ? "Cancelling…" : "Cancel"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void act(item.id, "now")}
                      disabled={busyId === item.id}
                      className={`${BUTTON} bg-accent-9 text-white hover:bg-accent-10`}
                    >
                      Send now
                    </button>
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-1.5 text-[11px] text-red-700">{error}</p>}
    </div>
  );
}
