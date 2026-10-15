import { z } from "zod";

export const MAX_BULK_SELECTION = 500;

const applicationIdList = z
  .array(z.uuid("Every selected candidate must be identified by a uuid"))
  .min(1, "Select at least one candidate")
  .max(MAX_BULK_SELECTION, `A bulk action can cover at most ${MAX_BULK_SELECTION} candidates`);

export const bulkCandidateUpdateSchema = z.object({
  applicationIds: applicationIdList,

  patch: z
    .object({
      stageId: z.uuid("stageId must be a uuid").optional(),
      status: z.enum(["active", "archived"]).optional(),
    })
    .refine(
      (patch) => patch.stageId !== undefined || patch.status !== undefined,
      "Choose a stage to move to, or archive",
    ),
});

export const bulkCandidateExportSchema = z.object({
  applicationIds: applicationIdList,
});

export const bulkCandidateEmailSchema = z.object({
  applicationIds: applicationIdList,

  messageTemplateId: z.uuid("Choose the template this email sends"),
});

export const bulkCandidateQuestionnaireSchema = z.object({
  applicationIds: applicationIdList,

  questionnaireTemplateId: z.uuid("Choose the questionnaire this send covers"),
  sendReminders: z.boolean(),
});

export type BulkCandidateUpdateValues = z.infer<typeof bulkCandidateUpdateSchema>;
export type BulkCandidateExportValues = z.infer<typeof bulkCandidateExportSchema>;
export type BulkCandidateEmailValues = z.infer<typeof bulkCandidateEmailSchema>;
export type BulkCandidateQuestionnaireValues = z.infer<typeof bulkCandidateQuestionnaireSchema>;
