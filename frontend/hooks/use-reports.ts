"use client";

import { useQuery } from "@tanstack/react-query";

import { ReportsService } from "@/services/reports-service";

export function useMonthlyReport(month: string | null) {
  return useQuery({
    queryKey: ["reports", "monthly", month],
    queryFn: () => ReportsService.monthly(month),
  });
}
