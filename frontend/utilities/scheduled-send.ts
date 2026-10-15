import type { MessageStatus } from "@/types/api";

export const MAX_SCHEDULE_HORIZON_DAYS = 365;

export const SCHEDULE_TOLERANCE_MS = 30_000;

const HORIZON_MS = MAX_SCHEDULE_HORIZON_DAYS * 24 * 60 * 60 * 1000;

export const SCHEDULE_UNREADABLE = "That send time is not a valid date";

export const SCHEDULE_TOO_FAR_AHEAD = `A message cannot be scheduled more than ${MAX_SCHEDULE_HORIZON_DAYS} days ahead`;

export type ScheduledSendPlan =
  | { kind: "immediate" }
  | { kind: "scheduled"; sendAt: string }
  | { kind: "rejected"; reason: string };

export function planScheduledSend(input: {
  requestedFor: string | null | undefined;
  now: Date;
}): ScheduledSendPlan {
  if (!input.requestedFor) return { kind: "immediate" };

  const requested = new Date(input.requestedFor);
  if (!Number.isFinite(requested.getTime())) {
    return { kind: "rejected", reason: SCHEDULE_UNREADABLE };
  }

  const delay = requested.getTime() - input.now.getTime();

  if (delay <= SCHEDULE_TOLERANCE_MS) return { kind: "immediate" };
  if (delay > HORIZON_MS) return { kind: "rejected", reason: SCHEDULE_TOO_FAR_AHEAD };

  return { kind: "scheduled", sendAt: requested.toISOString() };
}

export function scheduledSendIsCancellable(status: MessageStatus | null): boolean {
  return status === "scheduled";
}

/** How often to look again once an email is due, while the worker (every minute) sends it. */
export const PENDING_SEND_POLL_MS = 5_000;

/** The longest wait between looks while an email is held further ahead. */
export const PENDING_SEND_MAX_WAIT_MS = 60_000;

/**
 * How long a list of emails can go before it is fetched again, so a held email
 * turns into "sent" (or "failed") on screen without a reload: soon after it
 * falls due, quickly while it is being sent, and not at all once nothing is
 * waiting.
 */
export function pendingSendRefetchInterval(
  messages: readonly { status: MessageStatus | null; scheduledFor: string | null }[] | undefined,
  now: number,
): number | false {
  let wait: number | null = null;
  for (const message of messages ?? []) {
    if (message.status === "sending") return PENDING_SEND_POLL_MS;
    if (message.status !== "scheduled") continue;
    const due = message.scheduledFor ? new Date(message.scheduledFor).getTime() - now : 0;
    const next = Math.min(Math.max(due, PENDING_SEND_POLL_MS), PENDING_SEND_MAX_WAIT_MS);
    wait = wait === null ? next : Math.min(wait, next);
  }
  return wait ?? false;
}
