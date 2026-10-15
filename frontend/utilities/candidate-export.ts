import type { CandidateExportRecord } from "@/types/api";
import { APPLY_FIELD_DEFS } from "@/utilities/application-form-fields";

const ROW_SEPARATOR = "\r\n";

const SPREADSHEET_FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

function neutralizeFormula(value: string): string {
  const firstCharacter = value.charAt(0);
  return SPREADSHEET_FORMULA_PREFIXES.includes(firstCharacter) ? `'${value}` : value;
}

export function escapeCsvCell(value: string): string {
  const safe = neutralizeFormula(value);
  const needsQuoting = /[",\r\n]/.test(safe) || safe !== safe.trim();
  if (!needsQuoting) return safe;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join(ROW_SEPARATOR);
}

export function candidateFullName(record: CandidateExportRecord): string {
  return [record.firstName, record.lastName].filter(Boolean).join(" ").trim();
}

const FORM_FIELD_LABELS = new Map(
  APPLY_FIELD_DEFS.map((field) => [field.key as string, field.label]),
);

export function formAnswerLabel(key: string): string {
  return FORM_FIELD_LABELS.get(key) ?? key;
}

export function formAnswerKeys(records: CandidateExportRecord[]): string[] {
  const present = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record.formAnswers)) present.add(key);
  }

  const known = APPLY_FIELD_DEFS.map((field) => field.key as string).filter((key) =>
    present.has(key),
  );
  const extra = [...present].filter((key) => !FORM_FIELD_LABELS.has(key)).sort();

  return [...known, ...extra];
}

type FixedColumn = {
  header: string;
  read: (record: CandidateExportRecord) => string;
};

const FIXED_COLUMNS: FixedColumn[] = [
  { header: "Name", read: candidateFullName },
  { header: "Email", read: (record) => record.email },
  { header: "Phone", read: (record) => record.phone ?? "" },
  { header: "Headline", read: (record) => record.headline ?? "" },
  { header: "Position", read: (record) => record.positionTitle },
  { header: "Stage", read: (record) => record.stageName ?? "" },
  { header: "Status", read: (record) => (record.archived ? "Archived" : "Active") },
  { header: "Starred", read: (record) => (record.starred ? "Yes" : "No") },
  { header: "Seen", read: (record) => (record.seen ? "Yes" : "No") },
  { header: "Questionnaire", read: (record) => record.questionnaire },
  { header: "Added", read: (record) => record.appliedAt },
  { header: "Last activity", read: (record) => record.lastActivityAt },
];

export function candidateExportTable(records: CandidateExportRecord[]): string[][] {
  const answerKeys = formAnswerKeys(records);

  const header = [
    ...FIXED_COLUMNS.map((column) => column.header),
    ...answerKeys.map(formAnswerLabel),
  ];

  const rows = records.map((record) => [
    ...FIXED_COLUMNS.map((column) => column.read(record)),
    ...answerKeys.map((key) => record.formAnswers[key] ?? ""),
  ]);

  return [header, ...rows];
}

export function candidateExportCsv(records: CandidateExportRecord[]): string {
  return toCsv(candidateExportTable(records));
}

function slugForFilename(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "candidates";
}

export function candidateExportFilename(positionTitle: string, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return `${slugForFilename(positionTitle)}-candidates-${day}.csv`;
}
