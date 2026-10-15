import type { SupabaseClient } from "@supabase/supabase-js";

import { companyEnv, serverEnv } from "@/configurations/env-configuration";
import { toReminderConfigRow } from "@/app/api/_mappers";
import { sendTemplatedEmail, type TemplatedEmailSender } from "@/app/api/messages/_send";
import type { ReminderConfig } from "@/types/api";
import type { Database, Json } from "@/types/database.types";
import type { EmailLimit } from "@/utilities/email-limits";
import { questionnaireInvite, type QuestionnaireInvite } from "@/utilities/questionnaire-invite";
import {
  generateQuestionnaireToken,
  questionnaireTokenExpiresAt,
} from "@/utilities/questionnaire-token";
import { reminderScheduleRows } from "@/utilities/reminder-plan";
import { buildQuestionnaireEmail, type QuestionnaireLink } from "@/utilities/questionnaire-email";
import { questionnaireEmailFor } from "@/app/api/questionnaires/_emails";

export const QUESTIONNAIRE_LINK_NOT_ISSUED =
  "The questionnaire link could not be issued, so nothing was sent";

export const QUESTIONNAIRE_ALREADY_COMPLETED =
  "They have already completed this questionnaire, so it was not sent again";

export const QUESTIONNAIRE_RESPONSE_NOT_FOUND =
  "That questionnaire is not on this candidate's record";

const UNIQUE_VIOLATION = "23505";

export type QuestionnaireSendKey =
  | { context: "stage_sent"; stageActionId: string }
  /**
   * askAgain: a deliberate per-candidate send, which asks someone who has
   * already completed it to fill it in again (a new response). A bulk send
   * leaves it off and skips them.
   */
  | { context: "manual_sent"; originStageId: string | null; askAgain?: boolean }
  /** The same pending questionnaire again, with a fresh link: no new response. */
  | { context: "resend"; questionnaireResponseId: string };

export type QuestionnaireSendInput = {
  applicationId: string;
  questionnaireTemplateId: string;
  key: QuestionnaireSendKey;
  reminderConfig: ReminderConfig | null;
  sender: TemplatedEmailSender;
  now: Date;
  /** Passed on to the send; the automation worker uses "report". */
  onDailyLimit?: "report";
};

export type QuestionnaireSendResult =
  | { outcome: "sent"; questionnaireResponseId: string; messageId: string | null }
  | { outcome: "skipped"; reason: string }
  | { outcome: "failed"; reason: string; messageId: string | null; limit?: EmailLimit | null };

export function currentQuestionnaireInvite(): QuestionnaireInvite {
  return questionnaireInvite({
    appBaseUrl: serverEnv().APP_BASE_URL,
    careersUrl: companyEnv().COMPANY_CAREERS_URL,
  });
}

export async function issueQuestionnaireLink(
  supabase: SupabaseClient<Database>,
  input: { questionnaireResponseId: string; invite: QuestionnaireInvite; now: Date },
): Promise<QuestionnaireLink | null> {
  if (!input.invite.available) return null;

  const token = generateQuestionnaireToken();
  const expiresAt = questionnaireTokenExpiresAt(input.now);

  const { data, error } = await supabase.rpc("issue_questionnaire_access_token", {
    p_questionnaire_response_id: input.questionnaireResponseId,
    p_token: token,
    p_now: input.now.toISOString(),
    p_expires_at: expiresAt.toISOString(),
  });

  if (error || data !== true) return null;

  return { url: input.invite.urlFor(token), expiresAt };
}

export async function scheduleQuestionnaireReminders(
  supabase: SupabaseClient<Database>,
  input: { questionnaireResponseId: string; config: ReminderConfig | null; sentAt: Date },
): Promise<void> {
  const schedule = reminderScheduleRows(input.config, input.sentAt);
  if (schedule.length === 0) return;

  const { data: queued, error } = await supabase.rpc("schedule_questionnaire_reminders", {
    p_questionnaire_response_id: input.questionnaireResponseId,
    p_schedule: schedule as unknown as Json,
    p_now: input.sentAt.toISOString(),
  });

  // The questionnaire has already gone out, so this cannot fail the send (a
  // retry would email the candidate again). It is logged instead of dropped:
  // the send would otherwise look complete with nothing chasing it.
  if (error || !queued) {
    console.error(
      "questionnaire reminders not scheduled",
      input.questionnaireResponseId,
      error?.message ?? "no reminder was queued",
    );
  }
}

async function existingResponseId(
  supabase: SupabaseClient<Database>,
  input: QuestionnaireSendInput,
): Promise<{ responseId: string | null } | { alreadyCompleted: true } | { error: string }> {
  // A failed lookup must not read as "never sent": that would create a second
  // response and send the candidate a second invite.
  if (input.key.context === "resend") {
    const { data, error } = await supabase
      .from("questionnaire_responses")
      .select("id, status")
      .eq("id", input.key.questionnaireResponseId)
      .eq("application_id", input.applicationId)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: QUESTIONNAIRE_RESPONSE_NOT_FOUND };
    if (data.status === "completed") return { alreadyCompleted: true };

    return { responseId: data.id };
  }

  if (input.key.context === "stage_sent") {
    const { data, error } = await supabase
      .from("questionnaire_responses")
      .select("id")
      .eq("application_id", input.applicationId)
      .eq("stage_action_id", input.key.stageActionId)
      .maybeSingle();
    if (error) return { error: error.message };

    return { responseId: data?.id ?? null };
  }

  const { data, error } = await supabase
    .from("questionnaire_responses")
    .select("id, status")
    .eq("application_id", input.applicationId)
    .eq("questionnaire_template_id", input.questionnaireTemplateId)
    .eq("context", "manual_sent")
    .order("created_at", { ascending: false });
  if (error) return { error: error.message };

  const rows = data ?? [];
  const pending = rows.find((row) => row.status === "pending");
  if (pending) return { responseId: pending.id };
  if (rows.length > 0 && !input.key.askAgain) return { alreadyCompleted: true };

  return { responseId: null };
}

async function createResponse(
  supabase: SupabaseClient<Database>,
  input: QuestionnaireSendInput,
): Promise<{ responseId: string } | { error: string }> {
  // A resend always names a response that exists, so it never creates one.
  if (input.key.context === "resend") return { error: QUESTIONNAIRE_RESPONSE_NOT_FOUND };

  const manual = input.key.context === "manual_sent" ? input.key : null;

  const { data, error } = await supabase
    .from("questionnaire_responses")
    .insert({
      questionnaire_template_id: input.questionnaireTemplateId,
      application_id: input.applicationId,
      context: input.key.context,
      status: "pending",
      sent_at: input.now.toISOString(),
      stage_action_id: input.key.context === "stage_sent" ? input.key.stageActionId : null,
      origin_stage_id: manual ? manual.originStageId : null,
      reminder_config: manual ? toReminderConfigRow(input.reminderConfig) : null,
    })
    .select("id")
    .single();

  if (data) return { responseId: data.id };

  if (error?.code === UNIQUE_VIOLATION) {
    const raced = await existingResponseId(supabase, input);
    if ("responseId" in raced && raced.responseId) return { responseId: raced.responseId };
  }

  return { error: error?.message ?? "Could not record the questionnaire send" };
}

export async function sendQuestionnaireToCandidate(
  supabase: SupabaseClient<Database>,
  input: QuestionnaireSendInput,
): Promise<QuestionnaireSendResult> {
  const invite = currentQuestionnaireInvite();
  if (!invite.available) return { outcome: "skipped", reason: invite.reason };

  const existing = await existingResponseId(supabase, input);
  if ("error" in existing) return { outcome: "failed", reason: existing.error, messageId: null };
  if ("alreadyCompleted" in existing) {
    return { outcome: "skipped", reason: QUESTIONNAIRE_ALREADY_COMPLETED };
  }

  let responseId = existing.responseId;

  if (!responseId) {
    const created = await createResponse(supabase, input);
    if ("error" in created) return { outcome: "failed", reason: created.error, messageId: null };
    responseId = created.responseId;
  }

  const link = await issueQuestionnaireLink(supabase, {
    questionnaireResponseId: responseId,
    invite,
    now: input.now,
  });

  if (!link) {
    if (!existing.responseId) {
      await supabase.from("questionnaire_responses").delete().eq("id", responseId);
    }
    return { outcome: "skipped", reason: QUESTIONNAIRE_LINK_NOT_ISSUED };
  }

  const { name, text } = await questionnaireEmailFor(
    supabase,
    input.questionnaireTemplateId,
    "invite",
  );
  const email = buildQuestionnaireEmail(text, { name, link });

  const sent = await sendTemplatedEmail(supabase, {
    applicationId: input.applicationId,
    sender: input.sender,
    subjectTemplate: email.subject,
    bodyTemplate: email.sent,
    recordedBodyTemplate: email.recorded,
    onDailyLimit: input.onDailyLimit,
  });

  if (sent.outcome === "failed") {
    // Refused at the relay's limit: nothing reached the candidate, so a
    // response created for this send is removed again and the next attempt
    // starts clean, rather than the profile showing a questionnaire as sent.
    if (sent.limit && !existing.responseId) {
      await supabase.from("questionnaire_responses").delete().eq("id", responseId);
    }
    return {
      outcome: "failed",
      reason: sent.reason,
      messageId: sent.messageId,
      limit: sent.limit ?? null,
    };
  }

  // Sent again on a questionnaire that was already waiting: the profile shows
  // when the latest invite went out, not the first one.
  if (existing.responseId) {
    await supabase
      .from("questionnaire_responses")
      .update({ sent_at: input.now.toISOString() })
      .eq("id", responseId);
  }

  await scheduleQuestionnaireReminders(supabase, {
    questionnaireResponseId: responseId,
    config: input.reminderConfig,
    sentAt: input.now,
  });

  return { outcome: "sent", questionnaireResponseId: responseId, messageId: sent.messageId };
}
