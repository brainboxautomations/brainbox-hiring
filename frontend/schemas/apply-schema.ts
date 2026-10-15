import { z } from "zod";

import {
  MAX_TEXT_ANSWERS,
  MAX_UPLOADS,
  MAX_VIDEO_ANSWERS,
  textAnswerSchema,
  uploadedFileFields,
  videoAnswerSchema,
} from "@/schemas/candidate-answer-schema";

export const MAX_NAME_LENGTH = 100;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_PHONE_LENGTH = 40;
export const MAX_FORM_FIELD_KEY_LENGTH = 100;
export const MAX_FORM_ANSWER_LENGTH = 5_000;
export const MAX_FORM_ANSWERS = 50;

// Both the resume and file answers are uploaded by the browser and arrive as
// storage paths. Video answers are not here: they have always had their own
// `videoAnswers` list, so a question upload is only ever a file question.
const uploadSchema = z.discriminatedUnion("slot", [
  z.object({ slot: z.literal("resume"), ...uploadedFileFields }),
  z.object({ slot: z.literal("question"), questionId: z.uuid(), ...uploadedFileFields }),
]);

const formAnswersSchema = z
  .record(
    z.string().max(MAX_FORM_FIELD_KEY_LENGTH),
    z.string().max(MAX_FORM_ANSWER_LENGTH, "That answer is too long"),
  )
  .refine(
    (answers) => Object.keys(answers).length <= MAX_FORM_ANSWERS,
    "That application form has too many answers",
  );

export const applyPayloadSchema = z.object({
  positionId: z.uuid(),
  firstName: z.string().trim().min(1, "First name is required").max(MAX_NAME_LENGTH),
  lastName: z.string().trim().max(MAX_NAME_LENGTH).optional(),
  email: z.string().trim().max(MAX_EMAIL_LENGTH).email("Enter a valid email address"),
  phone: z.string().trim().max(MAX_PHONE_LENGTH).optional(),

  formAnswers: formAnswersSchema.default({}),

  questionnaireTextAnswers: z.array(textAnswerSchema).max(MAX_TEXT_ANSWERS).default([]),
  uploads: z.array(uploadSchema).max(MAX_UPLOADS, "Too many files were attached").default([]),

  videoAnswers: z.array(videoAnswerSchema).max(MAX_VIDEO_ANSWERS).default([]),
});

export type ApplyPayload = z.infer<typeof applyPayloadSchema>;
export type ApplyUpload = z.infer<typeof uploadSchema>;
export type ApplyVideoAnswer = z.infer<typeof videoAnswerSchema>;
