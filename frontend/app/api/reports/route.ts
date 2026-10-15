import { NextResponse, type NextRequest } from "next/server";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapReportPositions, mapReportTotals, mapReportWeek } from "@/app/api/_mappers";
import { reportQuerySchema } from "@/schemas/report-schema";
import type { MonthlyReport } from "@/types/api";
import {
  currentReportMonth,
  reportMonthFromDate,
  reportMonthToDate,
} from "@/utilities/report-month";

export async function GET(request: NextRequest) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const parsed = reportQuerySchema.safeParse({
    month: request.nextUrl.searchParams.get("month"),
  });
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid month", 422);
  }

  const now = new Date();
  const month = parsed.data.month ?? currentReportMonth(now);
  const monthDate = reportMonthToDate(month);

  try {
    const [months, totals, weeks, positions, positionStages] = await Promise.all([
      supabase.rpc("report_available_months", { p_now: now.toISOString() }),
      supabase.rpc("report_monthly_totals", { p_month: monthDate }),
      supabase.rpc("report_monthly_weeks", { p_month: monthDate }),
      supabase.rpc("report_monthly_positions", { p_month: monthDate }),
      supabase.rpc("report_monthly_position_stages", { p_month: monthDate }),
    ]);

    const failure =
      months.error ??
      totals.error ??
      weeks.error ??
      positions.error ??
      positionStages.error ??
      null;
    if (failure) return apiError(failure.message, 500);

    const offered = (months.data ?? []).map((row) => reportMonthFromDate(row.month));
    const availableMonths = [...new Set([...offered, month])].sort().reverse();

    const report: MonthlyReport = {
      month,
      availableMonths,
      totals: mapReportTotals((totals.data ?? [])[0] ?? null),
      weeks: (weeks.data ?? []).map(mapReportWeek),
      positions: mapReportPositions(positions.data ?? [], positionStages.data ?? []),
    };

    return NextResponse.json({ report });
  } catch (error) {
    return apiUnexpected(error);
  }
}
