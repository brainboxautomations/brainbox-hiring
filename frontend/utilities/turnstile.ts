export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type CaptchaCheck = { ok: true } | { ok: false; reason: string };

export const CAPTCHA_MISSING = "Please complete the check above the submit button and try again.";
export const CAPTCHA_FAILED =
  "We couldn't confirm you're not a robot. Please refresh the page and try again.";
export const CAPTCHA_UNAVAILABLE =
  "We couldn't run the security check just now. Please try again in a moment.";

type SiteverifyResponse = { success?: unknown; "error-codes"?: unknown };

/**
 * Checks a Turnstile token with Cloudflare.
 *
 * With no secret configured the check is skipped, so the app runs before the
 * keys exist; the rate limits still apply. Once a secret is set, a missing or
 * rejected token refuses the submission, and so does Cloudflare being
 * unreachable: failing open would let a bot through whenever the check is down.
 *
 * A token is single-use, so the form must fetch a fresh one after any failed
 * submission.
 */
export async function verifyTurnstileToken(input: {
  secret: string;
  token: string | null | undefined;
  ip: string | null;
  fetchImpl?: typeof fetch;
}): Promise<CaptchaCheck> {
  if (!input.secret) return { ok: true };

  const token = (input.token ?? "").trim();
  if (!token) return { ok: false, reason: CAPTCHA_MISSING };

  const body = new URLSearchParams({ secret: input.secret, response: token });
  if (input.ip) body.set("remoteip", input.ip);

  try {
    const response = await (input.fetchImpl ?? fetch)(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ok: false, reason: CAPTCHA_UNAVAILABLE };

    const result = (await response.json()) as SiteverifyResponse;
    return result.success === true ? { ok: true } : { ok: false, reason: CAPTCHA_FAILED };
  } catch {
    return { ok: false, reason: CAPTCHA_UNAVAILABLE };
  }
}
