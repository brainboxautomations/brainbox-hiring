"use client";

import { useEffect } from "react";

import { CloseIcon } from "@/components/atoms/icons";
import { MarkdownContent } from "@/components/molecules/markdown-content";
import { APPLY_FIELD_DEFS } from "@/utilities/application-form-fields";
import { parseSalary, type PositionFormValues } from "./position-form-values";

type PositionPreviewProps = {
  values: PositionFormValues;
  onClose: () => void;
};

/**
 * The second half of what a candidate sees: the form behind "Apply for this
 * role", on its own route in the real site. Without it the Application step is
 * the one step of the wizard this preview says nothing about, even though the
 * Preview button sits on that step like every other.
 *
 * Name and email are always collected (the Application step locks them); the
 * rest follow the per-position required / optional / disabled settings.
 */
function ApplicationFormPreview({ values }: { values: PositionFormValues }) {
  if (values.publishMode === "disabled") {
    return (
      <section className="mt-8 border-t border-slate-100 pt-7">
        <h2 className="text-[15px] font-semibold text-slate-900">Applications are closed</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
          This role is set to <span className="font-medium text-slate-700">Disabled</span>, so the
          careers page returns a not-found and no application form is shown.
        </p>
      </section>
    );
  }

  const shown = APPLY_FIELD_DEFS.filter(
    (def) => values.applicationFields[def.key] !== "disabled",
  ).map((def) => ({ ...def, required: values.applicationFields[def.key] === "required" }));

  return (
    <section className="mt-8 border-t border-slate-100 pt-7">
      <h2 className="text-[15px] font-semibold text-slate-900">Application form</h2>
      <p className="mt-1 text-[13px] text-slate-500">
        What the candidate fills in after choosing{" "}
        <span className="font-medium text-slate-700">Apply for this role</span>.
      </p>

      <div className="mt-4 space-y-3">
        {[
          { key: "full_name", label: "Full name", required: true },
          { key: "email", label: "Email", required: true },
          ...shown,
        ].map((field) => (
          <div key={field.key}>
            <div className="mb-1 text-[13px] text-slate-700">
              {field.label}
              {field.required && <span className="ml-1 text-red-600">*</span>}
            </div>
            <div
              className={
                "rounded-md border border-dashed border-slate-300 bg-slate-50/60 px-3 " +
                ("control" in field && field.control === "textarea" ? "py-6" : "py-2.5")
              }
            >
              <span className="text-[13px] text-slate-400">
                {"control" in field && field.control === "file"
                  ? "PDF or Word document"
                  : "Candidate's answer"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {values.applicationQuestionnaireId && (
        <p className="mt-4 text-[13px] text-slate-500">
          A questionnaire is attached — its questions are asked as part of this form.
        </p>
      )}
    </section>
  );
}

function locationLabel(values: PositionFormValues): string {
  const first = values.locations[0];
  if (!first) return "Remote";
  return first.detail.trim() || first.country;
}

function metaLine(values: PositionFormValues): string {
  return [locationLabel(values), values.positionType, values.department]
    .filter(Boolean)
    .join(" · ");
}

function formatSalary(values: PositionFormValues): string | null {
  const from = parseSalary(values.salaryFrom);
  const to = parseSalary(values.salaryTo);
  if (from == null && to == null) return null;
  const currency = values.salaryCurrency ? `${values.salaryCurrency} ` : "";
  const money = (n: number) => `${currency}${n.toLocaleString()}`;
  const range =
    from != null && to != null ? `${money(from)} – ${money(to)}` : money((from ?? to) as number);
  return values.salaryPeriod ? `${range} / ${values.salaryPeriod}` : range;
}

function formatEducation(values: PositionFormValues): string | null {
  if (!values.educationLevel || values.educationLevel === "No requirement") return null;
  return values.educationLevelRequired
    ? `${values.educationLevel} required`
    : `${values.educationLevel} preferred (not required)`;
}

export function PositionPreview({ values, onClose }: PositionPreviewProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const salary = formatSalary(values);
  const education = formatEducation(values);
  const title = values.title.trim() || "Untitled position";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        aria-label="Close preview"
        className="absolute inset-0 h-full w-full cursor-default bg-slate-900/30"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Position preview"
        className="relative flex max-h-[calc(100vh-96px)] w-180 max-w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-modal"
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-slate-200 px-5 py-3.5">
          <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
            Candidate preview
          </span>
          <span className="text-xs text-slate-400">
            what applicants would see on the careers site
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-slate-500 transition-colors hover:bg-slate-100"
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="overflow-y-auto px-8 py-8">
          <header className="border-b border-slate-100 pb-7">
            <h1 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.025em] text-slate-900">
              {title}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-500">
              <span>{metaLine(values)}</span>
              {values.remoteFlag && (
                <span className="rounded-[5px] bg-green-50 px-1.75 py-0.5 font-mono text-[11px] text-green-700">
                  REMOTE
                </span>
              )}
            </div>
            {(salary || education) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {salary && (
                  <div className="inline-flex items-center rounded-lg bg-slate-50 px-3 py-1.5 text-[13px] font-medium text-slate-700">
                    {salary}
                  </div>
                )}
                {education && (
                  <div className="inline-flex items-center rounded-lg bg-slate-50 px-3 py-1.5 text-[13px] font-medium text-slate-700">
                    {education}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="mt-6 inline-flex h-11 cursor-default items-center gap-2 rounded-[10px] bg-slate-900 px-6 text-[15px] font-medium text-white opacity-90"
            >
              Apply for this role
            </button>
          </header>

          <section className="pt-8">
            {values.description.trim() ? (
              <MarkdownContent content={values.description} />
            ) : (
              <p className="text-[15px] leading-relaxed text-slate-500">
                We&apos;ll share the full role details during the process. Hit{" "}
                <span className="font-medium text-slate-700">Apply for this role</span> to introduce
                yourself — we read every application.
              </p>
            )}
          </section>

          <ApplicationFormPreview values={values} />
        </div>
      </div>
    </div>
  );
}
