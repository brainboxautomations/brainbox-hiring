import { describe, expect, it } from "vitest";

import {
  questionnaireEmailChoiceSchema,
  questionnaireEmailSettingsSchema,
  questionnaireInputSchema,
} from "@/schemas/questionnaire-schema";

describe("questionnaireEmailChoiceSchema", () => {
  it("accepts the default with no wording of its own", () => {
    expect(questionnaireEmailChoiceSchema.safeParse({ mode: "default" }).success).toBe(true);
  });

  it("accepts custom wording that has both a subject and an email", () => {
    const parsed = questionnaireEmailChoiceSchema.safeParse({
      mode: "custom",
      subject: "Next step",
      body: "Hi {{candidate.first_name}}",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses custom wording with a blank subject or email", () => {
    expect(
      questionnaireEmailChoiceSchema.safeParse({ mode: "custom", subject: "  ", body: "Hi" })
        .success,
    ).toBe(false);
    expect(
      questionnaireEmailChoiceSchema.safeParse({ mode: "custom", subject: "Hi", body: null })
        .success,
    ).toBe(false);
  });

  it("is optional on a questionnaire, so an edit that leaves it out keeps what is saved", () => {
    const parsed = questionnaireInputSchema.parse({ name: "Video task" });
    expect(parsed.inviteEmail).toBeUndefined();
    expect(parsed.reminderEmail).toBeUndefined();
  });
});

describe("questionnaireEmailSettingsSchema", () => {
  const valid = {
    invite: { subject: "Invite", body: "Invite body" },
    reminder: { subject: "Reminder", body: "Reminder body" },
  };

  it("accepts both emails filled in", () => {
    expect(questionnaireEmailSettingsSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a blank default, since every questionnaire on the default would send it", () => {
    const parsed = questionnaireEmailSettingsSchema.safeParse({
      ...valid,
      reminder: { subject: "Reminder", body: "   " },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("The reminder email is required");
  });
});
