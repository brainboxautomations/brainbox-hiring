import { describe, expect, it } from "vitest";

import {
  generateQuestionnaireToken,
  isQuestionnaireTokenExpired,
  isQuestionnaireTokenShape,
  questionnaireTokenExpiresAt,
  QUESTIONNAIRE_TOKEN_LENGTH,
  QUESTIONNAIRE_TOKEN_TTL_DAYS,
} from "./questionnaire-token";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("generateQuestionnaireToken", () => {
  it("produces a 43-character base64url string, which is 32 random bytes", () => {
    const token = generateQuestionnaireToken();

    expect(token).toHaveLength(QUESTIONNAIRE_TOKEN_LENGTH);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is URL-safe: no padding, no plus, no slash", () => {
    for (let draw = 0; draw < 200; draw += 1) {
      const token = generateQuestionnaireToken();
      expect(token).not.toContain("=");
      expect(token).not.toContain("+");
      expect(token).not.toContain("/");
    }
  });

  it("never repeats across a large number of draws", () => {
    const draws = new Set<string>();
    for (let draw = 0; draw < 5000; draw += 1) draws.add(generateQuestionnaireToken());

    expect(draws.size).toBe(5000);
  });

  it("does not derive anything from a counter — consecutive tokens share no prefix", () => {
    const first = generateQuestionnaireToken();
    const second = generateQuestionnaireToken();

    expect(first.slice(0, 8)).not.toBe(second.slice(0, 8));
  });
});

describe("isQuestionnaireTokenShape", () => {
  it("accepts what the generator produces", () => {
    expect(isQuestionnaireTokenShape(generateQuestionnaireToken())).toBe(true);
  });

  it("rejects the empty string, a uuid, and anything of the wrong length", () => {
    expect(isQuestionnaireTokenShape("")).toBe(false);
    expect(isQuestionnaireTokenShape("d1e9a0f2-9c4e-4f5a-8b1e-6a2d3c4b5a6f")).toBe(false);
    expect(isQuestionnaireTokenShape("a".repeat(QUESTIONNAIRE_TOKEN_LENGTH - 1))).toBe(false);
    expect(isQuestionnaireTokenShape("a".repeat(QUESTIONNAIRE_TOKEN_LENGTH + 1))).toBe(false);
  });

  it("rejects characters that are not base64url", () => {
    expect(isQuestionnaireTokenShape(`${"a".repeat(QUESTIONNAIRE_TOKEN_LENGTH - 1)}+`)).toBe(false);
    expect(isQuestionnaireTokenShape(`${"a".repeat(QUESTIONNAIRE_TOKEN_LENGTH - 1)}/`)).toBe(false);
    expect(isQuestionnaireTokenShape(`${"a".repeat(QUESTIONNAIRE_TOKEN_LENGTH - 1)} `)).toBe(false);
  });

  it("rejects a token with a newline, which a regex without anchors would accept", () => {
    expect(isQuestionnaireTokenShape(`${"a".repeat(QUESTIONNAIRE_TOKEN_LENGTH)}\nevil`)).toBe(
      false,
    );
  });
});

describe("questionnaireTokenExpiresAt", () => {
  it("adds exactly the configured window to the instant it is given", () => {
    const issuedAt = new Date("2026-08-06T09:00:00.000Z");

    expect(questionnaireTokenExpiresAt(issuedAt).toISOString()).toBe("2026-09-05T09:00:00.000Z");
  });

  it("takes now as a parameter rather than reading the clock", () => {
    const first = questionnaireTokenExpiresAt(new Date("2020-01-01T00:00:00.000Z"));
    const second = questionnaireTokenExpiresAt(new Date("2020-01-01T00:00:00.000Z"));

    expect(first.getTime()).toBe(second.getTime());
    expect(first.getTime()).toBe(
      new Date("2020-01-01T00:00:00.000Z").getTime() + QUESTIONNAIRE_TOKEN_TTL_DAYS * DAY_MS,
    );
  });

  it("crosses a daylight-saving boundary without drifting, because it is pure milliseconds", () => {
    const beforeUkClockChange = new Date("2026-10-20T00:00:00.000Z");

    expect(questionnaireTokenExpiresAt(beforeUkClockChange).toISOString()).toBe(
      "2026-11-19T00:00:00.000Z",
    );
  });
});

describe("isQuestionnaireTokenExpired", () => {
  const expiresAt = new Date("2026-09-05T09:00:00.000Z");

  it("is not expired a millisecond before", () => {
    expect(isQuestionnaireTokenExpired(expiresAt, new Date(expiresAt.getTime() - 1))).toBe(false);
  });

  it("is expired exactly on the boundary", () => {
    expect(isQuestionnaireTokenExpired(expiresAt, new Date(expiresAt.getTime()))).toBe(true);
  });

  it("is expired after", () => {
    expect(isQuestionnaireTokenExpired(expiresAt, new Date(expiresAt.getTime() + 1))).toBe(true);
  });
});
