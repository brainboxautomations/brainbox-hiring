import { describe, expect, it } from "vitest";

import {
  DEFAULT_EMAIL_DELAY_MINUTES,
  MAX_DELAY_MINUTES,
  stageActionInputSchema,
  stageActionUpdateSchema,
  unsupportedFieldForType,
} from "@/schemas/stage-action-schema";

const STAGE_ID = "11111111-1111-4111-8111-111111111111";
const TEMPLATE_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_STAGE_ID = "33333333-3333-4333-8333-333333333333";

describe("the delay is the undo window", () => {
  it("defaults an email action to a short delay", () => {
    const parsed = stageActionInputSchema.parse({
      positionStageId: STAGE_ID,
      type: "send_email",
      messageTemplateId: TEMPLATE_ID,
    });

    expect(parsed.delayMinutes).toBe(DEFAULT_EMAIL_DELAY_MINUTES);
    expect(parsed.enabled).toBe(true);
    expect(parsed.sortOrder).toBe(0);
  });

  it("accepts an explicit zero delay", () => {
    const parsed = stageActionInputSchema.parse({
      positionStageId: STAGE_ID,
      type: "send_email",
      messageTemplateId: TEMPLATE_ID,
      delayMinutes: 0,
    });

    expect(parsed.delayMinutes).toBe(0);
  });

  it("refuses a negative delay, which would fire before anyone could undo it", () => {
    const result = stageActionInputSchema.safeParse({
      positionStageId: STAGE_ID,
      type: "send_email",
      messageTemplateId: TEMPLATE_ID,
      delayMinutes: -1,
    });

    expect(result.success).toBe(false);
  });

  it("refuses a delay past the 90-day rail", () => {
    const result = stageActionInputSchema.safeParse({
      positionStageId: STAGE_ID,
      type: "send_email",
      messageTemplateId: TEMPLATE_ID,
      delayMinutes: MAX_DELAY_MINUTES + 1,
    });

    expect(result.success).toBe(false);
  });

  it("refuses a fractional delay", () => {
    const result = stageActionInputSchema.safeParse({
      positionStageId: STAGE_ID,
      type: "send_email",
      messageTemplateId: TEMPLATE_ID,
      delayMinutes: 1.5,
    });

    expect(result.success).toBe(false);
  });

  it("requires an explicit delay on the two types that have no default", () => {
    expect(
      stageActionInputSchema.safeParse({
        positionStageId: STAGE_ID,
        type: "move_to_stage",
        targetPositionStageId: TARGET_STAGE_ID,
      }).success,
    ).toBe(false);

    expect(
      stageActionInputSchema.safeParse({
        positionStageId: STAGE_ID,
        type: "move_to_stage",
        targetPositionStageId: TARGET_STAGE_ID,
        delayMinutes: 30,
      }).success,
    ).toBe(true);
  });
});

describe("each action type carries exactly its own payload", () => {
  it("requires a template on a send_email action", () => {
    const result = stageActionInputSchema.safeParse({
      positionStageId: STAGE_ID,
      type: "send_email",
    });

    expect(result.success).toBe(false);
  });

  it("requires a target stage on a move_to_stage action", () => {
    const result = stageActionInputSchema.safeParse({
      positionStageId: STAGE_ID,
      type: "move_to_stage",
      delayMinutes: 0,
    });

    expect(result.success).toBe(false);
  });

  it("rejects an action type outside the three allowed", () => {
    const result = stageActionInputSchema.safeParse({
      positionStageId: STAGE_ID,
      type: "notify_slack",
      delayMinutes: 0,
    });

    expect(result.success).toBe(false);
  });

  it("drops a payload field that belongs to a different type", () => {
    const parsed = stageActionInputSchema.parse({
      positionStageId: STAGE_ID,
      type: "send_email",
      messageTemplateId: TEMPLATE_ID,
      targetPositionStageId: TARGET_STAGE_ID,
    });

    expect(parsed).not.toHaveProperty("targetPositionStageId");
  });
});

describe("an update may only touch the payload field its type owns", () => {
  it("names the offending field", () => {
    expect(unsupportedFieldForType("send_email", { targetPositionStageId: TARGET_STAGE_ID })).toBe(
      "targetPositionStageId",
    );
    expect(unsupportedFieldForType("move_to_stage", { messageTemplateId: TEMPLATE_ID })).toBe(
      "messageTemplateId",
    );
    expect(unsupportedFieldForType("send_questionnaire", { messageTemplateId: TEMPLATE_ID })).toBe(
      "messageTemplateId",
    );
  });

  it("allows the field the type does own", () => {
    expect(unsupportedFieldForType("send_email", { messageTemplateId: TEMPLATE_ID })).toBeNull();
    expect(
      unsupportedFieldForType("move_to_stage", { targetPositionStageId: TARGET_STAGE_ID }),
    ).toBeNull();
  });

  it("allows an update that touches no payload field at all", () => {
    expect(unsupportedFieldForType("send_email", { enabled: false, delayMinutes: 5 })).toBeNull();
  });

  it("refuses an empty update", () => {
    expect(stageActionUpdateSchema.safeParse({}).success).toBe(false);
  });
});
