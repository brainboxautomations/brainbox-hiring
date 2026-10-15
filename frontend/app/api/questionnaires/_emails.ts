import type { SupabaseClient } from "@supabase/supabase-js";

import type { QuestionnaireEmailSettings } from "@/types/api";
import type { Database } from "@/types/database.types";
import {
  ORIGINAL_QUESTIONNAIRE_EMAILS,
  pickQuestionnaireEmail,
  type QuestionnaireEmailKind,
  type QuestionnaireEmailText,
} from "@/utilities/questionnaire-email";

/**
 * The default invite and reminder from Settings. The row is created by 0057;
 * if it cannot be read, the original wording is used so a send never stops
 * over its wording.
 */
export async function readQuestionnaireEmailDefaults(
  supabase: SupabaseClient<Database>,
): Promise<QuestionnaireEmailSettings> {
  const { data } = await supabase
    .from("questionnaire_email_settings")
    .select("invite_subject, invite_body, reminder_subject, reminder_body")
    .maybeSingle();

  if (!data) return ORIGINAL_QUESTIONNAIRE_EMAILS;

  return {
    invite: { subject: data.invite_subject, body: data.invite_body },
    reminder: { subject: data.reminder_subject, body: data.reminder_body },
  };
}

/** The questionnaire's name and the wording to use for one of its emails. */
export async function questionnaireEmailFor(
  supabase: SupabaseClient<Database>,
  questionnaireTemplateId: string,
  kind: QuestionnaireEmailKind,
): Promise<{ name: string; text: QuestionnaireEmailText }> {
  const [defaults, { data }] = await Promise.all([
    readQuestionnaireEmailDefaults(supabase),
    supabase
      .from("questionnaire_templates")
      .select(
        "name, invite_email_mode, invite_subject, invite_body, reminder_email_mode, reminder_subject, reminder_body",
      )
      .eq("id", questionnaireTemplateId)
      .maybeSingle(),
  ]);

  const choice =
    kind === "invite"
      ? { mode: data?.invite_email_mode, subject: data?.invite_subject, body: data?.invite_body }
      : {
          mode: data?.reminder_email_mode,
          subject: data?.reminder_subject,
          body: data?.reminder_body,
        };

  return {
    name: data?.name ?? "questionnaire",
    text: pickQuestionnaireEmail(
      {
        mode: choice.mode === "custom" ? "custom" : "default",
        subject: choice.subject ?? null,
        body: choice.body ?? null,
      },
      defaults[kind],
    ),
  };
}
