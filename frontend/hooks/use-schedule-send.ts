"use client";

import { useState } from "react";

import { toLocalDateTimeInputValue } from "@/utilities/relative-time";
import { planScheduledSend, SCHEDULE_UNREADABLE } from "@/utilities/scheduled-send";

const DEFAULT_DELAY_MS = 60 * 60 * 1000;

export const PICK_A_FUTURE_TIME =
  "Pick a send time in the future, or turn scheduling off to send now.";

export type ResolvedSchedule =
  | { ok: true; scheduledFor: string | null }
  | { ok: false; reason: string };

function defaultSendTime(): string {
  return toLocalDateTimeInputValue(new Date(Date.now() + DEFAULT_DELAY_MS));
}

export function useScheduleSend() {
  const [scheduleAt, setScheduleAt] = useState<string | null>(null);

  function toggle() {
    setScheduleAt(scheduleAt === null ? defaultSendTime() : null);
  }

  function reset() {
    setScheduleAt(null);
  }

  function resolve(now: Date = new Date()): ResolvedSchedule {
    if (scheduleAt === null) return { ok: true, scheduledFor: null };

    const requested = new Date(scheduleAt);
    if (!Number.isFinite(requested.getTime())) {
      return { ok: false, reason: `${SCHEDULE_UNREADABLE}.` };
    }

    const plan = planScheduledSend({ requestedFor: requested.toISOString(), now });

    if (plan.kind === "rejected") return { ok: false, reason: `${plan.reason}.` };
    if (plan.kind === "immediate") return { ok: false, reason: PICK_A_FUTURE_TIME };

    return { ok: true, scheduledFor: plan.sendAt };
  }

  return { scheduleAt, setScheduleAt, scheduled: scheduleAt !== null, toggle, reset, resolve };
}
