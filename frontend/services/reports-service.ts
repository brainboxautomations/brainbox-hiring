import { HttpClient } from "@/services/http-client";
import type { MonthlyReport } from "@/types/api";

export const ReportsService = {
  monthly: (month: string | null) =>
    HttpClient.get<{ report: MonthlyReport }>("/reports", {
      params: month ? { month } : undefined,
    }).then((r) => r.report),
};
