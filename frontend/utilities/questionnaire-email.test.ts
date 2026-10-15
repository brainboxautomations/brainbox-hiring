import { describe, expect, it } from "vitest";

import {
  ORIGINAL_QUESTIONNAIRE_EMAILS,
  QUESTIONNAIRE_LINK_LABEL,
  QUESTIONNAIRE_LINK_TOKEN,
  buildQuestionnaireEmail,
  pickQuestionnaireEmail,
  questionnaireEmailLeavesOutLink,
  questionnaireLinkNote,
  type QuestionnaireLink,
} from "@/utilities/questionnaire-email";

const TOKEN = "8Kj2mQ7vX1pR4tY6uI0oP3aS5dF7gH9jK2lZ4xC6vB8";

const LINK: QuestionnaireLink = {
  url: `https://hiring.example.com/q/${TOKEN}`,
  expiresAt: new Date("2026-09-09T11:30:00.000Z"),
};

const DEFAULT_TEXT = { subject: "Default subject", body: "Default body {{questionnaire.link}}" };

describe("pickQuestionnaireEmail", () => {
  it("uses the default when the questionnaire is set to it", () => {
    expect(
      pickQuestionnaireEmail({ mode: "default", subject: "Mine", body: "Mine" }, DEFAULT_TEXT),
    ).toEqual(DEFAULT_TEXT);
  });

  it("uses the questionnaire's own wording when it is custom", () => {
    expect(
      pickQuestionnaireEmail({ mode: "custom", subject: "Mine", body: "My body" }, DEFAULT_TEXT),
    ).toEqual({ subject: "Mine", body: "My body" });
  });

  it("falls back to the default when custom wording is blank, so nothing goes out empty", () => {
    expect(
      pickQuestionnaireEmail({ mode: "custom", subject: "  ", body: null }, DEFAULT_TEXT),
    ).toEqual(DEFAULT_TEXT);
  });
});

describe("buildQuestionnaireEmail", () => {
  const text = {
    subject: "{{position.title}} — {{questionnaire.name}}",
    body: "Hi {{candidate.first_name}},\n\nPlease do **{{questionnaire.name}}**.\n\n{{questionnaire.link}}",
  };

  it("fills in the questionnaire name and leaves the other variables for the send", () => {
    const email = buildQuestionnaireEmail(text, { name: "Video task", link: LINK });

    expect(email.subject).toBe("{{position.title}} — Video task");
    expect(email.sent).toContain("**Video task**");
    expect(email.sent).toContain("Hi {{candidate.first_name}},");
  });

  it("sends the real link as a labelled link where the variable sits", () => {
    const email = buildQuestionnaireEmail(text, { name: "Video task", link: LINK });

    expect(email.sent).toContain(`[${QUESTIONNAIRE_LINK_LABEL}](${LINK.url})`);
    expect(email.sent).not.toContain(QUESTIONNAIRE_LINK_TOKEN);
  });

  it("keeps the link out of the recorded copy and says when it stops working", () => {
    const { recorded } = buildQuestionnaireEmail(text, { name: "Video task", link: LINK });

    expect(recorded).not.toContain(TOKEN);
    expect(recorded).not.toContain("/q/");
    expect(recorded).toContain("A single-use questionnaire link was emailed to the candidate");
    expect(recorded).toContain("9 September 2026");
    expect(recorded).toContain("**Video task**");
  });

  it("adds the link at the end when the wording leaves it out", () => {
    const email = buildQuestionnaireEmail(
      { subject: "Hello", body: "Hi there,\n\nThanks" },
      { name: "Video task", link: LINK },
    );

    expect(email.sent.endsWith(`[${QUESTIONNAIRE_LINK_LABEL}](${LINK.url})`)).toBe(true);
    expect(email.recorded).toContain("A single-use questionnaire link was emailed");
  });

  it("reads the variables however they are spaced or cased", () => {
    const email = buildQuestionnaireEmail(
      { subject: "{{ Questionnaire.Name }}", body: "{{ QUESTIONNAIRE.LINK }}" },
      { name: "Video task", link: LINK },
    );

    expect(email.subject).toBe("Video task");
    expect(email.sent).toBe(`[${QUESTIONNAIRE_LINK_LABEL}](${LINK.url})`);
  });

  it("puts a name with a dollar sign in as written", () => {
    const email = buildQuestionnaireEmail(text, { name: "Pay $& task", link: LINK });

    expect(email.subject).toBe("{{position.title}} — Pay $& task");
  });

  it("never puts the link in the subject", () => {
    const email = buildQuestionnaireEmail(
      { subject: "Open {{questionnaire.link}}", body: "Body" },
      { name: "Video task", link: LINK },
    );

    expect(email.subject).not.toContain(LINK.url);
  });
});

describe("questionnaireEmailLeavesOutLink", () => {
  it("is true only when the body has no link variable", () => {
    expect(questionnaireEmailLeavesOutLink("Hi {{questionnaire.link}}")).toBe(false);
    expect(questionnaireEmailLeavesOutLink("Hi there")).toBe(true);
  });
});

describe("the original wording", () => {
  it("still includes the link and the questionnaire name in both emails", () => {
    for (const email of [
      ORIGINAL_QUESTIONNAIRE_EMAILS.invite,
      ORIGINAL_QUESTIONNAIRE_EMAILS.reminder,
    ]) {
      expect(email.body).toContain(QUESTIONNAIRE_LINK_TOKEN);
      expect(`${email.subject}${email.body}`).toContain("{{questionnaire.name}}");
    }
  });

  it("reads as a reminder", () => {
    expect(ORIGINAL_QUESTIONNAIRE_EMAILS.reminder.subject).toBe("Reminder: {{questionnaire.name}}");
    expect(ORIGINAL_QUESTIONNAIRE_EMAILS.reminder.body).toContain(
      "We have not received your response yet.",
    );
  });
});

describe("the expiry note", () => {
  it("is written in UTC, so the stored body does not move with the server's zone", () => {
    expect(questionnaireLinkNote(new Date("2026-01-01T00:30:00.000Z"))).toContain("1 January 2026");
    expect(questionnaireLinkNote(new Date("2025-12-31T23:30:00.000Z"))).toContain(
      "31 December 2025",
    );
  });
});
