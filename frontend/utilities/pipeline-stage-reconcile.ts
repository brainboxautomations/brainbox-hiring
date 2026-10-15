import type { PipelineStageInput } from "@/types/api";
import { planReconcileById } from "@/utilities/reconcile-by-id";

export type StageReconcilePlan = {
  /** Stages that survive the edit, updated in place so their ids are preserved. */
  update: { id: string; name: string; sortOrder: number }[];
  /** Stages the edit introduces. */
  insert: { name: string; sortOrder: number }[];
  /** Stages the user actually removed. Only these sever their position links. */
  deleteIds: string[];
};

/**
 * Works out how to turn the pipeline's current stages into the submitted ones
 * *without* recreating the rows that survive.
 *
 * This distinction is the whole point. `position_stages.source_template_stage_id`
 * references a template stage with `on delete set null`, and
 * `snapshot_pipeline_to_position` refuses to run once a position is live — so a
 * stage row that is deleted and re-inserted silently and permanently severs
 * every live position built from this pipeline from its own stages. Renaming or
 * reordering a stage must therefore update the existing row, never replace it.
 *
 * A submitted stage counts as surviving only when it carries an id the pipeline
 * actually has: an unknown or absent id is treated as a new stage, so a client
 * cannot adopt a row belonging to another pipeline.
 */
export function planStageReconcile(
  existingIds: string[],
  submitted: PipelineStageInput[],
): StageReconcilePlan {
  const plan = planReconcileById(existingIds, submitted);
  return {
    update: plan.update.map(({ id, item, sortOrder }) => ({ id, name: item.name, sortOrder })),
    insert: plan.insert.map(({ item, sortOrder }) => ({ name: item.name, sortOrder })),
    deleteIds: plan.deleteIds,
  };
}
