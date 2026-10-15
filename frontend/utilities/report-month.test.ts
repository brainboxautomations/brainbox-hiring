import { describe, expect, it } from "vitest";

import {
  barHeightPercent,
  currentReportMonth,
  formatReportMonth,
  isReportMonth,
  largestValue,
  reportMonthFromDate,
  reportMonthToDate,
  weekBucketLabel,
} from "@/utilities/report-month";

describe("currentReportMonth reads the clock in UTC", () => {
  it("returns the month the instant falls in", () => {
    expect(currentReportMonth(new Date("2026-06-17T09:00:00Z"))).toBe("2026-06");
  });

  it("pads a single-digit month", () => {
    expect(currentReportMonth(new Date("2026-03-01T00:00:00Z"))).toBe("2026-03");
  });

  it("keeps the first instant of a month in that month", () => {
    expect(currentReportMonth(new Date("2026-07-01T00:00:00Z"))).toBe("2026-07");
  });

  it("keeps the last instant of a month in that month", () => {
    expect(currentReportMonth(new Date("2026-07-31T23:59:59Z"))).toBe("2026-07");
  });

  it("puts a London midnight on 1 June into May, because the boundary is UTC", () => {
    expect(currentReportMonth(new Date("2026-06-01T00:30:00+01:00"))).toBe("2026-05");
  });

  it("puts an Auckland midday on 1 January into the previous December", () => {
    expect(currentReportMonth(new Date("2026-01-01T12:00:00+13:00"))).toBe("2025-12");
  });
});

describe("isReportMonth accepts only YYYY-MM", () => {
  it.each(["2026-01", "2026-12", "1999-07"])("accepts %s", (value) => {
    expect(isReportMonth(value)).toBe(true);
  });

  it.each(["2026-00", "2026-13", "2026-6", "2026-06-01", "June 2026", "", "2026/06"])(
    "rejects %s",
    (value) => {
      expect(isReportMonth(value)).toBe(false);
    },
  );
});

describe("converting between a month and the date the database wants", () => {
  it("turns a month into the first of that month", () => {
    expect(reportMonthToDate("2026-06")).toBe("2026-06-01");
  });

  it("turns a date back into its month", () => {
    expect(reportMonthFromDate("2026-06-01")).toBe("2026-06");
  });

  it("round-trips", () => {
    expect(reportMonthFromDate(reportMonthToDate("2026-11"))).toBe("2026-11");
  });
});

describe("formatReportMonth", () => {
  it("names the month in full", () => {
    expect(formatReportMonth("2026-06")).toBe("June 2026");
  });

  it("names January and December, the two ends of the array", () => {
    expect(formatReportMonth("2026-01")).toBe("January 2026");
    expect(formatReportMonth("2026-12")).toBe("December 2026");
  });

  it("returns anything it does not recognise untouched rather than printing undefined", () => {
    expect(formatReportMonth("nonsense")).toBe("nonsense");
    expect(formatReportMonth("2026-13")).toBe("2026-13");
  });
});

describe("weekBucketLabel", () => {
  it("labels the four buckets", () => {
    expect([1, 2, 3, 4].map(weekBucketLabel)).toEqual(["W1", "W2", "W3", "W4"]);
  });
});

describe("bar sizing never divides by zero", () => {
  it("scales a value against the largest bar", () => {
    expect(barHeightPercent(21, 42)).toBe(50);
    expect(barHeightPercent(42, 42)).toBe(100);
  });

  it("returns 0 rather than NaN when every bar is zero", () => {
    expect(barHeightPercent(0, 0)).toBe(0);
  });

  it("returns 0 for a zero value against a non-zero largest", () => {
    expect(barHeightPercent(0, 42)).toBe(0);
  });

  it("never returns a negative height", () => {
    expect(barHeightPercent(-3, 42)).toBe(0);
  });

  it("finds the largest value, and 0 for an empty chart", () => {
    expect(largestValue([3, 41, 12])).toBe(41);
    expect(largestValue([])).toBe(0);
    expect(largestValue([0, 0, 0])).toBe(0);
  });
});
