import { describe, expect, it } from "vitest";

import { inboxTimestamp, messageTimestamp, relativeTime } from "@/utilities/relative-time";

const NOW = new Date(2026, 5, 24, 14, 30).getTime();

describe("relativeTime", () => {
  it("reads as a past or future phrase", () => {
    expect(relativeTime(new Date(NOW - 30_000).toISOString(), NOW)).toBe("just now");
    expect(relativeTime(new Date(NOW - 2 * 60 * 60_000).toISOString(), NOW)).toBe("2 hours ago");
    expect(relativeTime(new Date(NOW + 3 * 24 * 3_600_000).toISOString(), NOW)).toBe("in 3 days");
  });

  it("is empty for missing or unparseable input", () => {
    expect(relativeTime(null)).toBe("");
    expect(relativeTime("not a date")).toBe("");
  });
});

describe("inboxTimestamp", () => {
  it("shows the clock time for something that arrived today", () => {
    expect(inboxTimestamp(new Date(2026, 5, 24, 9, 12).toISOString(), NOW)).toBe("09:12");
  });

  it("says Yst for yesterday", () => {
    expect(inboxTimestamp(new Date(2026, 5, 23, 22, 5).toISOString(), NOW)).toBe("Yst");
  });

  it("names the weekday within the last week", () => {
    expect(inboxTimestamp(new Date(2026, 5, 22, 10, 0).toISOString(), NOW)).toBe("Mon");
  });

  it("falls back to a date once it is older than a week", () => {
    expect(inboxTimestamp(new Date(2026, 5, 12, 10, 0).toISOString(), NOW)).toBe("Jun 12");
  });

  it("is empty for missing or unparseable input", () => {
    expect(inboxTimestamp(null, NOW)).toBe("");
    expect(inboxTimestamp("nonsense", NOW)).toBe("");
  });
});

describe("messageTimestamp", () => {
  it("reads as a date and a clock time", () => {
    expect(messageTimestamp(new Date(2026, 5, 23, 16, 40).toISOString())).toBe("Jun 23, 16:40");
  });

  it("is empty for missing input", () => {
    expect(messageTimestamp(null)).toBe("");
    expect(messageTimestamp("nope")).toBe("");
  });
});
