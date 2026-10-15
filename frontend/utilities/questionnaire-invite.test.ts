import { describe, expect, it } from "vitest";

import {
  questionnaireBaseUrl,
  questionnaireInvite,
  QUESTIONNAIRE_LINK_UNAVAILABLE,
} from "./questionnaire-invite";

const CAREERS = "https://hiring.example.com/careers";

function urlFrom(config: { appBaseUrl: string; careersUrl: string }, token: string): string {
  const invite = questionnaireInvite(config);
  if (!invite.available) throw new Error(`expected a link, got: ${invite.reason}`);
  return invite.urlFor(token);
}

describe("questionnaireBaseUrl", () => {
  it("prefers an explicitly configured app base URL", () => {
    expect(
      questionnaireBaseUrl({ appBaseUrl: "https://apply.example.com", careersUrl: CAREERS }),
    ).toBe("https://apply.example.com");
  });

  it("falls back to the origin of the careers URL, dropping its path", () => {
    expect(questionnaireBaseUrl({ appBaseUrl: "", careersUrl: CAREERS })).toBe(
      "https://hiring.example.com",
    );
  });

  it("ignores an app base URL that is not a URL at all", () => {
    expect(questionnaireBaseUrl({ appBaseUrl: "not a url", careersUrl: CAREERS })).toBe(
      "https://hiring.example.com",
    );
  });

  it("refuses a non-http scheme, so a link can never be built onto javascript: or file:", () => {
    expect(
      questionnaireBaseUrl({ appBaseUrl: "javascript:alert(1)", careersUrl: "file:///etc" }),
    ).toBeNull();
  });

  it("is null when nothing is configured", () => {
    expect(questionnaireBaseUrl({ appBaseUrl: "", careersUrl: "" })).toBeNull();
  });
});

describe("questionnaireInvite", () => {
  it("builds a /q/<token> link on the configured origin", () => {
    expect(
      urlFrom({ appBaseUrl: "https://apply.example.com", careersUrl: CAREERS }, "abc123"),
    ).toBe("https://apply.example.com/q/abc123");
  });

  it("does not double the slash when the base URL ends in one", () => {
    expect(urlFrom({ appBaseUrl: "https://apply.example.com/", careersUrl: "" }, "abc123")).toBe(
      "https://apply.example.com/q/abc123",
    );
  });

  it("drops any path on the configured base, so the link is never nested under it", () => {
    expect(urlFrom({ appBaseUrl: "", careersUrl: CAREERS }, "abc123")).toBe(
      "https://hiring.example.com/q/abc123",
    );
  });

  it("escapes a token that somehow contains a path or query character", () => {
    expect(urlFrom({ appBaseUrl: "https://apply.example.com", careersUrl: "" }, "a/b?c=d")).toBe(
      "https://apply.example.com/q/a%2Fb%3Fc%3Dd",
    );
  });

  it("reports why no link is available rather than returning a broken one", () => {
    const invite = questionnaireInvite({ appBaseUrl: "", careersUrl: "" });

    expect(invite.available).toBe(false);
    if (invite.available) throw new Error("expected no link");
    expect(invite.reason).toBe(QUESTIONNAIRE_LINK_UNAVAILABLE);
  });
});
