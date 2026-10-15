"use client";

import { Input, Label, Field } from "@/components/atoms/input";
import { Select } from "@/components/atoms/select";
import { Segmented } from "@/components/atoms/segmented";
import { Toggle } from "@/components/atoms/toggle";
import { SearchableDropdown } from "@/components/molecules/searchable-dropdown";
import { CloseIcon, PlusIcon } from "@/components/atoms/icons";
import type { SalaryPeriod } from "@/types/api";
import { COUNTRIES } from "@/utilities/countries";

import { DepartmentField } from "./department-field";
import {
  EDUCATION_LEVELS,
  EXPERIENCE_LEVELS,
  POSITION_TYPES,
  SALARY_PERIODS,
  salaryRangeError,
  type PositionFormLocation,
  type PositionFormValues,
} from "./position-form-values";

type PositionDetailsStepProps = {
  values: PositionFormValues;
  onChange: (patch: Partial<PositionFormValues>) => void;
  titleError?: string | null;
};

const asOptions = (items: string[]) => items.map((item) => ({ value: item, label: item }));

/**
 * Options for an optional select whose value starts empty.
 *
 * Without a matching `value=""` option the browser cannot show the empty state,
 * so it falls back to displaying the first option while the form value stays
 * "". The field then looks chosen, never fires onChange, and saves as null —
 * which is how a position could reach Review showing no department after the
 * user saw "Engineering" sitting in the dropdown the whole time.
 */
const asOptionalOptions = (items: string[], placeholder: string) => [
  { value: "", label: placeholder },
  ...asOptions(items),
];

const EDUCATION_REQUIREMENT_OPTIONS: { value: "required" | "optional"; label: string }[] = [
  { value: "required", label: "Required" },
  { value: "optional", label: "Optional" },
];

export function PositionDetailsStep({ values, onChange, titleError }: PositionDetailsStepProps) {
  const setLocation = (index: number, patch: Partial<PositionFormLocation>) =>
    onChange({
      locations: values.locations.map((location, current) =>
        current === index ? { ...location, ...patch } : location,
      ),
    });

  const addLocation = () =>
    onChange({ locations: [...values.locations, { country: "", detail: "" }] });

  const removeLocation = (index: number) =>
    onChange({ locations: values.locations.filter((_, current) => current !== index) });

  const salaryError = salaryRangeError(values);

  const showEducationRequirement =
    values.educationLevel.trim() !== "" && values.educationLevel !== "No requirement";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Label htmlFor="title">
          Position title <span className="text-red-600">*</span>
        </Label>
        <Input
          id="title"
          value={values.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="e.g. Senior Frontend Engineer"
          invalid={!!titleError}
        />
        {titleError && <p className="mt-1.5 text-[11px] text-red-700">{titleError}</p>}
      </div>

      <DepartmentField
        value={values.department}
        onChange={(department) => onChange({ department })}
      />

      <div>
        <Label>Locations</Label>
        {values.locations.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-3.5 py-3 text-xs text-slate-400">
            No locations yet. Add one so candidates know where this role is based.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {values.locations.map((location, index) => (
              <div key={index} className="flex items-end gap-2">
                <div className="w-2/5 shrink-0">
                  <Label htmlFor={`location-country-${index}`}>Country</Label>
                  <SearchableDropdown
                    id={`location-country-${index}`}
                    aria-label={`Location ${index + 1} country`}
                    options={[...COUNTRIES]}
                    value={location.country || null}
                    onChange={(country) => setLocation(index, { country })}
                    placeholder="Select a country"
                    searchPlaceholder="Search countries…"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <Label htmlFor={`location-detail-${index}`}>City / detail (optional)</Label>
                  <Input
                    id={`location-detail-${index}`}
                    value={location.detail}
                    onChange={(e) => setLocation(index, { detail: e.target.value })}
                    placeholder="e.g. London"
                    aria-label={`Location ${index + 1} detail`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeLocation(index)}
                  aria-label="Remove location"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <CloseIcon size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={addLocation}
          className="mt-2.5 inline-flex items-center gap-1.5 text-xs text-accent-11 hover:underline"
        >
          <PlusIcon size={12} />
          Add location
        </button>
        <div className="mt-3.5">
          <Toggle
            on={values.remoteFlag}
            onToggle={() => onChange({ remoteFlag: !values.remoteFlag })}
            label="Remote position"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Position type" htmlFor="positionType">
          <Select
            id="positionType"
            value={values.positionType}
            onChange={(e) => onChange({ positionType: e.target.value })}
            options={asOptions(POSITION_TYPES)}
          />
        </Field>
        <Field label="Experience level" htmlFor="experienceLevel">
          <Select
            id="experienceLevel"
            value={values.experienceLevel}
            onChange={(e) => onChange({ experienceLevel: e.target.value })}
            options={asOptionalOptions(EXPERIENCE_LEVELS, "Select an experience level…")}
          />
        </Field>
      </div>

      <Field label="Education level" htmlFor="educationLevel">
        <div className="flex items-center gap-2">
          <Select
            id="educationLevel"
            value={values.educationLevel}
            onChange={(e) => onChange({ educationLevel: e.target.value })}
            options={asOptions(EDUCATION_LEVELS)}
            className="flex-1"
          />
          {showEducationRequirement && (
            <Segmented<"required" | "optional">
              ariaLabel="Education level requirement"
              value={values.educationLevelRequired ? "required" : "optional"}
              onChange={(next) => onChange({ educationLevelRequired: next === "required" })}
              options={EDUCATION_REQUIREMENT_OPTIONS}
            />
          )}
        </div>
      </Field>

      <div>
        <Label>Salary range</Label>
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1.5">
            <Input
              value={values.salaryFrom}
              onChange={(e) => onChange({ salaryFrom: e.target.value })}
              placeholder="From"
              aria-label="Salary from"
              invalid={!!salaryError}
            />
            <span className="text-slate-400">–</span>
            <Input
              value={values.salaryTo}
              onChange={(e) => onChange({ salaryTo: e.target.value })}
              placeholder="To"
              aria-label="Salary to"
              invalid={!!salaryError}
            />
          </div>
          {/* Only one currency is offered, so it is shown, not chosen. */}
          <span
            aria-label="Salary currency"
            className="inline-flex h-8 shrink-0 items-center rounded-md border border-slate-200 bg-slate-50 px-2.75 text-[12px] font-medium text-slate-600"
          >
            {values.salaryCurrency}
          </span>
          <Segmented<SalaryPeriod>
            ariaLabel="Salary period"
            value={values.salaryPeriod}
            onChange={(salaryPeriod) => onChange({ salaryPeriod })}
            options={SALARY_PERIODS.map((period) => ({ value: period, label: `/ ${period}` }))}
          />
        </div>
        {salaryError && <p className="mt-1.5 text-[11px] text-red-700">{salaryError}</p>}
      </div>
    </div>
  );
}
