import { describe, expect, it } from "vitest";

import { candidateSearchWords, matchesAllWords } from "@/utilities/candidate-search";

describe("candidateSearchWords", () => {
  it("splits and lowercases what was typed", () => {
    expect(candidateSearchWords("  Nadia   RAHMAN ")).toEqual(["nadia", "rahman"]);
  });

  it("returns nothing for input too short to be worth searching", () => {
    expect(candidateSearchWords("")).toBeNull();
    expect(candidateSearchWords(" a ")).toBeNull();
  });

  // The words are built into a PostgREST filter string; these would change
  // its structure or act as wildcards.
  it("drops characters that would break or widen the database filter", () => {
    expect(candidateSearchWords("nadia,(rahman)%_*")).toEqual(["nadia", "rahman"]);
    expect(candidateSearchWords("a.b@x.com")).toEqual(["a.b@x.com"]);
  });
});

describe("matchesAllWords", () => {
  const nadia = { firstName: "Nadia", lastName: "Rahman", email: "nadia@example.com" };

  it("matches a full name spread across first and last name", () => {
    expect(matchesAllWords(["nadia", "rahman"], nadia)).toBe(true);
  });

  it("matches on email", () => {
    expect(matchesAllWords(["example.com"], nadia)).toBe(true);
  });

  it("requires every word", () => {
    expect(matchesAllWords(["nadia", "fischer"], nadia)).toBe(false);
  });
});
