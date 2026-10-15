import { describe, expect, it } from "vitest";

import { classifyRelayError, nextDailyLimitReset } from "@/utilities/email-limits";

describe("nextDailyLimitReset", () => {
  // The relay's daily count resets at midnight UTC; a held email waits until
  // five minutes past, so the reset has certainly happened.
  it("is 00:05 UTC on the next day", () => {
    expect(nextDailyLimitReset(new Date("2026-10-08T14:30:00Z"))).toEqual(
      new Date("2026-10-09T00:05:00Z"),
    );
  });

  it("is the next day even just after midnight, once that day's quota is spent", () => {
    expect(nextDailyLimitReset(new Date("2026-10-08T00:10:00Z"))).toEqual(
      new Date("2026-10-09T00:05:00Z"),
    );
  });

  it("rolls over the end of a month and a year", () => {
    expect(nextDailyLimitReset(new Date("2026-10-31T23:59:00Z"))).toEqual(
      new Date("2026-11-01T00:05:00Z"),
    );
    expect(nextDailyLimitReset(new Date("2026-12-31T20:00:00Z"))).toEqual(
      new Date("2027-01-01T00:05:00Z"),
    );
  });
});

describe("classifyRelayError", () => {
  it("tells the daily and monthly limits apart", () => {
    expect(classifyRelayError({ name: "daily_quota_exceeded", statusCode: 429 })).toBe("daily");
    expect(classifyRelayError({ name: "monthly_quota_exceeded", statusCode: 429 })).toBe("monthly");
  });

  it("treats a burst over the per-second limit as worth retrying", () => {
    expect(classifyRelayError({ name: "rate_limit_exceeded", statusCode: 429 })).toBe(
      "rate_limited",
    );
    expect(classifyRelayError({ name: null, statusCode: 429 })).toBe("rate_limited");
  });

  it("leaves every other refusal alone", () => {
    expect(classifyRelayError({ name: "validation_error", statusCode: 422 })).toBe("other");
    expect(classifyRelayError({ name: "invalid_from_address", statusCode: 403 })).toBe("other");
  });
});
