import type { ReminderConfig } from "@/types/api";

export const MAX_REMINDERS = 10;

export const MAX_REMINDER_INTERVAL_MINUTES = 129_600;

export type ReminderSlot = {
  reminderNumber: number;
  scheduledFor: Date;
};

function isWholeNumber(value: number): boolean {
  return Number.isInteger(value) && Number.isFinite(value);
}

function usableIntervals(intervalMinutes: number[]): number[] {
  return intervalMinutes.filter(
    (minutes) => isWholeNumber(minutes) && minutes >= 1 && minutes <= MAX_REMINDER_INTERVAL_MINUTES,
  );
}

function reminderCount(config: ReminderConfig, intervals: number[]): number {
  if (!config.enabled) return 0;
  if (intervals.length === 0) return 0;
  if (!isWholeNumber(config.maxCount) || config.maxCount < 1) return 0;
  return Math.min(config.maxCount, MAX_REMINDERS);
}

export function reminderSchedule(config: ReminderConfig | null, sentAt: Date): ReminderSlot[] {
  if (!config) return [];

  const intervals = usableIntervals(config.intervalMinutes);
  const count = reminderCount(config, intervals);

  const slots: ReminderSlot[] = [];
  let elapsedMinutes = 0;

  for (let index = 0; index < count; index += 1) {
    const gap = intervals[Math.min(index, intervals.length - 1)] ?? 0;
    if (gap <= 0) break;
    elapsedMinutes += gap;
    slots.push({
      reminderNumber: index + 1,
      scheduledFor: new Date(sentAt.getTime() + elapsedMinutes * 60_000),
    });
  }

  return slots;
}

export function reminderScheduleRows(
  config: ReminderConfig | null,
  sentAt: Date,
): Array<{ reminder_number: number; scheduled_for: string }> {
  return reminderSchedule(config, sentAt).map((slot) => ({
    reminder_number: slot.reminderNumber,
    scheduled_for: slot.scheduledFor.toISOString(),
  }));
}

const PREVIEW_ORIGIN = new Date(0);

export function reminderScheduleDays(config: ReminderConfig | null): number[] {
  return reminderSchedule(config, PREVIEW_ORIGIN).map((slot) =>
    Math.round(slot.scheduledFor.getTime() / 86_400_000),
  );
}

export function isReminderNumberWithinConfig(
  config: ReminderConfig | null,
  reminderNumber: number,
): boolean {
  if (!config || !config.enabled) return false;
  if (!isWholeNumber(reminderNumber) || reminderNumber < 1) return false;
  return reminderNumber <= Math.min(config.maxCount, MAX_REMINDERS);
}
