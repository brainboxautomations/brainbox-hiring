import { z } from "zod";

import type { StageActionType } from "@/types/api";

export const DEFAULT_EMAIL_DELAY_MINUTES = 60;

export const MAX_DELAY_MINUTES = 129_600;

export const MAX_SORT_ORDER = 1_000;

const delayMinutes = z
  .number()
  .int("A delay is a whole number of minutes")
  .min(0, "A delay cannot be negative")
  .max(MAX_DELAY_MINUTES, "A delay cannot be more than 90 days");

const sortOrder = z.number().int().min(0).max(MAX_SORT_ORDER);

export const MAX_REMINDER_COUNT = 10;

export const DEFAULT_REMINDER_INTERVAL_MINUTES = 2880;

export const reminderConfigSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z
    .array(
      z
        .number()
        .int("A reminder interval is a whole number of minutes")
        .min(1, "A reminder interval must be at least a minute")
        .max(MAX_DELAY_MINUTES, "A reminder interval cannot be more than 90 days"),
    )
    .min(1, "Set at least one reminder interval")
    .max(MAX_REMINDER_COUNT, "That is more reminder intervals than a schedule can use"),
  maxCount: z
    .number()
    .int("A reminder count is a whole number")
    .min(1, "Send at least one reminder, or turn reminders off")
    .max(MAX_REMINDER_COUNT, `A questionnaire is chased at most ${MAX_REMINDER_COUNT} times`),
  messageTemplateId: z.uuid().nullable(),
});

export type ReminderConfigValues = z.infer<typeof reminderConfigSchema>;

const baseFields = {
  positionStageId: z.uuid("A stage action must belong to a position stage"),
  enabled: z.boolean().default(true),
  sortOrder: sortOrder.default(0),
};

export const stageActionInputSchema = z.discriminatedUnion("type", [
  z.object({
    ...baseFields,
    type: z.literal("send_email"),
    messageTemplateId: z.uuid("Choose the email template this action sends"),
    delayMinutes: delayMinutes.default(DEFAULT_EMAIL_DELAY_MINUTES),
  }),
  z.object({
    ...baseFields,
    type: z.literal("send_questionnaire"),
    questionnaireTemplateId: z.uuid("Choose the questionnaire this action sends"),
    delayMinutes,
    reminderConfig: reminderConfigSchema.nullish(),
  }),
  z.object({
    ...baseFields,
    type: z.literal("move_to_stage"),
    targetPositionStageId: z.uuid("Choose the stage this action moves the candidate to"),
    delayMinutes,
  }),
]);

export type StageActionInputValues = z.infer<typeof stageActionInputSchema>;

export const stageActionUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    delayMinutes: delayMinutes.optional(),
    sortOrder: sortOrder.optional(),
    messageTemplateId: z.uuid().optional(),
    questionnaireTemplateId: z.uuid().optional(),
    targetPositionStageId: z.uuid().optional(),
    reminderConfig: reminderConfigSchema.nullable().optional(),
  })
  .refine((values) => Object.keys(values).length > 0, { message: "No fields to update" });

export type StageActionUpdateValues = z.infer<typeof stageActionUpdateSchema>;

const PAYLOAD_FIELD_BY_TYPE: Record<StageActionType, keyof StageActionUpdateValues> = {
  send_email: "messageTemplateId",
  send_questionnaire: "questionnaireTemplateId",
  move_to_stage: "targetPositionStageId",
};

export function unsupportedFieldForType(
  type: StageActionType,
  update: StageActionUpdateValues,
): string | null {
  const allowed = PAYLOAD_FIELD_BY_TYPE[type];

  for (const field of Object.values(PAYLOAD_FIELD_BY_TYPE)) {
    if (field !== allowed && update[field] !== undefined) return field;
  }

  if (type !== "send_questionnaire" && update.reminderConfig !== undefined) {
    return "reminderConfig";
  }

  return null;
}
