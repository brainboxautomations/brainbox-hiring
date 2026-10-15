import type { SupabaseClient } from "@supabase/supabase-js";

import { sendTemplatedEmail } from "@/app/api/messages/_send";
import {
  currentQuestionnaireInvite,
  issueQuestionnaireLink,
  sendQuestionnaireToCandidate,
  QUESTIONNAIRE_LINK_NOT_ISSUED,
} from "@/app/api/questionnaires/_send";
import { normalizeAnswerRouting, normalizeReminderConfig } from "@/app/api/_mappers";
import type { Database, Json } from "@/types/database.types";
import type { ScheduledActionRunSummary } from "@/types/api";
import { planAnswerRouting, type RoutingQuestion } from "@/utilities/answer-routing";
import { buildQuestionnaireEmail } from "@/utilities/questionnaire-email";
import { questionnaireEmailFor } from "@/app/api/questionnaires/_emails";
import { DAILY_LIMIT_REASON, nextDailyLimitReset } from "@/utilities/email-limits";
import {
  planScheduledAction,
  type ScheduledActionContext,
} from "@/utilities/scheduled-action-plan";

export const DEFAULT_BATCH_SIZE = 50;

const CLAIMED_ACTION_SELECT =
  "id, application_id, origin_stage_id, kind, reminder_number, questionnaire_response_id, applications!inner(id, position_id, current_stage_id, status, positions(status)), stage_actions(id, type, message_template_id, questionnaire_template_id, target_position_stage_id, reminder_config, message_templates(id, subject, body), target_stage:position_stages!stage_actions_target_position_stage_id_fkey(id, position_id)), questionnaire_responses(id, status, reminders_stopped_at, reminder_config, questionnaire_template_id, on_completion_move_to_stage_id, questionnaire_templates(id, name))";

type Settlement = {
  /** "deferred" puts the action back in the queue for after the daily limit resets. */
  status: "sent" | "failed" | "skipped" | "deferred";
  reason: string | null;
  messageId: string | null;
};

/** Plans that email the candidate, and so wait while the daily limit is reached. */
const SENDS_EMAIL = new Set(["send_email", "send_questionnaire", "send_reminder"]);

function settled(
  status: Settlement["status"],
  reason: string | null = null,
  messageId: string | null = null,
): Settlement {
  return { status, reason, messageId };
}

function toSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

type ClaimedRow = {
  id: string;
  application_id: string;
  origin_stage_id: string | null;
  kind: Database["public"]["Enums"]["scheduled_action_kind"];
  reminder_number: number | null;
  questionnaire_response_id: string | null;
  applications: {
    id: string;
    position_id: string;
    current_stage_id: string | null;
    status: Database["public"]["Enums"]["application_status"];
    positions: { status: Database["public"]["Enums"]["position_status"] } | null;
  } | null;
  stage_actions: {
    id: string;
    type: Database["public"]["Enums"]["stage_action_type"];
    message_template_id: string | null;
    questionnaire_template_id: string | null;
    target_position_stage_id: string | null;
    reminder_config: Json;
    message_templates: { id: string; subject: string | null; body: string | null } | null;
    target_stage: { id: string; position_id: string } | null;
  } | null;
  questionnaire_responses: {
    id: string;
    status: Database["public"]["Enums"]["questionnaire_status"];
    reminders_stopped_at: string | null;
    reminder_config: Json;
    questionnaire_template_id: string;
    on_completion_move_to_stage_id: string | null;
    questionnaire_templates: { id: string; name: string } | null;
  } | null;
};

function toContext(row: ClaimedRow): ScheduledActionContext | null {
  const application = toSingle(row.applications);
  if (!application) return null;

  const action = toSingle(row.stage_actions);
  const response = toSingle(row.questionnaire_responses);

  return {
    kind: row.kind,
    originStageId: row.origin_stage_id,
    application: {
      id: application.id,
      positionId: application.position_id,
      currentStageId: application.current_stage_id,
      archived: application.status === "archived",
      // A missing position cannot happen (the foreign key is required); open
      // is the safe reading, since it only stops a send that would go ahead.
      positionStatus: toSingle(application.positions)?.status ?? "open",
    },
    action: action
      ? {
          id: action.id,
          type: action.type,
          messageTemplateId: action.message_template_id,
          questionnaireTemplateId: action.questionnaire_template_id,
          targetPositionStageId: action.target_position_stage_id,
          targetStagePositionId: toSingle(action.target_stage)?.position_id ?? null,
          reminderConfig: normalizeReminderConfig(action.reminder_config),
        }
      : null,
    questionnaire: response
      ? {
          id: response.id,
          completed: response.status === "completed",
          remindersStopped: response.reminders_stopped_at !== null,
          reminderConfig: normalizeReminderConfig(response.reminder_config),
        }
      : null,
    reminderNumber: row.reminder_number,
  };
}

async function sendAutomatedEmail(
  supabase: SupabaseClient<Database>,
  input: {
    applicationId: string;
    subjectTemplate: string;
    bodyTemplate: string;
    recordedBodyTemplate?: string;
  },
): Promise<Settlement> {
  const result = await sendTemplatedEmail(supabase, {
    applicationId: input.applicationId,
    sender: { origin: "automated" },
    subjectTemplate: input.subjectTemplate,
    bodyTemplate: input.bodyTemplate,
    recordedBodyTemplate: input.recordedBodyTemplate,
    onDailyLimit: "report",
  });

  if (result.outcome === "failed") {
    if (result.limit === "daily") return settled("deferred", result.reason);
    return settled("failed", result.reason, result.messageId);
  }

  return settled("sent", null, result.messageId);
}

async function sendStageActionEmail(
  supabase: SupabaseClient<Database>,
  row: ClaimedRow,
): Promise<Settlement> {
  const template = toSingle(toSingle(row.stage_actions)?.message_templates);
  if (!template) {
    return settled("skipped", "The email template this action sends has been deleted");
  }

  return sendAutomatedEmail(supabase, {
    applicationId: row.application_id,
    subjectTemplate: template.subject ?? "",
    bodyTemplate: template.body ?? "",
  });
}

async function moveCandidateToStage(
  supabase: SupabaseClient<Database>,
  applicationId: string,
  targetPositionStageId: string,
): Promise<Settlement> {
  const { error } = await supabase
    .from("applications")
    .update({ current_stage_id: targetPositionStageId })
    .eq("id", applicationId);

  if (error) return settled("failed", error.message);

  return settled("sent");
}

async function sendQuestionnaire(
  supabase: SupabaseClient<Database>,
  row: ClaimedRow,
  questionnaireTemplateId: string,
): Promise<Settlement> {
  const action = toSingle(row.stage_actions);
  if (!action) return settled("skipped", "The stage action was deleted before it came due");

  const result = await sendQuestionnaireToCandidate(supabase, {
    applicationId: row.application_id,
    questionnaireTemplateId,
    key: { context: "stage_sent", stageActionId: action.id },
    reminderConfig: normalizeReminderConfig(action.reminder_config),
    sender: { origin: "automated" },
    now: new Date(),
    onDailyLimit: "report",
  });

  if (result.outcome === "skipped") return settled("skipped", result.reason);
  if (result.outcome === "failed") {
    if (result.limit === "daily") return settled("deferred", result.reason);
    return settled("failed", result.reason, result.messageId);
  }

  return settled("sent", null, result.messageId);
}

async function sendReminder(
  supabase: SupabaseClient<Database>,
  row: ClaimedRow,
  questionnaireResponseId: string,
): Promise<Settlement> {
  const response = toSingle(row.questionnaire_responses);
  if (!response) {
    return settled("skipped", "The questionnaire this reminder chases no longer exists");
  }

  const invite = currentQuestionnaireInvite();
  if (!invite.available) return settled("skipped", invite.reason);

  const link = await issueQuestionnaireLink(supabase, {
    questionnaireResponseId,
    invite,
    now: new Date(),
  });

  if (!link) return settled("skipped", QUESTIONNAIRE_LINK_NOT_ISSUED);

  // The wording is read now, not when the reminder was queued, so an edit in
  // Settings or on the questionnaire reaches reminders already waiting.
  const { name, text } = await questionnaireEmailFor(
    supabase,
    response.questionnaire_template_id,
    "reminder",
  );
  const email = buildQuestionnaireEmail(text, { name, link });

  return sendAutomatedEmail(supabase, {
    applicationId: row.application_id,
    subjectTemplate: email.subject,
    bodyTemplate: email.sent,
    recordedBodyTemplate: email.recorded,
  });
}

async function routingQuestions(
  supabase: SupabaseClient<Database>,
  questionnaireTemplateId: string,
): Promise<RoutingQuestion[]> {
  const { data } = await supabase
    .from("questions")
    .select("id, sort_order, answer_routing")
    .eq("questionnaire_template_id", questionnaireTemplateId);

  return (data ?? []).map((question) => ({
    id: question.id,
    sortOrder: question.sort_order,
    answerRouting: normalizeAnswerRouting(question.answer_routing),
  }));
}

async function routeAnswers(
  supabase: SupabaseClient<Database>,
  row: ClaimedRow,
  questionnaireResponseId: string,
): Promise<Settlement> {
  const response = toSingle(row.questionnaire_responses);
  const application = toSingle(row.applications);
  if (!response || !application) {
    return settled("skipped", "The questionnaire response this routing was queued for is gone");
  }

  const [questions, answersResult] = await Promise.all([
    routingQuestions(supabase, response.questionnaire_template_id),
    supabase
      .from("answers")
      .select("question_id, value")
      .eq("questionnaire_response_id", questionnaireResponseId),
  ]);

  if (answersResult.error) return settled("failed", answersResult.error.message);

  const plan = planAnswerRouting({
    questions,
    answers: (answersResult.data ?? []).map((answer) => ({
      questionId: answer.question_id,
      value: answer.value,
    })),
    onCompletionPositionStageId: response.on_completion_move_to_stage_id,
  });

  if (plan.kind === "none") {
    return settled("skipped", "No routing rule matched this questionnaire's answers");
  }

  if (plan.kind === "on_completion") {
    return moveCandidateToStage(supabase, row.application_id, plan.positionStageId);
  }

  const { data: resolved, error } = await supabase.rpc("position_stage_for_template_stage", {
    p_position_id: application.position_id,
    p_template_stage_id: plan.pipelineTemplateStageId,
  });

  if (error) return settled("failed", error.message);

  if (!resolved) {
    return settled(
      "skipped",
      "The stage this answer routes to is not on this position, so the candidate was left where they are",
    );
  }

  return moveCandidateToStage(supabase, row.application_id, resolved);
}

async function runOne(
  supabase: SupabaseClient<Database>,
  row: ClaimedRow,
  emailsHeld: boolean,
): Promise<Settlement> {
  const context = toContext(row);
  if (!context) {
    return settled("skipped", "The candidacy this action belonged to no longer exists");
  }

  const plan = planScheduledAction(context);

  if (plan.kind === "skip") return settled("skipped", plan.reason);

  // The relay already refused an email in this run for the daily limit; the
  // rest would be refused too, so they wait without asking again.
  if (emailsHeld && SENDS_EMAIL.has(plan.kind)) return settled("deferred", DAILY_LIMIT_REASON);

  if (plan.kind === "send_email") return sendStageActionEmail(supabase, row);

  if (plan.kind === "send_questionnaire") {
    return sendQuestionnaire(supabase, row, plan.questionnaireTemplateId);
  }

  if (plan.kind === "send_reminder") {
    return sendReminder(supabase, row, plan.questionnaireResponseId);
  }

  if (plan.kind === "route_answers") {
    return routeAnswers(supabase, row, plan.questionnaireResponseId);
  }

  return moveCandidateToStage(supabase, row.application_id, plan.targetPositionStageId);
}

export async function runDueScheduledActions(
  supabase: SupabaseClient<Database>,
  options: { now: Date; batchSize?: number },
): Promise<ScheduledActionRunSummary> {
  const summary: ScheduledActionRunSummary = {
    claimed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
  };
  const heldUntil = nextDailyLimitReset(options.now);
  let emailsHeld = false;

  const { data: claimedIds, error: claimError } = await supabase.rpc(
    "claim_due_scheduled_actions",
    { p_now: options.now.toISOString(), p_limit: options.batchSize ?? DEFAULT_BATCH_SIZE },
  );

  if (claimError) throw new Error(`Could not claim due actions: ${claimError.message}`);
  const ids = claimedIds ?? [];
  if (ids.length === 0) return summary;

  summary.claimed = ids.length;

  const { data: rows, error: readError } = await supabase
    .from("scheduled_actions")
    .select(CLAIMED_ACTION_SELECT)
    .in("id", ids);

  if (readError) throw new Error(`Could not read claimed actions: ${readError.message}`);

  for (const row of rows ?? []) {
    let settlement: Settlement;
    try {
      settlement = await runOne(supabase, row, emailsHeld);
    } catch (error) {
      settlement = settled("failed", error instanceof Error ? error.message : "Unexpected error");
    }

    if (settlement.status === "deferred") {
      emailsHeld = true;
      const { error: deferError } = await supabase.rpc("defer_scheduled_action", {
        p_id: row.id,
        p_until: heldUntil.toISOString(),
        p_now: new Date().toISOString(),
      });
      if (!deferError) summary.deferred += 1;
      continue;
    }

    const { error: settleError } = await supabase.rpc("complete_scheduled_action", {
      p_id: row.id,
      p_status: settlement.status,
      p_now: new Date().toISOString(),
      p_failure_reason: settlement.reason ?? undefined,
      p_message_id: settlement.messageId ?? undefined,
    });

    if (!settleError) summary[settlement.status] += 1;
  }

  return summary;
}
