import type {
  QuestionnaireEmailChoice,
  QuestionnaireEmailSettings,
  QuestionnaireEmailText,
} from "@/types/api";

/**
 * The questionnaire invite and its reminder. The wording comes from Settings
 * (the default) or from the questionnaire itself (custom), and uses the usual
 * merge variables plus {{questionnaire.name}} and {{questionnaire.link}}.
 */

export type QuestionnaireLink = {
  url: string;
  expiresAt: Date;
};

export type QuestionnaireEmailKind = "invite" | "reminder";

export type QuestionnaireEmailDefaults = QuestionnaireEmailSettings;

export type { QuestionnaireEmailChoice, QuestionnaireEmailText };

export type BuiltQuestionnaireEmail = {
  subject: string;
  /** What the candidate receives, with their link. */
  sent: string;
  /** What the thread keeps: the link is single-use and never stored. */
  recorded: string;
};

export const QUESTIONNAIRE_NAME_TOKEN = "{{questionnaire.name}}";
export const QUESTIONNAIRE_LINK_TOKEN = "{{questionnaire.link}}";
export const QUESTIONNAIRE_LINK_LABEL = "Open the questionnaire";

/** The wording the app used before it became editable; also what "Reset" restores. Matches 0057. */
export const ORIGINAL_QUESTIONNAIRE_EMAILS: QuestionnaireEmailDefaults = {
  invite: {
    subject: "{{position.title}} — {{questionnaire.name}}",
    body: [
      "Hi {{candidate.first_name}},",
      "",
      "The next step for the {{position.title}} role is **{{questionnaire.name}}**.",
      "",
      QUESTIONNAIRE_LINK_TOKEN,
      "",
      "Thanks,",
      "{{company.name}}",
    ].join("\n"),
  },
  reminder: {
    subject: "Reminder: {{questionnaire.name}}",
    body: [
      "Hi {{candidate.first_name}},",
      "",
      "This is an automated reminder regarding the **{{questionnaire.name}}** step for the {{position.title}} role.",
      "",
      "We have not received your response yet.",
      "",
      QUESTIONNAIRE_LINK_TOKEN,
      "",
      "Thanks,",
      "{{company.name}}",
    ].join("\n"),
  },
};

const NAME_PATTERN = /\{\{\s*questionnaire\.name\s*(?:\|[^{}]*)?\}\}/gi;
const LINK_PATTERN = /\{\{\s*questionnaire\.link\s*(?:\|[^{}]*)?\}\}/gi;

const EXPIRY_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function questionnaireLinkNote(expiresAt: Date): string {
  return `A single-use questionnaire link was emailed to the candidate. The link is not kept here; it expires on ${EXPIRY_DATE.format(expiresAt)}.`;
}

function filled(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** The questionnaire's own wording when it has custom wording, the default otherwise. */
export function pickQuestionnaireEmail(
  choice: QuestionnaireEmailChoice,
  fallback: QuestionnaireEmailText,
): QuestionnaireEmailText {
  if (choice.mode === "custom" && filled(choice.subject) && filled(choice.body)) {
    return { subject: choice.subject, body: choice.body };
  }
  return fallback;
}

export function questionnaireEmailLeavesOutLink(body: string): boolean {
  return !new RegExp(LINK_PATTERN.source, "i").test(body);
}

/**
 * Fills in the questionnaire's name and link. The other merge variables are
 * left for the send, which resolves them for the candidate. A body without the
 * link variable gets the link at the end, so a candidate never receives an
 * invitation they cannot open.
 */
export function buildQuestionnaireEmail(
  text: QuestionnaireEmailText,
  questionnaire: { name: string; link: QuestionnaireLink },
): BuiltQuestionnaireEmail {
  const withName = (value: string) => value.replace(NAME_PATTERN, () => questionnaire.name);

  const body = questionnaireEmailLeavesOutLink(text.body)
    ? `${text.body.trimEnd()}\n\n${QUESTIONNAIRE_LINK_TOKEN}`
    : text.body;

  const link = `[${QUESTIONNAIRE_LINK_LABEL}](${questionnaire.link.url})`;
  const note = questionnaireLinkNote(questionnaire.link.expiresAt);

  return {
    subject: withName(text.subject).replace(LINK_PATTERN, "").trim(),
    sent: withName(body).replace(LINK_PATTERN, () => link),
    recorded: withName(body).replace(LINK_PATTERN, () => note),
  };
}
