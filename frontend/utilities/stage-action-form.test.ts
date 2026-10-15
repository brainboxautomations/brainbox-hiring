import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMINDER,
  delayMinutesFrom,
  draftFrom,
  draftProblem,
  newDraft,
  reminderConfigWithIntervalDays,
  reminderConfigWithMaxCount,
  reminderIntervalDays,
  splitDelay,
  type StageActionDraft,
} from "@/utilities/stage-action-form";
import type { StageAction } from "@/types/api";

function stageAction(overrides: Partial<StageAction> = {}): StageAction {
  return {
    id: "action-1",
    positionStageId: "stage-1",
    type: "send_email",
    enabled: true,
    delayMinutes: 60,
    sortOrder: 0,
    messageTemplateId: "template-1",
    questionnaireTemplateId: null,
    targetPositionStageId: null,
    reminderConfig: null,
    createdAt: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

describe("a delay reads back in the unit it was written in", () => {
  it("shows whole days as days", () => {
    expect(splitDelay(2880)).toEqual({ value: "2", unit: "days" });
  });

  it("shows whole hours as hours", () => {
    expect(splitDelay(90 * 60)).toEqual({ value: "90", unit: "hours" });
  });

  it("falls back to minutes when it divides into nothing tidier", () => {
    expect(splitDelay(45)).toEqual({ value: "45", unit: "minutes" });
  });

  it("treats no delay as immediate", () => {
    expect(splitDelay(0)).toEqual({ value: "0", unit: "hours" });
  });

  it("converts back to minutes", () => {
    expect(delayMinutesFrom("3", "days")).toBe(4320);
    expect(delayMinutesFrom("0", "hours")).toBe(0);
  });

  it("refuses anything that is not a whole, non-negative number", () => {
    expect(delayMinutesFrom("", "hours")).toBeNull();
    expect(delayMinutesFrom("-1", "hours")).toBeNull();
    expect(delayMinutesFrom("1.5", "hours")).toBeNull();
    expect(delayMinutesFrom("soon", "hours")).toBeNull();
  });
});

describe("a draft carries exactly the payload its type allows", () => {
  it("defaults an email action to the one-hour undo window", () => {
    expect(newDraft("send_email")).toMatchObject({ delayValue: "1", delayUnit: "hours" });
  });

  it("gives a questionnaire action a reminder block to switch on", () => {
    expect(newDraft("send_questionnaire").reminderConfig).toEqual(DEFAULT_REMINDER);
  });

  it("gives the other two types no reminder block at all", () => {
    expect(newDraft("send_email").reminderConfig).toBeNull();
    expect(newDraft("move_to_stage").reminderConfig).toBeNull();
  });

  it("round-trips a saved action back into the form", () => {
    const draft = draftFrom(stageAction({ delayMinutes: 4320 }));
    expect(draft).toMatchObject({
      id: "action-1",
      type: "send_email",
      delayValue: "3",
      delayUnit: "days",
      messageTemplateId: "template-1",
    });
  });
});

describe("a draft that cannot be saved says which field is missing", () => {
  function draft(overrides: Partial<StageActionDraft>): StageActionDraft {
    return { ...newDraft("send_email"), ...overrides };
  }

  it("accepts a complete email action", () => {
    expect(draftProblem(draft({ messageTemplateId: "template-1" }))).toBeNull();
  });

  it("names the missing template", () => {
    expect(draftProblem(draft({ messageTemplateId: null }))).toMatch(/email template/);
  });

  it("names the missing questionnaire", () => {
    expect(draftProblem({ ...newDraft("send_questionnaire") })).toMatch(/questionnaire/);
  });

  it("names the missing target stage", () => {
    expect(draftProblem({ ...newDraft("move_to_stage") })).toMatch(/stage/);
  });

  it("rejects a delay that is not a number before anything else", () => {
    expect(draftProblem(draft({ delayValue: "later", messageTemplateId: "template-1" }))).toMatch(
      /whole number/,
    );
  });
});

describe("the reminder controls stay inside what the engine will accept", () => {
  it("reads the interval back in days", () => {
    expect(reminderIntervalDays({ ...DEFAULT_REMINDER, intervalMinutes: [4320] })).toBe("3");
  });

  it("never lets the interval fall below a day", () => {
    expect(reminderConfigWithIntervalDays(DEFAULT_REMINDER, "0").intervalMinutes).toEqual([1440]);
    expect(reminderConfigWithIntervalDays(DEFAULT_REMINDER, "x").intervalMinutes).toEqual([1440]);
  });

  it("caps the count at ten, whatever is typed", () => {
    expect(reminderConfigWithMaxCount(DEFAULT_REMINDER, "500").maxCount).toBe(10);
    expect(reminderConfigWithMaxCount(DEFAULT_REMINDER, "0").maxCount).toBe(1);
    expect(reminderConfigWithMaxCount(DEFAULT_REMINDER, "3").maxCount).toBe(3);
  });
});
