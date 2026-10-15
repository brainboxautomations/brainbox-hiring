import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { manualSender } from "@/app/api/applications/_bulk";
import { sendQuestionnaireToCandidate } from "@/app/api/questionnaires/_send";
import type { QuestionnaireResendResult } from "@/types/api";
import { DAILY_LIMIT_NOT_SENT } from "@/utilities/email-limits";
import { DEFAULT_REMINDER } from "@/utilities/stage-action-form";

type RouteContext = { params: Promise<{ id: string }> };

const responseIdSchema = z.uuid("That is not a questionnaire id");

/**
 * Sends one questionnaire on a candidate's profile again.
 *
 *  * Still pending: the same questionnaire with a fresh link. The old link
 *    stops working, and any reminders carry on as they were.
 *  * Completed: asks them to fill it in again, as a new questionnaire with the
 *    usual reminders. The earlier answers stay on record.
 */
export async function POST(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, user } = ctx;

  const parsed = responseIdSchema.safeParse((await params).id);
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid id", 422);

  try {
    const { data: response, error } = await supabase
      .from("questionnaire_responses")
      .select(
        "id, status, application_id, questionnaire_template_id, applications(current_stage_id)",
      )
      .eq("id", parsed.data)
      .maybeSingle();
    if (error) return apiError(error.message, 500);
    if (!response) return apiError("Questionnaire not found", 404);

    const application = Array.isArray(response.applications)
      ? response.applications[0]
      : response.applications;
    const sender = await manualSender(supabase, user);
    const askAgain = response.status === "completed";

    const result = await sendQuestionnaireToCandidate(supabase, {
      applicationId: response.application_id,
      questionnaireTemplateId: response.questionnaire_template_id,
      key: askAgain
        ? {
            context: "manual_sent",
            originStageId: application?.current_stage_id ?? null,
            askAgain: true,
          }
        : { context: "resend", questionnaireResponseId: response.id },
      reminderConfig: askAgain ? DEFAULT_REMINDER : null,
      sender,
      now: new Date(),
    });

    if (result.outcome !== "sent") {
      const reason =
        result.outcome === "failed" && result.limit === "daily"
          ? DAILY_LIMIT_NOT_SENT
          : result.reason;
      return apiError(reason, result.outcome === "skipped" ? 409 : 502);
    }

    const body: QuestionnaireResendResult = {
      mode: askAgain ? "asked_again" : "resent",
      questionnaireResponseId: result.questionnaireResponseId,
    };
    return NextResponse.json(body);
  } catch (error) {
    return apiUnexpected(error);
  }
}
