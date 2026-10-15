import { describe, expect, it } from "vitest";

import {
  questionnaireCompletionState,
  type QuestionnaireCompletionInput,
} from "./questionnaire-status";

const NOW = new Date("2026-08-06T12:00:00.000Z");

function response(overrides: Partial<QuestionnaireCompletionInput> = {}) {
  const base: QuestionnaireCompletionInput = {
    context: "stage_sent",
    status: "pending",
    sentAt: "2026-08-01T09:00:00.000Z",
    linkExpiresAt: "2026-08-31T09:00:00.000Z",
  };
  return { ...base, ...overrides };
}

describe("questionnaireCompletionState (QST-8)", () => {
  it("reports a completed questionnaire as completed, whatever the link says", () => {
    expect(
      questionnaireCompletionState(
        response({ status: "completed", linkExpiresAt: "2020-01-01T00:00:00.000Z" }),
        NOW,
      ),
    ).toBe("completed");
  });

  it("reports a sent-but-unanswered questionnaire as awaiting", () => {
    expect(questionnaireCompletionState(response(), NOW)).toBe("awaiting");
  });

  it("reports a sent questionnaire whose link has run out as link_expired", () => {
    expect(
      questionnaireCompletionState(response({ linkExpiresAt: "2026-08-05T09:00:00.000Z" }), NOW),
    ).toBe("link_expired");
  });

  it("takes now as a parameter, so the same row reads differently at two instants", () => {
    const row = response({ linkExpiresAt: "2026-08-10T00:00:00.000Z" });

    expect(questionnaireCompletionState(row, new Date("2026-08-09T23:59:59.000Z"))).toBe(
      "awaiting",
    );
    expect(questionnaireCompletionState(row, new Date("2026-08-10T00:00:01.000Z"))).toBe(
      "link_expired",
    );
  });

  it("reports a stage-sent row that never went out as not_sent", () => {
    expect(questionnaireCompletionState(response({ sentAt: null }), NOW)).toBe("not_sent");
  });

  it("never calls an embedded application response expired — it has no link", () => {
    expect(
      questionnaireCompletionState(
        response({ context: "application_embedded", sentAt: null, linkExpiresAt: null }),
        NOW,
      ),
    ).toBe("awaiting");
  });

  it("treats a row with no link expiry as awaiting rather than expired", () => {
    expect(questionnaireCompletionState(response({ linkExpiresAt: null }), NOW)).toBe("awaiting");
  });

  it("ignores an unparseable expiry rather than declaring the link dead", () => {
    expect(questionnaireCompletionState(response({ linkExpiresAt: "not a date" }), NOW)).toBe(
      "awaiting",
    );
  });
});
