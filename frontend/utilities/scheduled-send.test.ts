import { describe, expect, it } from "vitest";

import {
  MAX_SCHEDULE_HORIZON_DAYS,
  SCHEDULE_TOLERANCE_MS,
  SCHEDULE_TOO_FAR_AHEAD,
  SCHEDULE_UNREADABLE,
  PENDING_SEND_MAX_WAIT_MS,
  PENDING_SEND_POLL_MS,
  pendingSendRefetchInterval,
  planScheduledSend,
  scheduledSendIsCancellable,
} from "@/utilities/scheduled-send";

const NOW = new Date("2026-08-10T09:00:00.000Z");

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function planAt(offsetMs: number) {
  return planScheduledSend({
    requestedFor: new Date(NOW.getTime() + offsetMs).toISOString(),
    now: NOW,
  });
}

describe("whether a requested send time is a schedule at all", () => {
  it("sends immediately when no time was asked for", () => {
    expect(planScheduledSend({ requestedFor: null, now: NOW })).toEqual({ kind: "immediate" });
    expect(planScheduledSend({ requestedFor: undefined, now: NOW })).toEqual({ kind: "immediate" });
    expect(planScheduledSend({ requestedFor: "", now: NOW })).toEqual({ kind: "immediate" });
  });

  it("schedules a time comfortably in the future", () => {
    expect(planAt(30 * MINUTE)).toEqual({
      kind: "scheduled",
      sendAt: "2026-08-10T09:30:00.000Z",
    });
  });

  it("treats a time in the past as an immediate send rather than an error", () => {
    expect(planAt(-DAY)).toEqual({ kind: "immediate" });
  });

  it("treats anything inside the tolerance window as immediate, so 'now' is not a schedule", () => {
    expect(planAt(SCHEDULE_TOLERANCE_MS)).toEqual({ kind: "immediate" });
    expect(planAt(SCHEDULE_TOLERANCE_MS - 1)).toEqual({ kind: "immediate" });
  });

  it("schedules the first instant past the tolerance window", () => {
    expect(planAt(SCHEDULE_TOLERANCE_MS + 1).kind).toBe("scheduled");
  });

  it("rejects a time beyond the horizon", () => {
    expect(planAt(MAX_SCHEDULE_HORIZON_DAYS * DAY + MINUTE)).toEqual({
      kind: "rejected",
      reason: SCHEDULE_TOO_FAR_AHEAD,
    });
  });

  it("accepts the horizon itself", () => {
    expect(planAt(MAX_SCHEDULE_HORIZON_DAYS * DAY).kind).toBe("scheduled");
  });

  it("rejects a time it cannot read", () => {
    expect(planScheduledSend({ requestedFor: "next tuesday", now: NOW })).toEqual({
      kind: "rejected",
      reason: SCHEDULE_UNREADABLE,
    });
  });

  it("answers the same question the same way whatever the wall clock says", () => {
    const later = new Date(NOW.getTime() + 5 * DAY);
    const requestedFor = new Date(later.getTime() + 30 * MINUTE).toISOString();

    expect(planScheduledSend({ requestedFor, now: later })).toEqual({
      kind: "scheduled",
      sendAt: requestedFor,
    });
    expect(planScheduledSend({ requestedFor, now: NOW }).kind).toBe("scheduled");
  });
});

describe("only a message still waiting in the queue can be cancelled", () => {
  it("allows a cancel while the message is scheduled", () => {
    expect(scheduledSendIsCancellable("scheduled")).toBe(true);
  });

  it("refuses once a worker has claimed it, because the relay call is in flight", () => {
    expect(scheduledSendIsCancellable("sending")).toBe(false);
  });

  it("refuses for every terminal state", () => {
    expect(scheduledSendIsCancellable("sent")).toBe(false);
    expect(scheduledSendIsCancellable("failed")).toBe(false);
    expect(scheduledSendIsCancellable("cancelled")).toBe(false);
    expect(scheduledSendIsCancellable("received")).toBe(false);
    expect(scheduledSendIsCancellable(null)).toBe(false);
  });
});

describe("pendingSendRefetchInterval", () => {
  const now = Date.parse("2026-10-08T10:00:00Z");
  const at = (ms: number) => new Date(now + ms).toISOString();

  it("stops looking when nothing is waiting", () => {
    expect(pendingSendRefetchInterval(undefined, now)).toBe(false);
    expect(
      pendingSendRefetchInterval(
        [
          { status: "sent", scheduledFor: null },
          { status: "failed", scheduledFor: null },
        ],
        now,
      ),
    ).toBe(false);
  });

  it("looks often while an email is being sent or already due", () => {
    expect(pendingSendRefetchInterval([{ status: "sending", scheduledFor: null }], now)).toBe(
      PENDING_SEND_POLL_MS,
    );
    expect(
      pendingSendRefetchInterval([{ status: "scheduled", scheduledFor: at(-1000) }], now),
    ).toBe(PENDING_SEND_POLL_MS);
  });

  it("waits until the soonest email is due, up to a minute", () => {
    expect(
      pendingSendRefetchInterval(
        [
          { status: "scheduled", scheduledFor: at(40_000) },
          { status: "scheduled", scheduledFor: at(20_000) },
        ],
        now,
      ),
    ).toBe(20_000);
    expect(
      pendingSendRefetchInterval([{ status: "scheduled", scheduledFor: at(30 * 60_000) }], now),
    ).toBe(PENDING_SEND_MAX_WAIT_MS);
  });
});
