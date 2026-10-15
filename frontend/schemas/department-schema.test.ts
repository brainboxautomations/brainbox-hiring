import { describe, expect, it } from "vitest";

import { MAX_DEPARTMENT_NAME_LENGTH, departmentInputSchema } from "@/schemas/department-schema";

describe("departmentInputSchema", () => {
  it("trims the name, matching the trimmed check in the database", () => {
    expect(departmentInputSchema.parse({ name: "  Finance  " })).toEqual({ name: "Finance" });
  });

  it("refuses a blank name", () => {
    expect(departmentInputSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("refuses a name longer than the database allows", () => {
    const name = "x".repeat(MAX_DEPARTMENT_NAME_LENGTH + 1);
    expect(departmentInputSchema.safeParse({ name }).success).toBe(false);
    expect(departmentInputSchema.safeParse({ name: name.slice(1) }).success).toBe(true);
  });
});
