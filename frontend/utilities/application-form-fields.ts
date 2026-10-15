import type { ApplicationFormConfig, FieldSetting } from "@/types/api";

export type ApplyFieldKey =
  | "phone"
  | "address"
  | "desired_salary"
  | "resume"
  | "experience_summary"
  | "work_history"
  | "education"
  | "cover_letter";

export type ApplyFieldControl = "input" | "textarea" | "file";

export type ApplyFieldDef = {
  key: ApplyFieldKey;
  label: string;
  control: ApplyFieldControl;
  placeholder?: string;
};

export const APPLY_FIELD_DEFS: ApplyFieldDef[] = [
  { key: "phone", label: "Phone", control: "input", placeholder: "+92 …" },
  { key: "address", label: "Address", control: "input", placeholder: "City, Country" },
  // No currency symbol or example amount: the apply form fills in the
  // position's own currency. This used to read "e.g. £90,000", telling the
  // candidate to answer in a currency the role does not pay in.
  {
    key: "desired_salary",
    label: "Desired salary",
    control: "input",
    placeholder: "Amount per year",
  },
  { key: "resume", label: "Resume / CV", control: "file" },
  {
    key: "experience_summary",
    label: "Experience summary",
    control: "textarea",
    placeholder: "A few sentences about your background…",
  },
  // Every textarea needs a placeholder. Without one these render as bare grey
  // boxes beside the resume dropzone, and candidates read them as broken or
  // upload-only rather than as somewhere to type.
  {
    key: "work_history",
    label: "Work history",
    control: "textarea",
    placeholder: "Recent roles, companies, and dates…",
  },
  {
    key: "education",
    label: "Education",
    control: "textarea",
    placeholder: "Qualifications, institutions, and years…",
  },
  {
    key: "cover_letter",
    label: "Cover letter",
    control: "textarea",
    placeholder: "Tell us why this role interests you and what you'd bring to it…",
  },
];

export function fieldSetting(config: ApplicationFormConfig, key: ApplyFieldKey): FieldSetting {
  return config[key] ?? "optional";
}

export function isFieldShown(config: ApplicationFormConfig, key: ApplyFieldKey): boolean {
  return fieldSetting(config, key) !== "disabled";
}

export function isFieldRequired(config: ApplicationFormConfig, key: ApplyFieldKey): boolean {
  return fieldSetting(config, key) === "required";
}
