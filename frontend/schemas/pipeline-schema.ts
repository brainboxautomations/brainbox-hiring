import { z } from "zod";

export const pipelineStageInputSchema = z.object({
  // Present for a stage that already exists. Carrying it through the edit is
  // what keeps `position_stages.source_template_stage_id` pointing at something:
  // that column is `on delete set null`, and `snapshot_pipeline_to_position`
  // refuses to re-run once a position is live, so a stage row that is dropped
  // and recreated severs every live position's link to it for good.
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Stage name is required"),
});

export const pipelineInputSchema = z.object({
  name: z.string().trim().min(1, "Pipeline name is required"),
  stages: z.array(pipelineStageInputSchema).min(1, "Add at least one stage"),
});

export type PipelineInputValues = z.infer<typeof pipelineInputSchema>;
