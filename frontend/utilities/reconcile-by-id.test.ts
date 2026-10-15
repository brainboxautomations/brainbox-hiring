import { describe, expect, it } from "vitest";

import { planReconcileById } from "@/utilities/reconcile-by-id";

type Row = { id?: string | null; label: string };

describe("planReconcileById", () => {
  it("updates every row an edit keeps, in its new order, and deletes nothing", () => {
    const plan = planReconcileById<Row>(
      ["a", "b"],
      [
        { id: "b", label: "B renamed" },
        { id: "a", label: "A" },
      ],
    );
    expect(plan.update).toEqual([
      { id: "b", item: { id: "b", label: "B renamed" }, sortOrder: 0 },
      { id: "a", item: { id: "a", label: "A" }, sortOrder: 1 },
    ]);
    expect(plan.insert).toEqual([]);
    expect(plan.deleteIds).toEqual([]);
  });

  it("inserts rows without an id and deletes only the rows left out", () => {
    const plan = planReconcileById<Row>(
      ["a", "b", "c"],
      [{ id: "a", label: "A" }, { label: "New" }],
    );
    expect(plan.update.map((u) => u.id)).toEqual(["a"]);
    expect(plan.insert).toEqual([{ item: { label: "New" }, sortOrder: 1 }]);
    expect(plan.deleteIds).toEqual(["b", "c"]);
  });

  it("treats an id the list does not have as new, so another list's row cannot be adopted", () => {
    const plan = planReconcileById<Row>(["a"], [{ id: "someone-elses", label: "X" }]);
    expect(plan.update).toEqual([]);
    expect(plan.insert).toHaveLength(1);
    expect(plan.deleteIds).toEqual(["a"]);
  });

  it("updates a repeated id once and inserts the second copy", () => {
    const plan = planReconcileById<Row>(
      ["a"],
      [
        { id: "a", label: "first" },
        { id: "a", label: "copy" },
      ],
    );
    expect(plan.update.map((u) => u.item.label)).toEqual(["first"]);
    expect(plan.insert.map((i) => i.item.label)).toEqual(["copy"]);
  });
});
