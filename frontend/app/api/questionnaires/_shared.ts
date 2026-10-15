import { toAnswerRoutingRows } from "@/app/api/_mappers";
import type { QuestionInputValues, QuestionnaireInputValues } from "@/schemas/questionnaire-schema";
import type { Json } from "@/types/database.types";

export const TEMPLATE_SELECT =
  "id, name, created_at, updated_at, on_completion_template_stage_id, invite_email_mode, invite_subject, invite_body, reminder_email_mode, reminder_subject, reminder_body, questions(id, sort_order, type, prompt, help_text, required, options, video_max_duration, video_allow_retakes, numeric_min, numeric_max, answer_routing)";

export const TEMPLATE_ROW_SELECT =
  "id, name, created_at, updated_at, on_completion_template_stage_id, invite_email_mode, invite_subject, invite_body, reminder_email_mode, reminder_subject, reminder_body";

export const QUESTION_SELECT =
  "id, sort_order, type, prompt, help_text, required, options, video_max_duration, video_allow_retakes, numeric_min, numeric_max, answer_routing";

type EmailChoiceColumns = {
  invite_email_mode?: string;
  invite_subject?: string | null;
  invite_body?: string | null;
  reminder_email_mode?: string;
  reminder_subject?: string | null;
  reminder_body?: string | null;
};

/**
 * The invite and reminder choices as columns. A choice left out of the request
 * is left out here too, so an edit that does not mention it keeps it. Custom
 * wording is kept when switching back to the default, so switching again
 * brings it back.
 */
export function toEmailChoiceColumns(input: QuestionnaireInputValues): EmailChoiceColumns {
  const columns: EmailChoiceColumns = {};

  if (input.inviteEmail) {
    columns.invite_email_mode = input.inviteEmail.mode;
    if (input.inviteEmail.mode === "custom") {
      columns.invite_subject = input.inviteEmail.subject;
      columns.invite_body = input.inviteEmail.body;
    }
  }

  if (input.reminderEmail) {
    columns.reminder_email_mode = input.reminderEmail.mode;
    if (input.reminderEmail.mode === "custom") {
      columns.reminder_subject = input.reminderEmail.subject;
      columns.reminder_body = input.reminderEmail.body;
    }
  }

  return columns;
}

export type QuestionInsertRow = {
  questionnaire_template_id: string;
  sort_order: number;
  type: QuestionInputValues["type"];
  prompt: string;
  help_text: string | null;
  required: boolean;
  options: Json;
  video_max_duration: number | null;
  video_allow_retakes: boolean | null;
  numeric_min: number | null;
  numeric_max: number | null;
  answer_routing: Json;
};

export function toQuestionRow(
  question: QuestionInputValues,
  questionnaireTemplateId: string,
  sortOrder: number,
): QuestionInsertRow {
  const isVideo = question.type === "video";
  const isNumeric = question.type === "numeric";

  return {
    questionnaire_template_id: questionnaireTemplateId,
    sort_order: sortOrder,
    type: question.type,
    prompt: question.prompt,
    help_text: question.helpText ?? null,
    required: question.required,
    options: question.options,
    video_max_duration: isVideo ? (question.videoMaxDuration ?? null) : null,
    video_allow_retakes: isVideo ? (question.videoAllowRetakes ?? null) : null,
    numeric_min: isNumeric ? (question.numericMin ?? null) : null,
    numeric_max: isNumeric ? (question.numericMax ?? null) : null,
    answer_routing: toAnswerRoutingRows(question.answerRouting),
  };
}
