import { describe, expect, it } from "vitest";

import { slugify } from "@/utilities/slug";

describe("slugify", () => {
  it("lowercases and hyphenates a title", () => {
    expect(slugify("Senior Frontend Engineer")).toBe("senior-frontend-engineer");
  });

  it("strips accents to ASCII", () => {
    expect(slugify("Ingénieur Système")).toBe("ingenieur-systeme");
  });

  it("collapses runs of non-alphanumerics into a single hyphen", () => {
    expect(slugify("Sales  &  Marketing // Lead")).toBe("sales-marketing-lead");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  --Head of People--  ")).toBe("head-of-people");
  });

  it("keeps digits", () => {
    expect(slugify("Engineer II (2026)")).toBe("engineer-ii-2026");
  });

  it("caps length at 80 characters", () => {
    const slug = slugify("a".repeat(200));
    expect(slug).toHaveLength(80);
  });

  it("returns an empty string when nothing survives, so callers can fall back", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("")).toBe("");
  });

  it("never emits a character that would alter the URL path", () => {
    const slug = slugify("Back/End ../.. Engineer?x=1#frag");
    expect(slug).not.toMatch(/[/?#.]/);
  });
});
