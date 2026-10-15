import { z } from "zod";

import { REPORT_MONTH_PATTERN } from "@/utilities/report-month";

export const reportQuerySchema = z.object({
  month: z
    .string()
    .regex(REPORT_MONTH_PATTERN, "month must look like 2026-06")
    .nullish()
    .transform((value) => value ?? null),
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;
