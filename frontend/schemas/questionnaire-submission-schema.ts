import { z } from "zod";

import {
  MAX_FILE_KEY_LENGTH,
  MAX_TEXT_ANSWERS,
  MAX_UPLOADS,
  MAX_VIDEO_ANSWERS,
  textAnswerSchema,
  videoAnswerSchema,
} from "@/schemas/candidate-answer-schema";

export const MAX_TOKEN_LENGTH = 200;

const uploadSchema = z.object({
  questionId: z.uuid(),
  fileKey: z.string().min(1).max(MAX_FILE_KEY_LENGTH),
});

export const questionnaireSubmissionSchema = z.object({
  token: z.string().trim().min(1, "This questionnaire link is not valid").max(MAX_TOKEN_LENGTH),

  textAnswers: z.array(textAnswerSchema).max(MAX_TEXT_ANSWERS).default([]),
  uploads: z.array(uploadSchema).max(MAX_UPLOADS, "Too many files were attached").default([]),
  videoAnswers: z.array(videoAnswerSchema).max(MAX_VIDEO_ANSWERS).default([]),
});

export type QuestionnaireSubmissionValues = z.infer<typeof questionnaireSubmissionSchema>;
