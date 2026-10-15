"use client";

import { cn } from "@/utilities/cn";
import { Input, Field, Label } from "@/components/atoms/input";
import { Select } from "@/components/atoms/select";
import { LockIcon } from "@/components/atoms/icons";
import type { Pipeline, PipelineStage } from "@/types/api";
import { PIPELINE_FREEZE_EXPLANATION } from "@/utilities/position-status";
import type { PositionFormValues } from "./position-form-values";

type PositionPipelineStepProps = {
  values: PositionFormValues;
  onChange: (patch: Partial<PositionFormValues>) => void;
  pipelines: Pipeline[];
  stages: PipelineStage[];
  pipelineFrozen?: boolean;
  assignedPipelineName?: string | null;
  onEditStageActions: (stageId: string) => void;
  /**
   * The stage whose actions are being opened. Opening one saves the position
   * first, so every button is locked meanwhile: a second click used to start a
   * second save and create a second draft position.
   */
  openingStageId?: string | null;
};

const STAGE_DOT_CLASS = "bg-slate-400";

function StageRow({
  stage,
  onEditStageActions,
  openingStageId,
}: {
  stage: PipelineStage;
  onEditStageActions: (stageId: string) => void;
  openingStageId?: string | null;
}) {
  const opening = openingStageId === stage.id;
  return (
    <div className="flex items-center gap-2.75 border-b border-slate-100 px-3.5 py-2.75 last:border-b-0">
      <span className={cn("h-1.75 w-1.75 shrink-0 rounded-full", STAGE_DOT_CLASS)} />
      <span className="flex-1 text-[13px] text-slate-700">{stage.name}</span>
      <button
        type="button"
        disabled={Boolean(openingStageId)}
        onClick={() => onEditStageActions(stage.id)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-11 hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50"
      >
        {opening && (
          <span className="inline-block h-3 w-3 animate-[ds-spin_0.7s_linear_infinite] rounded-full border-2 border-current/30 border-t-current" />
        )}
        {opening ? "Opening…" : "Add stage actions"}
      </button>
    </div>
  );
}

export function PositionPipelineStep({
  values,
  onChange,
  pipelines,
  stages,
  pipelineFrozen = false,
  assignedPipelineName = null,
  onEditStageActions,
  openingStageId = null,
}: PositionPipelineStepProps) {
  return (
    <div className="flex flex-col gap-5.5">
      {pipelineFrozen ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <LockIcon size={12} className="text-slate-400" />
            Pipeline template
          </div>
          <div className="mt-1.5 text-[13px] font-medium text-slate-900">
            {assignedPipelineName ?? "No pipeline assigned"}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
            {PIPELINE_FREEZE_EXPLANATION}
          </p>
        </div>
      ) : pipelines.length === 0 ? (
        <div>
          <Label>Pipeline template</Label>
          <p className="rounded-lg border border-dashed border-slate-300 px-3.5 py-3 text-xs leading-relaxed text-slate-500">
            No pipeline templates exist yet. Create one under Pipelines, then come back to assign
            it.
          </p>
        </div>
      ) : (
        <Field label="Pipeline template" htmlFor="pipeline">
          <Select
            id="pipeline"
            value={values.assignedPipelineId}
            onChange={(e) => onChange({ assignedPipelineId: e.target.value })}
            options={pipelines.map((pipeline) => ({ value: pipeline.id, label: pipeline.name }))}
          />
        </Field>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-700">Stages &amp; automations</span>
          <span className="text-[11px] text-slate-400">{stages.length} stages</span>
        </div>
        {stages.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-3.5 py-6 text-center text-xs text-slate-400">
            No stages yet — assign a pipeline to give this position its stages.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            {stages.map((stage) => (
              <StageRow
                key={stage.id}
                stage={stage}
                onEditStageActions={onEditStageActions}
                openingStageId={openingStageId}
              />
            ))}
          </div>
        )}
        <div className="mt-2 text-[11px] leading-relaxed text-slate-400">
          Stage-action changes here apply only to this position — the template is unchanged.
        </div>
      </div>

      <Field
        label="Email sender name"
        htmlFor="emailSenderName"
        hint="Shown as the sender on this position's automated emails. Blank uses the company name."
      >
        <Input
          id="emailSenderName"
          value={values.emailSenderName}
          onChange={(e) => onChange({ emailSenderName: e.target.value })}
          placeholder="e.g. Acme Talent"
        />
      </Field>
    </div>
  );
}
