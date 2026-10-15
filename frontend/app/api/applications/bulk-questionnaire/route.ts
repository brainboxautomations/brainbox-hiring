import { NextResponse, type NextRequest } from "next/server";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { DAILY_LIMIT_NOT_SENT } from "@/utilities/email-limits";
import { manualSender, readSelection } from "@/app/api/applications/_bulk";
import { sendQuestionnaireToCandidate } from "@/app/api/questionnaires/_send";
import { bulkCandidateQuestionnaireSchema } from "@/schemas/bulk-candidate-schema";
import type { BulkCandidateFailure } from "@/types/api";
import { DEFAULT_REMINDER } from "@/utilities/stage-action-form";

export async function POST(request: NextRequest) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, user } = ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body");
  }

  const parsed = bulkCandidateQuestionnaireSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid bulk questionnaire send", 422);
  }
  const { applicationIds, questionnaireTemplateId, sendReminders } = parsed.data;

  try {
    const { data: template, error: templateError } = await supabase
      .from("questionnaire_templates")
      .select("id, name")
      .eq("id", questionnaireTemplateId)
      .maybeSingle();
    if (templateError) return apiError(templateError.message, 500);
    if (!template) return apiError("That questionnaire does not exist", 422);

    const selection = await readSelection(supabase, applicationIds);
    if ("error" in selection) return apiError(selection.error, 500);

    const sender = await manualSender(supabase, user);
    const reminderConfig = sendReminders ? DEFAULT_REMINDER : null;

    const failures: BulkCandidateFailure[] = [...selection.failures];
    const sent: string[] = [];
    // A questionnaire link is never stored, so a send refused at the relay's
    // daily limit cannot be held for later. Once one is refused, the rest are
    // reported the same way without asking the relay again.
    let limitReached = false;

    for (const candidate of selection.candidates) {
      if (limitReached) {
        failures.push({ applicationId: candidate.applicationId, reason: DAILY_LIMIT_NOT_SENT });
        continue;
      }

      const result = await sendQuestionnaireToCandidate(supabase, {
        applicationId: candidate.applicationId,
        questionnaireTemplateId,
        key: { context: "manual_sent", originStageId: candidate.currentStageId },
        reminderConfig,
        sender,
        now: new Date(),
      });

      if (result.outcome === "sent") {
        sent.push(candidate.applicationId);
      } else if (result.outcome === "failed" && result.limit === "daily") {
        limitReached = true;
        failures.push({ applicationId: candidate.applicationId, reason: DAILY_LIMIT_NOT_SENT });
      } else {
        failures.push({ applicationId: candidate.applicationId, reason: result.reason });
      }
    }

    return NextResponse.json({ sent, failures });
  } catch (error) {
    return apiUnexpected(error);
  }
}
