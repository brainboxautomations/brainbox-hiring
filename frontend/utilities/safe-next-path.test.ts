import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/utilities/safe-next-path";

describe("safeNextPath", () => {
  it("keeps a path on this site", () => {
    expect(safeNextPath("/candidates/abc?tab=notes")).toBe("/candidates/abc?tab=notes");
  });

  it("falls back for anything that would leave the site", () => {
    expect(safeNextPath("https://evil.com")).toBe("/positions");
    expect(safeNextPath("//evil.com")).toBe("/positions");
    expect(safeNextPath("/\\evil.com")).toBe("/positions");
  });

  it("falls back when there is no value", () => {
    expect(safeNextPath(null)).toBe("/positions");
    expect(safeNextPath(undefined, "/reset-password")).toBe("/reset-password");
  });
});
