import type {
  AnswerRoutingRule,
  Question,
  QuestionInput,
  QuestionOption,
  QuestionType,
} from "@/types/api";

export type BuilderQType =
  | "short"
  | "long"
  | "single"
  | "multiple"
  | "dropdown"
  | "numeric"
  | "video"
  | "file"
  | "date"
  | "yesno";

export interface BuilderQOption {
  label: string;

  route: string;
}

export interface BuilderQuestion {
  id: number;
  /**
   * The saved question's id, absent on a question added in this edit. Sent back
   * on save so the question is updated in place: answers reference it, and a
   * recreated question would take every recorded answer to it with it.
   */
  serverId?: string;
  type: BuilderQType;
  prompt: string;
  help: string;
  required: boolean;
  options?: BuilderQOption[];
  videoMax?: string;
  retakes?: boolean;
  numMin?: string;
  numMax?: string;
}

const TO_DB_TYPE: Record<BuilderQType, QuestionType> = {
  short: "short_text",
  long: "long_text",
  single: "single_choice",
  multiple: "multi_choice",
  dropdown: "dropdown",
  numeric: "numeric",
  video: "video",
  file: "file",
  date: "date",
  yesno: "yes_no",
};

const FROM_DB_TYPE: Record<QuestionType, BuilderQType> = {
  short_text: "short",
  long_text: "long",
  single_choice: "single",
  multi_choice: "multiple",
  dropdown: "dropdown",
  numeric: "numeric",
  video: "video",
  file: "file",
  date: "date",
  yes_no: "yesno",
};

const VIDEO_MAX_SECONDS: Record<string, number> = {
  "30 sec": 30,
  "1 min": 60,
  "2 min": 120,
};

const CHOICE_DB_TYPES: QuestionType[] = ["single_choice", "multi_choice", "dropdown"];

function videoMaxToSeconds(label: string | undefined): number | null {
  if (!label) return null;
  return VIDEO_MAX_SECONDS[label] ?? null;
}

function secondsToVideoMax(seconds: number | null): string {
  const match = Object.entries(VIDEO_MAX_SECONDS).find(([, s]) => s === seconds);
  return match?.[0] ?? "1 min";
}

export function parseNumericBound(value: string | undefined): number | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumericBound(value: number | null): string {
  return value === null ? "" : String(value);
}

function optionValue(label: string, index: number, seen: Set<string>): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || `option_${index + 1}`;
  let value = base;
  let n = 2;
  while (seen.has(value)) value = `${base}_${n++}`;
  seen.add(value);
  return value;
}

export function toQuestionInput(q: BuilderQuestion): QuestionInput {
  const type = TO_DB_TYPE[q.type];
  const isChoice = CHOICE_DB_TYPES.includes(type);

  const seen = new Set<string>();
  const builderOptions = isChoice ? (q.options ?? []) : [];
  const options: QuestionOption[] = builderOptions.map((o, i) => ({
    value: optionValue(o.label, i, seen),
    label: o.label.trim() || `Option ${i + 1}`,
  }));

  const answerRouting: AnswerRoutingRule[] = builderOptions
    .map((o, i) => ({ option: options[i], route: o.route }))
    .filter(
      (entry): entry is { option: QuestionOption; route: string } =>
        Boolean(entry.option) && entry.route.trim().length > 0,
    )
    .map((entry) => ({
      optionValue: entry.option.value,
      pipelineTemplateStageId: entry.route,
    }));

  return {
    ...(q.serverId ? { id: q.serverId } : {}),
    type,
    prompt: q.prompt.trim(),
    helpText: q.help.trim() ? q.help.trim() : null,
    required: q.required,
    options,
    videoMaxDuration: type === "video" ? videoMaxToSeconds(q.videoMax) : null,
    videoAllowRetakes: type === "video" ? Boolean(q.retakes) : null,
    numericMin: type === "numeric" ? parseNumericBound(q.numMin) : null,
    numericMax: type === "numeric" ? parseNumericBound(q.numMax) : null,
    answerRouting,
  };
}

export function toBuilderQuestion(q: Question, id: number): BuilderQuestion {
  const type = FROM_DB_TYPE[q.type];
  const base: BuilderQuestion = {
    id,
    serverId: q.id,
    type,
    prompt: q.prompt,
    help: q.helpText ?? "",
    required: q.required,
  };
  if (CHOICE_DB_TYPES.includes(q.type)) {
    base.options = q.options.map((o) => ({
      label: o.label,
      route:
        q.answerRouting.find((rule) => rule.optionValue === o.value)?.pipelineTemplateStageId ?? "",
    }));
  }
  if (q.type === "video") {
    base.videoMax = secondsToVideoMax(q.videoMaxDuration);
    base.retakes = q.videoAllowRetakes ?? true;
  }
  if (q.type === "numeric") {
    base.numMin = formatNumericBound(q.numericMin);
    base.numMax = formatNumericBound(q.numericMax);
  }
  return base;
}
