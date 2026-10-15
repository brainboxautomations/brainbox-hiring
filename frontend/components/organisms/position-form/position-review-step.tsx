"use client";

import type { PositionFormStepKey } from "./position-form-steps";
import { APPLICATION_METHODS, type PositionFormValues } from "./position-form-values";

type PositionReviewStepProps = {
  values: PositionFormValues;
  pipelineName: string | null;
  stageCount: number;
  questionnaireName: string;
  onEditStep: (key: PositionFormStepKey) => void;
};

type ReviewCard = {
  title: string;
  step: PositionFormStepKey;
  rows: { label: string; value: string }[];
};

function describeLocations(values: PositionFormValues): string {
  if (values.locations.length === 0) return "None";
  return values.locations
    .map((location) => location.country + (location.detail ? ` · ${location.detail}` : ""))
    .join(", ");
}

function describeMethod(values: PositionFormValues): string {
  return APPLICATION_METHODS.find((method) => method.id === values.publishMode)?.title ?? "Listed";
}

export function PositionReviewStep({
  values,
  pipelineName,
  stageCount,
  questionnaireName,
  onEditStep,
}: PositionReviewStepProps) {
  const cards: ReviewCard[] = [
    {
      title: "Details",
      step: "details",
      rows: [
        { label: "Title", value: values.title || "Untitled" },
        { label: "Department", value: values.department || "—" },
        { label: "Location", value: describeLocations(values) },
        { label: "Remote", value: values.remoteFlag ? "Yes" : "No" },
        { label: "Type", value: values.positionType || "—" },
        {
          label: "Salary",
          value: `${values.salaryCurrency} ${values.salaryFrom}–${values.salaryTo} / ${values.salaryPeriod}`,
        },
      ],
    },
    {
      title: "Description",
      step: "description",
      rows: [
        {
          label: "Job description",
          value: values.description.trim()
            ? `Provided · ~${values.description.trim().split(/\s+/).length} words`
            : "Not provided",
        },
      ],
    },
    {
      title: "Application",
      step: "application",
      rows: [
        { label: "Method", value: describeMethod(values) },
        { label: "Required fields", value: "Name, Email, Resume Upload" },
        {
          label: "Questionnaire",
          value:
            questionnaireName + (values.applicationQuestionnaireId ? " · shown on Experience" : ""),
        },
      ],
    },
    {
      title: "Pipeline",
      step: "pipeline",
      rows: [
        { label: "Template", value: pipelineName ?? "None selected" },
        { label: "Stages", value: `${stageCount} stages` },
        { label: "Email sender", value: values.emailSenderName || "—" },
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {cards.map((card) => (
        <div key={card.title} className="rounded-xl border border-slate-200 bg-white p-4 px-4.5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-slate-900">{card.title}</span>
            <button
              type="button"
              aria-label={`Edit ${card.title}`}
              onClick={() => onEditStep(card.step)}
              className="text-xs font-medium text-accent-11 hover:underline"
            >
              Edit
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {card.rows.map((row) => (
              <div key={row.label} className="flex items-baseline gap-3">
                <span className="w-32.5 shrink-0 text-xs text-slate-400">{row.label}</span>
                <span className="text-[13px] text-slate-700">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
