"use client";

import { cn } from "@/utilities/cn";
import { Field } from "@/components/atoms/input";
import { Select } from "@/components/atoms/select";
import { LockIcon } from "@/components/atoms/icons";
import type { FieldSetting, QuestionnaireTemplate } from "@/types/api";
import {
  APPLICATION_FIELD_KEYS,
  APPLICATION_FIELD_LABELS,
  APPLICATION_METHODS,
  type PositionFormValues,
} from "./position-form-values";

type PositionApplicationStepProps = {
  values: PositionFormValues;
  onChange: (patch: Partial<PositionFormValues>) => void;
  questionnaires: QuestionnaireTemplate[];
};

const FIELD_SETTINGS: { value: FieldSetting; label: string }[] = [
  { value: "required", label: "Required" },
  { value: "optional", label: "Optional" },
  { value: "disabled", label: "Disabled" },
];

function FieldSettingControl({
  fieldLabel,
  value,
  onChange,
}: {
  fieldLabel: string;
  value: FieldSetting;
  onChange: (value: FieldSetting) => void;
}) {
  return (
    <div
      role="group"
      aria-label={fieldLabel}
      className="flex h-7 items-center overflow-hidden rounded-md border border-slate-200"
    >
      {FIELD_SETTINGS.map((setting, index) => {
        const selected = setting.value === value;
        return (
          <button
            key={setting.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(setting.value)}
            className={cn(
              "flex h-full items-center px-2.5 text-[11px] transition-colors",
              index > 0 && "border-l border-slate-100",
              selected && setting.value === "disabled" && "bg-slate-100 text-slate-600",
              selected && setting.value !== "disabled" && "bg-accent-9 text-white",
              !selected && "bg-white text-slate-400 hover:bg-slate-50",
            )}
          >
            {setting.label}
          </button>
        );
      })}
    </div>
  );
}

export function PositionApplicationStep({
  values,
  onChange,
  questionnaires,
}: PositionApplicationStepProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-2 text-xs font-medium text-slate-700">Application method</div>
        <div role="radiogroup" aria-label="Application method" className="grid grid-cols-3 gap-2.5">
          {APPLICATION_METHODS.map((method) => {
            const selected = values.publishMode === method.id;
            return (
              <button
                key={method.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ publishMode: method.id })}
                className={cn(
                  "rounded-xl border-[1.5px] p-3.5 text-left transition-colors",
                  selected
                    ? "border-accent-9 bg-accent-2"
                    : "border-slate-200 bg-white hover:border-slate-300",
                )}
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-slate-900">{method.title}</span>
                  <span
                    className={cn(
                      "flex h-3.75 w-3.75 items-center justify-center rounded-full border-[1.5px]",
                      selected ? "border-accent-9" : "border-slate-300",
                    )}
                  >
                    {selected && <span className="h-1.75 w-1.75 rounded-full bg-accent-9" />}
                  </span>
                </div>
                <div className="text-[11px] leading-relaxed text-slate-500">
                  {method.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-slate-700">Application form fields</div>
        <div className="mb-2.5 text-[11px] text-slate-400">Name and Email are always required.</div>
        <div className="overflow-hidden rounded-xl border border-slate-200">
          {["Name", "Email"].map((name) => (
            <div
              key={name}
              className="flex items-center gap-3 border-b border-slate-100 px-3.5 py-2.5"
            >
              <span className="flex-1 text-[13px] text-slate-700">{name}</span>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                <LockIcon size={11} />
                Required
              </span>
            </div>
          ))}
          {APPLICATION_FIELD_KEYS.map((key) => (
            <div
              key={key}
              className="flex items-center gap-3 border-b border-slate-100 px-3.5 py-2.5 last:border-b-0"
            >
              <span className="flex-1 text-[13px] text-slate-700">
                {APPLICATION_FIELD_LABELS[key]}
              </span>
              <FieldSettingControl
                fieldLabel={APPLICATION_FIELD_LABELS[key]}
                value={values.applicationFields[key]}
                onChange={(setting) =>
                  onChange({ applicationFields: { ...values.applicationFields, [key]: setting } })
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <Field label="Application questionnaire" htmlFor="questionnaire">
          <Select
            id="questionnaire"
            value={values.applicationQuestionnaireId}
            onChange={(e) => onChange({ applicationQuestionnaireId: e.target.value })}
            options={[
              { value: "", label: "None" },
              ...questionnaires.map((questionnaire) => ({
                value: questionnaire.id,
                label: questionnaire.name,
              })),
            ]}
          />
        </Field>
      </div>
    </div>
  );
}
