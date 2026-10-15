import { describe, expect, it } from "vitest";

import { planStageReconcile } from "@/utilities/pipeline-stage-reconcile";

const APPLIED = "stage-applied";
const HIRED = "stage-hired";
const REJECTED = "stage-rejected";

const EXISTING = [APPLIED, HIRED, REJECTED];

describe("planStageReconcile", () => {
  // The bug this guards against: the PATCH handler used to delete every
  // pipeline_template_stages row and re-insert them, so every stage got a new
  // id on every save. position_stages.source_template_stage_id is
  // `on delete set null` and snapshot_pipeline_to_position only runs on a draft
  // position, so that silently and permanently severed every live position
  // built from the pipeline. Renaming one stage must not disturb the others.
  it("renaming one stage updates it in place and leaves the rest alone", () => {
    const plan = planStageReconcile(EXISTING, [
      { id: APPLIED, name: "Applied X" },
      { id: HIRED, name: "Hired" },
      { id: REJECTED, name: "Rejected" },
    ]);

    expect(plan.deleteIds).toEqual([]);
    expect(plan.insert).toEqual([]);
    expect(plan.update).toEqual([
      { id: APPLIED, name: "Applied X", sortOrder: 0 },
      { id: HIRED, name: "Hired", sortOrder: 1 },
      { id: REJECTED, name: "Rejected", sortOrder: 2 },
    ]);
  });

  it("reordering rewrites sort_order without recreating any stage", () => {
    const plan = planStageReconcile(EXISTING, [
      { id: HIRED, name: "Hired" },
      { id: APPLIED, name: "Applied" },
      { id: REJECTED, name: "Rejected" },
    ]);

    expect(plan.deleteIds).toEqual([]);
    expect(plan.insert).toEqual([]);
    expect(plan.update).toEqual([
      { id: HIRED, name: "Hired", sortOrder: 0 },
      { id: APPLIED, name: "Applied", sortOrder: 1 },
      { id: REJECTED, name: "Rejected", sortOrder: 2 },
    ]);
  });

  it("adding a stage inserts only that stage", () => {
    const plan = planStageReconcile(EXISTING, [
      { id: APPLIED, name: "Applied" },
      { id: HIRED, name: "Hired" },
      { id: REJECTED, name: "Rejected" },
      { name: "Interview" },
    ]);

    expect(plan.deleteIds).toEqual([]);
    expect(plan.insert).toEqual([{ name: "Interview", sortOrder: 3 }]);
    expect(plan.update).toHaveLength(3);
  });

  // Removal still severs the link for that stage, and that is correct — the
  // stage genuinely no longer exists. What matters is that it severs *only* the
  // stage the user removed.
  it("removing a stage deletes just that one", () => {
    const plan = planStageReconcile(EXISTING, [
      { id: APPLIED, name: "Applied" },
      { id: HIRED, name: "Hired" },
    ]);

    expect(plan.deleteIds).toEqual([REJECTED]);
    expect(plan.insert).toEqual([]);
    expect(plan.update).toHaveLength(2);
  });

  it("handles a rename, a reorder, an add and a remove in one edit", () => {
    const plan = planStageReconcile(EXISTING, [
      { id: HIRED, name: "Hired" },
      { id: APPLIED, name: "Applied X" },
      { name: "Brand New Stage" },
    ]);

    expect(plan.update).toEqual([
      { id: HIRED, name: "Hired", sortOrder: 0 },
      { id: APPLIED, name: "Applied X", sortOrder: 1 },
    ]);
    expect(plan.insert).toEqual([{ name: "Brand New Stage", sortOrder: 2 }]);
    expect(plan.deleteIds).toEqual([REJECTED]);
  });

  it("treats a stage with no id as new, which is how creation reaches here", () => {
    const plan = planStageReconcile([], [{ name: "Applied" }, { name: "Hired" }]);

    expect(plan.update).toEqual([]);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.insert).toEqual([
      { name: "Applied", sortOrder: 0 },
      { name: "Hired", sortOrder: 1 },
    ]);
  });

  // A client must not be able to adopt a row belonging to another pipeline by
  // naming its id, so an id the pipeline does not have is treated as new.
  it("treats an unknown id as a new stage rather than updating it", () => {
    const plan = planStageReconcile(EXISTING, [
      { id: APPLIED, name: "Applied" },
      { id: HIRED, name: "Hired" },
      { id: REJECTED, name: "Rejected" },
      { id: "stage-from-another-pipeline", name: "Smuggled" },
    ]);

    expect(plan.insert).toEqual([{ name: "Smuggled", sortOrder: 3 }]);
    expect(plan.update.map((s) => s.id)).toEqual([APPLIED, HIRED, REJECTED]);
    expect(plan.deleteIds).toEqual([]);
  });

  it("does not update the same stage twice when an id is repeated", () => {
    const plan = planStageReconcile(EXISTING, [
      { id: APPLIED, name: "First" },
      { id: APPLIED, name: "Duplicate" },
      { id: HIRED, name: "Hired" },
      { id: REJECTED, name: "Rejected" },
    ]);

    expect(plan.update.filter((s) => s.id === APPLIED)).toHaveLength(1);
    expect(plan.insert).toEqual([{ name: "Duplicate", sortOrder: 1 }]);
  });

  it("clearing every stage deletes them all", () => {
    const plan = planStageReconcile(EXISTING, []);

    expect(plan.deleteIds).toEqual(EXISTING);
    expect(plan.update).toEqual([]);
    expect(plan.insert).toEqual([]);
  });
});
