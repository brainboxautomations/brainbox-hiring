import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  SALARY_RANGE_MESSAGE,
  SALARY_RANGE_REFINEMENT,
  positionCreateSchema,
  positionInputSchema,
  salaryRangeOrdered,
} from "@/schemas/position-schema";

const patchSchema = positionInputSchema
  .partial()
  .extend({ status: z.enum(["draft", "open", "closed", "archived"]).optional() })
  .refine(salaryRangeOrdered, SALARY_RANGE_REFINEMENT);

function position(overrides: Record<string, unknown> = {}) {
  return { title: "Senior Frontend Engineer", ...overrides };
}

describe("salaryRangeOrdered", () => {
  it("accepts a range where the maximum is higher", () => {
    expect(salaryRangeOrdered({ salaryFrom: 50_000, salaryTo: 200_000 })).toBe(true);
  });

  it("accepts a single-value range", () => {
    expect(salaryRangeOrdered({ salaryFrom: 90_000, salaryTo: 90_000 })).toBe(true);
  });

  it("rejects an inverted range", () => {
    expect(salaryRangeOrdered({ salaryFrom: 200_000, salaryTo: 50_000 })).toBe(false);
  });

  it("accepts a half-filled range, because one bound alone cannot be inverted", () => {
    expect(salaryRangeOrdered({ salaryFrom: 200_000 })).toBe(true);
    expect(salaryRangeOrdered({ salaryTo: 50_000, salaryFrom: null })).toBe(true);
  });
});

describe("positionCreateSchema", () => {
  it("refuses a minimum above the maximum rather than swapping them", () => {
    const result = positionCreateSchema.safeParse(
      position({ salaryFrom: 200_000, salaryTo: 50_000 }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(SALARY_RANGE_MESSAGE);
      expect(result.error.issues[0]?.path).toEqual(["salaryTo"]);
    }
  });

  it("keeps the values untouched when the range is valid", () => {
    const result = positionCreateSchema.safeParse(
      position({ salaryFrom: 50_000, salaryTo: 200_000 }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.salaryFrom).toBe(50_000);
      expect(result.data.salaryTo).toBe(200_000);
    }
  });

  it("still requires a title", () => {
    expect(positionCreateSchema.safeParse({ salaryFrom: 1, salaryTo: 2 }).success).toBe(false);
  });
});

describe("position patch schema", () => {
  it("refuses an inverted range on update, not only on create", () => {
    const result = patchSchema.safeParse({ salaryFrom: 200_000, salaryTo: 50_000 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe(SALARY_RANGE_MESSAGE);
  });

  it("allows a status-only update", () => {
    expect(patchSchema.safeParse({ status: "closed" }).success).toBe(true);
  });
});
