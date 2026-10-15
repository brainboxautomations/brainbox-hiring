"use client";

import { useState } from "react";

import { Card } from "@/components/atoms/card";
import { ErrorAlert } from "@/components/molecules/error-alert";
import { ReportDashboardSkeleton } from "@/components/molecules/report-dashboard-skeleton";
import { useMonthlyReport } from "@/hooks/use-reports";
import type { MonthlyReport, ReportPosition } from "@/types/api";
import { apiErrorMessage } from "@/utilities/api-error";
import {
  barHeightPercent,
  formatReportMonth,
  largestValue,
  weekBucketLabel,
} from "@/utilities/report-month";
import { MonthFilter } from "./month-filter";
import { BarChart3 } from "lucide-react";

const WEEK_BAR_MAX_HEIGHT_PX = 130;

const STAGE_BAR_COLOR = "#3D63DD";

function EmptyChartIcon() {
  return <BarChart3 size={22} aria-hidden="true" />;
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="rounded-xl px-[18px] py-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1.5 text-[28px] font-semibold tracking-[-0.02em]">{value}</div>
    </Card>
  );
}

function WeeklyChart({ report }: { report: MonthlyReport }) {
  const tallest = largestValue(report.weeks.map((week) => week.applicationsReceived));

  return (
    <Card className="rounded-[14px] p-5">
      <div className="mb-0.5 text-sm font-semibold">Applications received</div>
      <div className="mb-5 text-xs text-slate-400">By week — W4 runs from day 22 to month end</div>
      <div className="flex h-[160px] items-end gap-[14px] pl-1">
        {report.weeks.map((week) => (
          <div
            key={week.weekNumber}
            className="flex h-full flex-1 flex-col items-center justify-end gap-2"
          >
            <span className="text-xs font-semibold text-slate-700">
              {week.applicationsReceived}
            </span>
            <div
              className="w-full max-w-[46px] rounded-t-[7px]"
              style={{
                height: `${Math.round((barHeightPercent(week.applicationsReceived, tallest) / 100) * WEEK_BAR_MAX_HEIGHT_PX)}px`,
                background: "linear-gradient(180deg,#4790f0,#3d63dd)",
              }}
            />
            <span className="font-mono text-[11px] text-slate-400">
              {weekBucketLabel(week.weekNumber)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PositionStageChart({ position }: { position: ReportPosition }) {
  const tallest = largestValue(position.stages.map((stage) => stage.applications));

  return (
    <Card className="rounded-[14px] p-5">
      <div className="mb-0.5 flex items-baseline justify-between gap-4">
        <div className="truncate text-sm font-semibold">{position.title}</div>
        <div className="shrink-0 font-mono text-xs text-slate-500">
          {position.applicationsReceived} applied
        </div>
      </div>
      <div className="mb-[18px] text-xs text-slate-400">
        Where this month&rsquo;s applicants stand now
      </div>
      {position.stages.length === 0 ? (
        <div className="text-[13px] text-slate-400">
          Every applicant this month has been archived.
        </div>
      ) : (
        <section aria-label={`Stages for ${position.title}`} className="flex flex-col gap-[13px]">
          {position.stages.map((stage) => (
            <div key={stage.stageId ?? stage.name}>
              <div className="mb-[5px] flex items-center justify-between">
                <span className="flex items-center gap-[7px] text-xs text-slate-600">
                  <span
                    className="h-[7px] w-[7px] rounded-full"
                    style={{ background: STAGE_BAR_COLOR }}
                  />
                  {stage.name}
                </span>
                <span className="font-mono text-xs font-semibold text-slate-700">
                  {stage.applications}
                </span>
              </div>
              <div className="h-[7px] overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-[7px] rounded-full"
                  style={{
                    width: `${barHeightPercent(stage.applications, tallest)}%`,
                    background: STAGE_BAR_COLOR,
                  }}
                />
              </div>
            </div>
          ))}
        </section>
      )}
    </Card>
  );
}

function ArchivedFootnote({ archived }: { archived: number }) {
  if (archived === 0) return null;

  return (
    <p className="mt-2.5 text-[11px] leading-relaxed text-slate-400">
      {archived} archived {archived === 1 ? "application is" : "applications are"} counted in
      applications received but left out of the stage counts, matching the board, which hides
      archived candidates.
    </p>
  );
}

function ReportBody({ report }: { report: MonthlyReport }) {
  return (
    <>
      <section aria-label="Key figures" className="mb-3.5 grid grid-cols-4 gap-3">
        <KpiCard label="Applications received" value={report.totals.applicationsReceived} />
      </section>

      <div className="mb-3.5">
        <WeeklyChart report={report} />
      </div>

      <section aria-label="Candidates by stage" className="grid grid-cols-2 gap-3">
        {report.positions.map((position) => (
          <PositionStageChart key={position.positionId} position={position} />
        ))}
      </section>

      <ArchivedFootnote archived={report.totals.archived} />
    </>
  );
}

function EmptyMonth({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center rounded-[14px] border border-slate-200 bg-white px-5 py-[72px] text-center">
      <div className="mb-4 flex h-[46px] w-[46px] items-center justify-center rounded-xl bg-slate-100 text-slate-400">
        <EmptyChartIcon />
      </div>
      <div className="mb-[5px] text-[15px] font-semibold">No activity in {label}</div>
      <div className="max-w-[340px] text-[13px] leading-relaxed text-slate-500">
        No applications were received this month. Pick another month to see data.
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const { data: report, isLoading, isError, error } = useMonthlyReport(selectedMonth);

  const month = report?.month ?? selectedMonth;
  const label = month ? formatReportMonth(month) : "This month";

  return (
    <div className="mx-auto max-w-[1100px] px-8 pb-16 pt-7">
      <div className="mb-[22px] flex items-end justify-between gap-5">
        <div>
          <h1 className="mb-1 text-2xl font-semibold tracking-[-0.02em]">Reports</h1>
          <p className="text-[13px] text-slate-500">Hiring activity for the selected month.</p>
        </div>
        <MonthFilter
          label={label}
          selectedMonth={month}
          months={report?.availableMonths ?? []}
          onSelect={setSelectedMonth}
        />
      </div>

      {isLoading && (
        <div role="status">
          <span className="sr-only">Loading this month&rsquo;s figures…</span>
          <ReportDashboardSkeleton />
        </div>
      )}

      {isError && (
        <ErrorAlert
          title="Couldn’t load the report"
          message={apiErrorMessage(error, "The figures for this month could not be read.")}
        />
      )}

      {report &&
        (report.totals.applicationsReceived === 0 ? (
          <EmptyMonth label={label} />
        ) : (
          <ReportBody report={report} />
        ))}
    </div>
  );
}
