import { describe, expect, it } from "vitest";

import {
  MAX_REMINDERS,
  isReminderNumberWithinConfig,
  reminderSchedule,
  reminderScheduleDays,
  reminderScheduleRows,
} from "@/utilities/reminder-plan";
import type { ReminderConfig } from "@/types/api";

const SENT_AT = new Date("2026-08-06T09:00:00.000Z");

const DAY = 1440;

function config(overrides: Partial<ReminderConfig> = {}): ReminderConfig {
  return {
    enabled: true,
    intervalMinutes: [2 * DAY],
    maxCount: 3,
    messageTemplateId: null,
    ...overrides,
  };
}

function isoTimes(reminderConfig: ReminderConfig | null): string[] {
  return reminderSchedule(reminderConfig, SENT_AT).map((slot) => slot.scheduledFor.toISOString());
}

describe("intervals are gaps, counted from the send and then from each other", () => {
  it("repeats the only interval it is given", () => {
    expect(isoTimes(config({ intervalMinutes: [2 * DAY], maxCount: 3 }))).toEqual([
      "2026-08-08T09:00:00.000Z",
      "2026-08-10T09:00:00.000Z",
      "2026-08-12T09:00:00.000Z",
    ]);
  });

  it("walks the documented example: after 2 days, then after 4 days, up to 3 times", () => {
    expect(isoTimes(config({ intervalMinutes: [2 * DAY, 4 * DAY], maxCount: 3 }))).toEqual([
      "2026-08-08T09:00:00.000Z",
      "2026-08-12T09:00:00.000Z",
      "2026-08-16T09:00:00.000Z",
    ]);
  });

  it("numbers the reminders from one, in order", () => {
    expect(reminderSchedule(config(), SENT_AT).map((slot) => slot.reminderNumber)).toEqual([
      1, 2, 3,
    ]);
  });

  it("stops at the maximum count even when more intervals are configured", () => {
    const slots = reminderSchedule(
      config({ intervalMinutes: [DAY, DAY, DAY, DAY, DAY], maxCount: 2 }),
      SENT_AT,
    );

    expect(slots).toHaveLength(2);
  });

  it("takes the send instant as a parameter rather than reading the clock", () => {
    const later = new Date("2027-01-01T00:00:00.000Z");
    expect(reminderSchedule(config({ maxCount: 1 }), later)[0]?.scheduledFor.toISOString()).toBe(
      "2027-01-03T00:00:00.000Z",
    );
  });
});

describe("a reminder chain is finite by construction", () => {
  it("schedules nothing when there is no configuration at all", () => {
    expect(reminderSchedule(null, SENT_AT)).toEqual([]);
  });

  it("schedules nothing when reminders are turned off", () => {
    expect(reminderSchedule(config({ enabled: false }), SENT_AT)).toEqual([]);
  });

  it("schedules nothing when no usable interval was configured", () => {
    expect(reminderSchedule(config({ intervalMinutes: [] }), SENT_AT)).toEqual([]);
    expect(reminderSchedule(config({ intervalMinutes: [0] }), SENT_AT)).toEqual([]);
    expect(reminderSchedule(config({ intervalMinutes: [-60] }), SENT_AT)).toEqual([]);
  });

  it("schedules nothing for a zero or negative maximum count", () => {
    expect(reminderSchedule(config({ maxCount: 0 }), SENT_AT)).toEqual([]);
    expect(reminderSchedule(config({ maxCount: -5 }), SENT_AT)).toEqual([]);
  });

  it("never exceeds the hard cap, whatever the configuration claims", () => {
    const slots = reminderSchedule(config({ maxCount: 5000 }), SENT_AT);

    expect(slots).toHaveLength(MAX_REMINDERS);
    expect(slots.at(-1)?.reminderNumber).toBe(MAX_REMINDERS);
  });

  it("drops an interval that is not a whole number of minutes", () => {
    expect(reminderSchedule(config({ intervalMinutes: [1.5] }), SENT_AT)).toEqual([]);
  });

  it("hands the database snake_case rows it can insert directly", () => {
    expect(reminderScheduleRows(config({ maxCount: 1 }), SENT_AT)).toEqual([
      { reminder_number: 1, scheduled_for: "2026-08-08T09:00:00.000Z" },
    ]);
  });
});

describe("the editor previews the run in days, from the same arithmetic", () => {
  it("counts each reminder from the send", () => {
    expect(
      reminderScheduleDays(config({ intervalMinutes: [2 * DAY, 4 * DAY], maxCount: 3 })),
    ).toEqual([2, 6, 10]);
  });

  it("previews nothing when reminders are off", () => {
    expect(reminderScheduleDays(config({ enabled: false }))).toEqual([]);
    expect(reminderScheduleDays(null)).toEqual([]);
  });
});

describe("the maximum count is re-checked when a reminder comes due", () => {
  it("accepts a reminder inside the configured count", () => {
    expect(isReminderNumberWithinConfig(config({ maxCount: 3 }), 3)).toBe(true);
  });

  it("rejects one past it, which is what happens when the count is edited down", () => {
    expect(isReminderNumberWithinConfig(config({ maxCount: 2 }), 3)).toBe(false);
  });

  it("rejects everything once reminders are turned off", () => {
    expect(isReminderNumberWithinConfig(config({ enabled: false }), 1)).toBe(false);
  });

  it("rejects everything when the configuration has been removed", () => {
    expect(isReminderNumberWithinConfig(null, 1)).toBe(false);
  });

  it("rejects a reminder number beyond the hard cap", () => {
    expect(isReminderNumberWithinConfig(config({ maxCount: 5000 }), MAX_REMINDERS + 1)).toBe(false);
  });
});
