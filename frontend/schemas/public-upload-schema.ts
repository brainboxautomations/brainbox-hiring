import { z } from "zod";

export const publicUploadRequestSchema = z
  .object({
    bucket: z.enum(["resumes", "videos"]),
    filename: z.string().trim().min(1).max(255),
    // Signed into the upload URL, so the file sent must match both exactly.
    contentType: z.string().trim().max(255).default(""),
    size: z.number().int().positive(),
    positionId: z.uuid().optional(),
    questionnaireToken: z.string().trim().min(1).max(200).optional(),
  })
  .refine((input) => Boolean(input.positionId) !== Boolean(input.questionnaireToken), {
    message: "Name either the position or the questionnaire link, not both",
  });

export type PublicUploadRequest = z.infer<typeof publicUploadRequestSchema>;

export type PublicUploadTicket = {
  storagePath: string;
  /** A signed URL the browser PUTs the file to, directly into storage. */
  uploadUrl: string;
  /** The Content-Type the PUT must send, exactly as it was signed. */
  contentType: string;
};
