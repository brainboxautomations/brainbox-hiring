import { z } from "zod";

export const MAX_ANSWER_TEXT_LENGTH = 10_000;
export const MAX_ANSWER_CHOICE_LENGTH = 500;
export const MAX_ANSWER_CHOICES = 100;
export const MAX_TEXT_ANSWERS = 200;
export const MAX_UPLOADS = 20;
export const MAX_VIDEO_ANSWERS = 20;
export const MAX_FILE_KEY_LENGTH = 200;
export const MAX_STORAGE_PATH_LENGTH = 512;
export const MAX_FILENAME_LENGTH = 255;
export const MAX_MIME_TYPE_LENGTH = 120;
export const MAX_VIDEO_URL_LENGTH = 2048;

export const answerValueSchema = z.union([
  z.string().max(MAX_ANSWER_TEXT_LENGTH, "That answer is too long"),
  z.number(),
  z
    .array(z.string().max(MAX_ANSWER_CHOICE_LENGTH, "That choice is too long"))
    .max(MAX_ANSWER_CHOICES, "Too many choices were selected"),
]);

/**
 * A file the candidate's browser has already put in Storage, described by where
 * it landed rather than carried in the request.
 *
 * The resume used to travel inside the submit request, and the host rejects
 * request bodies over roughly 6 MB before the route ever runs — with an empty
 * reply, so the candidate saw only "Something went wrong" after filling in
 * everything. Uploading straight to Storage (as video answers always have)
 * keeps the request small whatever the file size. The route must still check
 * the path belongs to this position: it arrives from the client.
 */
export const uploadedFileFields = {
  storagePath: z.string().min(1).max(MAX_STORAGE_PATH_LENGTH),
  filename: z.string().max(MAX_FILENAME_LENGTH).optional(),
  mimeType: z.string().max(MAX_MIME_TYPE_LENGTH).optional(),
};

export const textAnswerSchema = z.object({
  questionId: z.uuid(),
  value: answerValueSchema,
});

export const videoAnswerSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("upload"),
    questionId: z.uuid(),
    storagePath: z.string().min(1).max(MAX_STORAGE_PATH_LENGTH),
    filename: z.string().max(MAX_FILENAME_LENGTH).optional(),
    mimeType: z.string().max(MAX_MIME_TYPE_LENGTH).optional(),
  }),
  z.object({
    source: z.literal("link"),
    questionId: z.uuid(),
    url: z.url().max(MAX_VIDEO_URL_LENGTH),
  }),
]);

export type CandidateVideoAnswer = z.infer<typeof videoAnswerSchema>;
