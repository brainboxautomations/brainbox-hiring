import { z } from "zod";

export const positionLocationSchema = z.object({
  country: z.string().trim().min(1),
  detail: z.string().trim().optional(),
});

export const fieldSettingSchema = z.enum(["required", "optional", "disabled"]);

const nullableString = z.string().trim().nullish();
const nullableNumber = z.number().nullish();

export const positionInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  department: nullableString,
  locations: z.array(positionLocationSchema).optional(),
  remoteFlag: z.boolean().optional(),
  positionType: nullableString,
  educationLevel: nullableString,
  educationLevelRequired: z.boolean().optional(),
  experienceLevel: nullableString,
  salaryFrom: nullableNumber,
  salaryTo: nullableNumber,
  salaryPeriod: z.enum(["year", "month"]).nullish(),
  salaryCurrency: nullableString,
  description: nullableString,
  publishMode: z.enum(["listed", "unlisted", "disabled"]).optional(),
  applicationFormConfig: z.record(z.string(), fieldSettingSchema).optional(),
  applicationQuestionnaireId: z.uuid().nullish(),
  assignedPipelineId: z.uuid().nullish(),
  emailSenderName: nullableString,
  hiringTeam: z.array(z.string()).optional(),

  status: z.enum(["draft", "open"]).optional(),
});

export type PositionInputValues = z.infer<typeof positionInputSchema>;

export const SALARY_RANGE_MESSAGE = "Salary maximum must be at least the minimum";

type SalaryRange = { salaryFrom?: number | null; salaryTo?: number | null };

export function salaryRangeOrdered({ salaryFrom, salaryTo }: SalaryRange): boolean {
  if (typeof salaryFrom !== "number" || typeof salaryTo !== "number") return true;
  return salaryFrom <= salaryTo;
}

export const SALARY_RANGE_REFINEMENT = {
  message: SALARY_RANGE_MESSAGE,
  path: ["salaryTo"],
};

export const positionCreateSchema = positionInputSchema.refine(
  salaryRangeOrdered,
  SALARY_RANGE_REFINEMENT,
);
