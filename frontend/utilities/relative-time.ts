const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";

  const elapsed = now - then;
  const ahead = elapsed < 0;
  const magnitude = Math.abs(elapsed);

  const phrase =
    magnitude < MINUTE
      ? "just now"
      : magnitude < HOUR
        ? plural(Math.floor(magnitude / MINUTE), "minute")
        : magnitude < DAY
          ? plural(Math.floor(magnitude / HOUR), "hour")
          : magnitude < WEEK
            ? plural(Math.floor(magnitude / DAY), "day")
            : magnitude < MONTH
              ? plural(Math.floor(magnitude / WEEK), "week")
              : magnitude < YEAR
                ? plural(Math.floor(magnitude / MONTH), "month")
                : plural(Math.floor(magnitude / YEAR), "year");

  if (phrase === "just now") return ahead ? "in a moment" : "just now";
  return ahead ? `in ${phrase}` : `${phrase} ago`;
}

export function toLocalDateTimeInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function calendarDay(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
}

function clockTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function calendarDate(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()] ?? ""} ${date.getDate()}`;
}

export function inboxTimestamp(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (!Number.isFinite(then.getTime())) return "";

  const elapsedDays = calendarDay(new Date(now)) - calendarDay(then);

  if (elapsedDays <= 0) return clockTime(then);
  if (elapsedDays === 1) return "Yst";
  if (elapsedDays < 7) return WEEKDAY_NAMES[then.getDay()] ?? "";
  return calendarDate(then);
}

export function messageTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (!Number.isFinite(then.getTime())) return "";
  return `${calendarDate(then)}, ${clockTime(then)}`;
}
