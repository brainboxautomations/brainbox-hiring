import { z } from "zod";

export const questionTypeSchema = z.enum([
  "short_text",
  "long_text",
  "single_choice",
  "multi_choice",
  "dropdown",
  "numeric",
  "video",
  "file",
  "date",
  "yes_no",
]);

export const CHOICE_QUESTION_TYPES = ["single_choice", "multi_choice", "dropdown"] as const;

export const questionOptionSchema = z.object({
  value: z.string().trim().min(1),
  label: z.string().trim().min(1),
});

export const answerRoutingRuleSchema = z.object({
  optionValue: z.string().trim().min(1),
  pipelineTemplateStageId: z.uuid("Answer routing must name a pipeline stage"),
});

export const questionInputSchema = z
  .object({
    id: z.uuid().optional(),
    type: questionTypeSchema,
    prompt: z.string().trim().min(1, "Question prompt is required"),
    helpText: z.string().trim().nullish(),
    required: z.boolean().default(false),

    options: z.array(questionOptionSchema).default([]),

    videoMaxDuration: z.number().int().positive().nullish(),
    videoAllowRetakes: z.boolean().nullish(),

    numericMin: z.number().nullish(),
    numericMax: z.number().nullish(),

    answerRouting: z.array(answerRoutingRuleSchema).default([]),
  })
  .refine(
    (question) =>
      question.numericMin === null ||
      question.numericMin === undefined ||
      question.numericMax === null ||
      question.numericMax === undefined ||
      question.numericMin <= question.numericMax,
    { message: "The minimum must not be greater than the maximum", path: ["numericMin"] },
  )
  .refine(
    (question) =>
      question.answerRouting.length === 0 ||
      (CHOICE_QUESTION_TYPES as readonly string[]).includes(question.type),
    { message: "Only choice questions can route on an answer", path: ["answerRouting"] },
  )
  .refine(
    (question) =>
      question.answerRouting.every((rule) =>
        question.options.some((option) => option.value === rule.optionValue),
      ),
    { message: "Answer routing must name an option this question offers", path: ["answerRouting"] },
  );

const emailText = (label: string) =>
  z
    .string()
    .trim()
    .max(20_000, `${label} is too long`)
    .nullish()
    .transform((v) => v || null);

export const questionnaireEmailChoiceSchema = z
  .object({
    mode: z.enum(["default", "custom"]),
    subject: emailText("The subject"),
    body: emailText("The email"),
  })
  .refine((choice) => choice.mode === "default" || (choice.subject && choice.body), {
    message: "Custom wording needs a subject and an email",
  });

export const DEFAULT_QUESTIONNAIRE_EMAIL_CHOICE = {
  mode: "default" as const,
  subject: null,
  body: null,
};

export const questionnaireInputSchema = z.object({
  name: z.string().trim().min(1, "Questionnaire name is required"),

  questions: z.array(questionInputSchema).default([]),

  onCompletionTemplateStageId: z.uuid().nullish(),

  inviteEmail: questionnaireEmailChoiceSchema.optional(),
  reminderEmail: questionnaireEmailChoiceSchema.optional(),
});

const requiredText = (label: string) =>
  z.string().trim().min(1, `${label} is required`).max(20_000, `${label} is too long`);

export const questionnaireEmailSettingsSchema = z.object({
  invite: z.object({
    subject: requiredText("The invite subject"),
    body: requiredText("The invite email"),
  }),
  reminder: z.object({
    subject: requiredText("The reminder subject"),
    body: requiredText("The reminder email"),
  }),
});

export type QuestionnaireEmailSettingsInput = z.infer<typeof questionnaireEmailSettingsSchema>;

export const questionnaireReminderUpdateSchema = z.object({
  remindersStopped: z.boolean(),
});

export type QuestionnaireReminderUpdateValues = z.infer<typeof questionnaireReminderUpdateSchema>;

export type QuestionnaireInputValues = z.infer<typeof questionnaireInputSchema>;
export type QuestionInputValues = z.infer<typeof questionInputSchema>;
