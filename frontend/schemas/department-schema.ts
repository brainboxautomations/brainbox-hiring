import { z } from "zod";

/** Matches the length check on `departments.name` (migration 0050). */
export const MAX_DEPARTMENT_NAME_LENGTH = 60;

export const departmentInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a department name")
    .max(MAX_DEPARTMENT_NAME_LENGTH, `Keep it under ${MAX_DEPARTMENT_NAME_LENGTH + 1} characters`),
});

export type DepartmentInput = z.infer<typeof departmentInputSchema>;
