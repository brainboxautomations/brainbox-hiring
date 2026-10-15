import type { ReminderConfig, StageAction, StageActionType } from "@/types/api";
import { DEFAULT_EMAIL_DELAY_MINUTES } from "@/schemas/stage-action-schema";

export const DELAY_UNITS = ["minutes", "hours", "days"] as const;

export type DelayUnit = (typeof DELAY_UNITS)[number];

const MINUTES_IN: Record<DelayUnit, number> = { minutes: 1, hours: 60, days: 1440 };

export type StageActionDraft = {
  id: string | null;
  type: StageActionType;
  delayValue: string;
  delayUnit: DelayUnit;
  enabled: boolean;
  messageTemplateId: string | null;
  questionnaireTemplateId: string | null;
  targetPositionStageId: string | null;
  reminderConfig: ReminderConfig | null;
};

export const DEFAULT_REMINDER: ReminderConfig = {
  enabled: true,
  intervalMinutes: [2880],
  maxCount: 3,
  messageTemplateId: null,
};

export function splitDelay(minutes: number): { value: string; unit: DelayUnit } {
  if (minutes === 0) return { value: "0", unit: "hours" };
  if (minutes % 1440 === 0) return { value: String(minutes / 1440), unit: "days" };
  if (minutes % 60 === 0) return { value: String(minutes / 60), unit: "hours" };
  return { value: String(minutes), unit: "minutes" };
}

export function delayMinutesFrom(value: string, unit: DelayUnit): number | null {
  const text = value.trim();
  if (text === "") return null;

  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed * MINUTES_IN[unit];
}

export function reminderIntervalDays(config: ReminderConfig): string {
  const first = config.intervalMinutes[0] ?? 0;
  return String(Math.max(1, Math.round(first / 1440)));
}

export function reminderConfigWithIntervalDays(
  config: ReminderConfig,
  days: string,
): ReminderConfig {
  const parsed = Number(days.trim());
  const safe = Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
  return { ...config, intervalMinutes: [safe * 1440] };
}

export function reminderConfigWithMaxCount(config: ReminderConfig, count: string): ReminderConfig {
  const parsed = Number(count.trim());
  const safe = Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, 10) : 1;
  return { ...config, maxCount: safe };
}

export function newDraft(type: StageActionType): StageActionDraft {
  const delay = splitDelay(type === "send_email" ? DEFAULT_EMAIL_DELAY_MINUTES : 0);

  return {
    id: null,
    type,
    delayValue: delay.value,
    delayUnit: delay.unit,
    enabled: true,
    messageTemplateId: null,
    questionnaireTemplateId: null,
    targetPositionStageId: null,
    reminderConfig: type === "send_questionnaire" ? DEFAULT_REMINDER : null,
  };
}

export function draftFrom(action: StageAction): StageActionDraft {
  const delay = splitDelay(action.delayMinutes);

  return {
    id: action.id,
    type: action.type,
    delayValue: delay.value,
    delayUnit: delay.unit,
    enabled: action.enabled,
    messageTemplateId: action.messageTemplateId,
    questionnaireTemplateId: action.questionnaireTemplateId,
    targetPositionStageId: action.targetPositionStageId,
    reminderConfig: action.reminderConfig,
  };
}

export function draftProblem(draft: StageActionDraft): string | null {
  if (delayMinutesFrom(draft.delayValue, draft.delayUnit) === null) {
    return "A delay is a whole number of minutes, hours or days";
  }

  if (draft.type === "send_email" && !draft.messageTemplateId) {
    return "Choose the email template this action sends";
  }

  if (draft.type === "send_questionnaire" && !draft.questionnaireTemplateId) {
    return "Choose the questionnaire this action sends";
  }

  if (draft.type === "move_to_stage" && !draft.targetPositionStageId) {
    return "Choose the stage this action moves the candidate to";
  }

  return null;
}
