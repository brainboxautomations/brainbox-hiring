import type { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { apiError } from "@/app/api/_helpers";
import { serverEnv } from "@/configurations/env-configuration";
import type { Database } from "@/types/database.types";
import { clientIp } from "@/utilities/client-ip";
import { verifyTurnstileToken } from "@/utilities/turnstile";

export type PublicSubmissionKind = "apply" | "questionnaire" | "upload";

export const TOO_MANY_FROM_IP =
  "Too many submissions from your connection. Please wait a few minutes and try again.";
export const TOO_MANY_FOR_EMAIL =
  "We've already received several applications from this email address today. Please try again tomorrow.";

/**
 * The checks every signed-out submission passes before any work is done: the
 * captcha (skipped for uploads, which happen before the form is submitted and
 * would use up its single-use token), then the rate limits from migration 0048.
 *
 * Returns a response to send back when the request is refused, or null to go
 * ahead. A failure to check the limits refuses the request too: the limits are
 * the only thing between a script and our sending domain, so they fail closed.
 */
export async function guardPublicSubmission(
  supabase: SupabaseClient<Database>,
  request: NextRequest,
  input: { kind: PublicSubmissionKind; captchaToken?: string | null; email?: string | null },
): Promise<NextResponse | null> {
  const ip = clientIp(request.headers);

  if (input.kind !== "upload") {
    const captcha = await verifyTurnstileToken({
      secret: serverEnv().TURNSTILE_SECRET_KEY,
      token: input.captchaToken,
      ip,
    });
    if (!captcha.ok) return apiError(captcha.reason, 403);
  }

  const { data: refusedBy, error } = await supabase.rpc("register_public_submission", {
    p_kind: input.kind,
    p_ip: ip ?? "unknown",
    p_email: input.email ?? "",
    p_now: new Date().toISOString(),
  });
  if (error)
    return apiError("We couldn't accept that just now. Please try again in a moment.", 503);

  if (refusedBy === "email") return apiError(TOO_MANY_FOR_EMAIL, 429);
  if (refusedBy) return apiError(TOO_MANY_FROM_IP, 429);

  return null;
}
