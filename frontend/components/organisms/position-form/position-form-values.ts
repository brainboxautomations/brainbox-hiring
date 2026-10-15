import type {
  ApplicationFormConfig,
  FieldSetting,
  Position,
  PositionInput,
  PublishMode,
  SalaryPeriod,
} from "@/types/api";
import { APPLY_FIELD_DEFS, type ApplyFieldKey } from "@/utilities/application-form-fields";
import { SALARY_RANGE_MESSAGE, salaryRangeOrdered } from "@/schemas/position-schema";

export type PositionFormLocation = { country: string; detail: string };

export type PositionFormValues = {
  title: string;
  department: string;
  locations: PositionFormLocation[];
  remoteFlag: boolean;
  positionType: string;
  educationLevel: string;
  educationLevelRequired: boolean;
  experienceLevel: string;
  salaryFrom: string;
  salaryTo: string;
  salaryCurrency: string;
  salaryPeriod: SalaryPeriod;
  description: string;
  publishMode: PublishMode;
  applicationFields: Record<ApplyFieldKey, FieldSetting>;
  applicationQuestionnaireId: string;
  assignedPipelineId: string;
  emailSenderName: string;
};

/**
 * The departments the form offers: the team's list (Settings → Departments),
 * plus the position's own department if it has since been removed from the
 * list, so editing an older position never silently blanks the field.
 */
export function departmentChoices(listed: string[], current: string): string[] {
  const value = current.trim();
  if (!value || listed.some((name) => name.toLowerCase() === value.toLowerCase())) {
    return listed;
  }
  return [...listed, value];
}
export const POSITION_TYPES = ["Full-time", "Part-time", "Contract", "Internship"];
export const EDUCATION_LEVELS = [
  "No requirement",
  "High school",
  "Bachelor's degree",
  "Master's degree",
];
export const EXPERIENCE_LEVELS = ["Entry", "Mid (2-4 years)", "Senior (5+ years)", "Lead / Staff"];
// Salaries are quoted in Pakistani rupees only; the form offers no other
// currency. A position saved earlier in another currency keeps it (see
// positionFormValues) rather than being relabelled as PKR with the same number.
export const SALARY_CURRENCY = "PKR";
export const SALARY_PERIODS: SalaryPeriod[] = ["year", "month"];

export const APPLICATION_METHODS: { id: PublishMode; title: string; description: string }[] = [
  { id: "listed", title: "Listed", description: "On the public careers site plus a direct link." },
  { id: "unlisted", title: "Unlisted", description: "Reachable by direct link only." },
  { id: "disabled", title: "Disabled", description: "Not accepting applications." },
];

export const APPLICATION_FIELD_LABELS: Record<ApplyFieldKey, string> = {
  phone: "Phone",
  address: "Address",
  desired_salary: "Desired Salary",
  resume: "Resume Upload",
  experience_summary: "Experience Summary",
  work_history: "Work History",
  education: "Education",
  cover_letter: "Cover Letter",
};

export const APPLICATION_FIELD_KEYS: ApplyFieldKey[] = APPLY_FIELD_DEFS.map((def) => def.key);

const DEFAULT_APPLICATION_FIELDS: Record<ApplyFieldKey, FieldSetting> = {
  phone: "optional",
  address: "disabled",
  desired_salary: "optional",
  resume: "required",
  experience_summary: "optional",
  work_history: "optional",
  education: "optional",
  cover_letter: "optional",
};

export function createPositionFormValues(): PositionFormValues {
  return {
    title: "",
    department: "",
    locations: [],
    remoteFlag: false,
    positionType: "Full-time",
    educationLevel: "No requirement",
    educationLevelRequired: true,
    experienceLevel: "",
    salaryFrom: "",
    salaryTo: "",
    salaryCurrency: SALARY_CURRENCY,
    salaryPeriod: "year",
    description: "",
    publishMode: "listed",
    applicationFields: { ...DEFAULT_APPLICATION_FIELDS },
    applicationQuestionnaireId: "",
    assignedPipelineId: "",
    emailSenderName: "",
  };
}

function applicationFieldsFrom(config: ApplicationFormConfig): Record<ApplyFieldKey, FieldSetting> {
  const fields = { ...DEFAULT_APPLICATION_FIELDS };
  for (const key of APPLICATION_FIELD_KEYS) {
    const setting = config[key];
    if (setting) fields[key] = setting;
  }
  return fields;
}

function numberToInput(value: number | null): string {
  return value === null ? "" : String(value);
}

export function positionFormValues(position: Position): PositionFormValues {
  return {
    title: position.title,
    department: position.department ?? "",
    locations: position.locations.map((location) => ({
      country: location.country,
      detail: location.detail ?? "",
    })),
    remoteFlag: position.remoteFlag,
    positionType: position.positionType ?? "",
    educationLevel: position.educationLevel ?? "",
    educationLevelRequired: position.educationLevelRequired,
    experienceLevel: position.experienceLevel ?? "",
    salaryFrom: numberToInput(position.salaryFrom),
    salaryTo: numberToInput(position.salaryTo),
    // Kept as stored: turning "3,000 USD" into "3,000 PKR" would silently change
    // what the role pays.
    salaryCurrency: position.salaryCurrency ?? SALARY_CURRENCY,
    salaryPeriod: position.salaryPeriod ?? "year",
    description: position.description ?? "",
    publishMode: position.publishMode,
    applicationFields: applicationFieldsFrom(position.applicationFormConfig),
    applicationQuestionnaireId: position.applicationQuestionnaireId ?? "",
    assignedPipelineId: position.assignedPipelineId ?? "",
    emailSenderName: position.emailSenderName ?? "",
  };
}

export function parseSalary(value: string): number | null {
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function toPositionInput(values: PositionFormValues): PositionInput {
  const applicationFormConfig: ApplicationFormConfig = {};
  for (const key of APPLICATION_FIELD_KEYS) {
    applicationFormConfig[key] = values.applicationFields[key];
  }

  return {
    title: values.title.trim(),
    department: values.department || null,
    locations: values.locations
      .filter((location) => location.country.trim())
      .map((location) => ({
        country: location.country.trim(),
        detail: location.detail.trim() || undefined,
      })),
    remoteFlag: values.remoteFlag,
    positionType: values.positionType || null,
    educationLevel: values.educationLevel || null,
    educationLevelRequired: values.educationLevelRequired,
    experienceLevel: values.experienceLevel || null,
    salaryFrom: parseSalary(values.salaryFrom),
    salaryTo: parseSalary(values.salaryTo),
    salaryPeriod: values.salaryPeriod,
    salaryCurrency: values.salaryCurrency || null,
    description: values.description || null,
    publishMode: values.publishMode,
    applicationFormConfig,
    applicationQuestionnaireId: values.applicationQuestionnaireId || null,
    assignedPipelineId: values.assignedPipelineId || null,
    emailSenderName: values.emailSenderName || null,
  };
}

export function salaryRangeError(values: PositionFormValues): string | null {
  const ordered = salaryRangeOrdered({
    salaryFrom: parseSalary(values.salaryFrom),
    salaryTo: parseSalary(values.salaryTo),
  });
  return ordered ? null : SALARY_RANGE_MESSAGE;
}
