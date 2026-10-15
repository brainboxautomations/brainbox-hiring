import { NextResponse, type NextRequest } from "next/server";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { manualSender, readSelection } from "@/app/api/applications/_bulk";
import { readEmailTiming, undoWindowSendTime } from "@/app/api/_email-timing";
import { sendTemplatedEmail } from "@/app/api/messages/_send";
import { bulkCandidateEmailSchema } from "@/schemas/bulk-candidate-schema";
import type { BulkCandidateFailure, BulkCandidateSendResult } from "@/types/api";

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

  const parsed = bulkCandidateEmailSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid bulk email", 422);
  }
  const { applicationIds, messageTemplateId } = parsed.data;

  try {
    const { data: template, error: templateError } = await supabase
      .from("message_templates")
      .select("id, subject, body")
      .eq("id", messageTemplateId)
      .maybeSingle();
    if (templateError) return apiError(templateError.message, 500);
    if (!template) return apiError("That message template does not exist", 422);

    const selection = await readSelection(supabase, applicationIds);
    if ("error" in selection) return apiError(selection.error, 500);

    const sender = await manualSender(supabase, user);
    const failures: BulkCandidateFailure[] = [...selection.failures];
    const sent: string[] = [];
    const scheduled: string[] = [];
    const scheduledMessageIds: string[] = [];

    // With the undo window on, the whole batch is held until then, so a send
    // to the wrong selection can be taken back. Otherwise it goes out now, and
    // once the relay refuses for its daily limit every later candidate is
    // stored for after the reset instead of being refused one by one.
    const undoUntil = undoWindowSendTime(await readEmailTiming(supabase), new Date());
    let heldUntil: string | null = undoUntil;

    for (const candidate of selection.candidates) {
      const result = await sendTemplatedEmail(supabase, {
        applicationId: candidate.applicationId,
        sender,
        subjectTemplate: template.subject ?? "",
        bodyTemplate: template.body ?? "",
        onDailyLimit: "schedule",
        scheduledFor: heldUntil,
      });

      if (result.outcome === "failed") {
        failures.push({ applicationId: candidate.applicationId, reason: result.reason });
      } else if (result.outcome === "scheduled") {
        heldUntil = result.scheduledFor;
        scheduled.push(candidate.applicationId);
        scheduledMessageIds.push(result.messageId);
      } else {
        sent.push(candidate.applicationId);
      }
    }

    const result: BulkCandidateSendResult = { sent, failures };
    if (scheduled.length > 0 && heldUntil) {
      result.scheduled = scheduled;
      result.scheduledMessageIds = scheduledMessageIds;
      result.scheduledFor = heldUntil;
      result.scheduledReason = undoUntil ? "undo" : "limit";
    }
    return NextResponse.json(result);
  } catch (error) {
    return apiUnexpected(error);
  }
}
