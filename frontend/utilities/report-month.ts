const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const REPORT_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isReportMonth(value: string): boolean {
  return REPORT_MONTH_PATTERN.test(value);
}

export function currentReportMonth(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function reportMonthToDate(month: string): string {
  return `${month}-01`;
}

export function reportMonthFromDate(date: string): string {
  return date.slice(0, 7);
}

export function formatReportMonth(month: string): string {
  if (!isReportMonth(month)) return month;
  const year = month.slice(0, 4);
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1];
  return `${name} ${year}`;
}

export function weekBucketLabel(weekNumber: number): string {
  return `W${weekNumber}`;
}

export function barHeightPercent(value: number, largest: number): number {
  if (largest <= 0 || value <= 0) return 0;
  return Math.round((value / largest) * 100);
}

export function largestValue(values: number[]): number {
  return values.reduce((largest, value) => (value > largest ? value : largest), 0);
}
