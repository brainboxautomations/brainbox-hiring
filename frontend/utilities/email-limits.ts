/**
 * The mail relay's sending limits, as the app sees them.
 *
 * Resend refuses a send once the plan's daily or monthly quota is used up
 * (`daily_quota_exceeded`, `monthly_quota_exceeded`), and briefly when more
 * than ten requests arrive in one second (`rate_limit_exceeded`). The first is
 * worth waiting for: the daily count resets at midnight UTC, so an email held
 * until just after then goes out. The monthly one does not reset at midnight,
 * so it is reported, not waited for.
 */
export type EmailLimit = "daily" | "monthly";

/** Minutes past midnight UTC to wait, so the relay's reset has certainly happened. */
const RESET_MARGIN_MINUTES = 5;

/** The first moment the daily limit has certainly reset: 00:05 UTC after `now`. */
export function nextDailyLimitReset(now: Date): Date {
  const reset = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      RESET_MARGIN_MINUTES,
    ),
  );
  return reset;
}

export const DAILY_LIMIT_REASON =
  "The daily email limit has been reached. It resets at midnight UTC.";

export const MONTHLY_LIMIT_REASON =
  "The monthly email limit has been reached, so this email was not sent.";

/** For a send that cannot be held (a questionnaire link is never stored). */
export const DAILY_LIMIT_NOT_SENT =
  "Not sent: the daily email limit has been reached. Send it again after midnight UTC.";

export function limitReason(limit: EmailLimit): string {
  return limit === "daily" ? DAILY_LIMIT_REASON : MONTHLY_LIMIT_REASON;
}

export type RelayRefusal = "rate_limited" | EmailLimit | "other";

/** What kind of refusal a Resend error is, from its `name` (or a bare 429). */
export function classifyRelayError(error: {
  name?: string | null;
  statusCode?: number | null;
}): RelayRefusal {
  if (error.name === "daily_quota_exceeded") return "daily";
  if (error.name === "monthly_quota_exceeded") return "monthly";
  if (error.name === "rate_limit_exceeded" || error.statusCode === 429) return "rate_limited";
  return "other";
}

/**
 * Waits before each retry of a send refused for going past ten requests a
 * second. Short: the limit is per second, so a moment's pause clears it.
 */
export const RATE_LIMIT_RETRY_DELAYS_MS = [1000, 2000, 4000];
