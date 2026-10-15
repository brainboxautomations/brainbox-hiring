import { describe, expect, it } from "vitest";

import { mapUpcomingAutomation } from "@/app/api/_mappers";

const base = {
  id: "action-1",
  scheduled_for: "2026-10-08T10:20:00Z",
  reminder_number: null,
  origin_stage: { name: "Hired" },
  questionnaire_responses: null,
};

describe("mapUpcomingAutomation", () => {
  it("names a stage email by its template and stage", () => {
    expect(
      mapUpcomingAutomation({
        ...base,
        kind: "stage_action",
        stage_actions: {
          type: "send_email",
          message_templates: { name: "Offer letter" },
          questionnaire_templates: null,
          target_stage: null,
        },
      }),
    ).toEqual({
      id: "action-1",
      kind: "stage_action",
      action: "Send email",
      subject: "Offer letter",
      stageName: "Hired",
      scheduledFor: "2026-10-08T10:20:00Z",
    });
  });

  it("names a move by the stage it moves to", () => {
    const item = mapUpcomingAutomation({
      ...base,
      kind: "stage_action",
      stage_actions: {
        type: "move_to_stage",
        message_templates: null,
        questionnaire_templates: null,
        target_stage: { name: "Interview" },
      },
    });
    expect(item.action).toBe("Move to stage");
    expect(item.subject).toBe("Interview");
  });

  it("numbers a reminder and names its questionnaire", () => {
    const item = mapUpcomingAutomation({
      ...base,
      kind: "reminder",
      reminder_number: 2,
      stage_actions: null,
      questionnaire_responses: { questionnaire_templates: { name: "Screening questions" } },
    });
    expect(item).toMatchObject({
      kind: "reminder",
      action: "Reminder 2",
      subject: "Screening questions",
    });
  });
});
