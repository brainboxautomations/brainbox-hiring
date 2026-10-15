import { z } from "zod";

export const MAX_TEMPLATE_NAME_LENGTH = 120;
export const MAX_SUBJECT_LENGTH = 300;
export const MAX_BODY_LENGTH = 100_000;

export const messageTemplateInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Template name is required")
    .max(MAX_TEMPLATE_NAME_LENGTH, "Template name is too long"),

  subject: z.string().trim().max(MAX_SUBJECT_LENGTH, "Subject is too long").default(""),

  body: z.string().max(MAX_BODY_LENGTH, "Body is too long").default(""),
});

export type MessageTemplateInputValues = z.infer<typeof messageTemplateInputSchema>;
