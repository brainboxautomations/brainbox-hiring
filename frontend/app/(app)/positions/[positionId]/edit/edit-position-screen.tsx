"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useNavigate } from "@/hooks/use-navigate";

import { Button } from "@/components/atoms/button";
import { ErrorAlert } from "@/components/molecules/error-alert";
import { PositionFormSkeleton } from "@/components/molecules/position-form-skeleton";
import { PositionPublicLink } from "@/components/molecules/position-public-link";
import { PositionStatusBadge } from "@/components/molecules/position-status-badge";
import { PositionApplicationStep } from "@/components/organisms/position-form/position-application-step";
import { PositionDescriptionStep } from "@/components/organisms/position-form/position-description-step";
import { PositionDetailsStep } from "@/components/organisms/position-form/position-details-step";
import { PositionFormNav } from "@/components/organisms/position-form/position-form-nav";
import {
  POSITION_EDIT_STEPS,
  positionFormStep,
  type PositionFormStepKey,
} from "@/components/organisms/position-form/position-form-steps";
import {
  positionFormValues,
  salaryRangeError,
  toPositionInput,
  type PositionFormValues,
} from "@/components/organisms/position-form/position-form-values";
import { PositionPipelineStep } from "@/components/organisms/position-form/position-pipeline-step";
import { PositionPreview } from "@/components/organisms/position-form/position-preview";
import { StageActionsPanel } from "@/components/organisms/stage-actions-panel";
import { usePipelines } from "@/hooks/use-pipelines";
import { useQuestionnaires } from "@/hooks/use-questionnaires";
import { usePosition, useSetPositionStatus, useUpdatePosition } from "@/hooks/use-positions";
import type { PositionStatus } from "@/types/api";
import { apiErrorMessage, apiErrorStatus } from "@/utilities/api-error";
import {
  PIPELINE_FREEZE_EXPLANATION,
  POSITION_STATUS_TRANSITIONS,
  isPipelineEditable,
} from "@/utilities/position-status";

type FormState = { positionId: string; values: PositionFormValues };

function saveErrorMessage(error: unknown): string {
  if (apiErrorStatus(error) === 409) return PIPELINE_FREEZE_EXPLANATION;
  return apiErrorMessage(error, "Could not save this position.");
}

export function EditPositionScreen({ positionId }: { positionId: string }) {
  const navigate = useNavigate();

  const positionQuery = usePosition(positionId);
  const pipelinesQuery = usePipelines();
  const questionnairesQuery = useQuestionnaires();
  const updatePosition = useUpdatePosition();
  const setPositionStatus = useSetPositionStatus();

  const [stepKey, setStepKey] = useState<PositionFormStepKey>("details");
  const [form, setForm] = useState<FormState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);

  const position = positionQuery.data;

  const pipelines = useMemo(() => pipelinesQuery.data ?? [], [pipelinesQuery.data]);
  const questionnaires = useMemo(() => questionnairesQuery.data ?? [], [questionnairesQuery.data]);

  if (positionQuery.isLoading || pipelinesQuery.isLoading || questionnairesQuery.isLoading) {
    return (
      <div role="status" className="mx-auto max-w-190 px-8 pb-16 pt-7">
        <span className="sr-only">Loading position…</span>
        <PositionFormSkeleton />
      </div>
    );
  }

  if (positionQuery.isError || !position) {
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-3 px-6 py-24 text-center"
      >
        <div className="text-[15px] font-semibold text-red-800">Couldn’t load this position</div>
        <div className="max-w-85 text-[13px] leading-relaxed text-red-700">
          {apiErrorMessage(positionQuery.error, "It may have been removed.")}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            loading={positionQuery.isFetching}
            onClick={() => positionQuery.refetch()}
          >
            Try again
          </Button>
          <Link
            href="/positions"
            className="flex h-8 items-center rounded-md px-3 text-[13px] font-medium text-accent-11 hover:underline"
          >
            All positions
          </Link>
        </div>
      </div>
    );
  }

  const values = form?.positionId === position.id ? form.values : positionFormValues(position);
  const step = positionFormStep(stepKey);
  const pipelineEditable = isPipelineEditable(position.status);

  const assignedPipelineName =
    pipelines.find((pipeline) => pipeline.id === position.assignedPipelineId)?.name ?? null;
  const pipelineChanged = values.assignedPipelineId !== position.assignedPipelineId;
  const selectedPipeline = pipelines.find((pipeline) => pipeline.id === values.assignedPipelineId);
  // The position's own stages (position.stages) carry real, position-owned
  // ids that stage actions attach to. A pipeline TEMPLATE's stages (from
  // `pipelines`) only exist as a preview of what re-assigning the pipeline
  // would produce — their ids belong to the template, not this position, and
  // won't match anything once saved. Only show the template's stages while
  // the user has actually picked a different pipeline than the one assigned;
  // otherwise stick with the position's real stages so "Add stage actions"
  // keeps working on the currently assigned pipeline.
  const stages =
    pipelineEditable && pipelineChanged
      ? (selectedPipeline?.stages ?? position.stages)
      : position.stages;

  const change = (patch: Partial<PositionFormValues>) => {
    setSaved(false);
    setForm({ positionId: position.id, values: { ...values, ...patch } });
  };

  const save = () => {
    setSaveError(null);
    setSaved(false);
    if (!values.title.trim()) {
      setSaveError("A position title is required.");
      setStepKey("details");
      return;
    }
    const salaryError = salaryRangeError(values);
    if (salaryError) {
      setSaveError(salaryError);
      setStepKey("details");
      return;
    }

    const { assignedPipelineId, ...editableFields } = toPositionInput(values);
    const input = pipelineEditable ? { ...editableFields, assignedPipelineId } : editableFields;

    updatePosition.mutate(
      { id: position.id, input },
      {
        onSuccess: () => setSaved(true),
        onError: (error) => setSaveError(saveErrorMessage(error)),
      },
    );
  };

  const changeStatus = (status: PositionStatus) => {
    setStatusError(null);
    setPositionStatus.mutate(
      { id: position.id, status },
      { onError: (error) => setStatusError(apiErrorMessage(error, "Could not change status.")) },
    );
  };

  return (
    <div className="mx-auto max-w-190 px-8 pb-16 pt-7">
      <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-slate-400">
        Edit position
      </div>

      <PositionFormNav steps={POSITION_EDIT_STEPS} current={stepKey} onSelect={setStepKey} />

      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="mb-1 truncate text-[22px] font-semibold tracking-[-0.02em]">
            {position.title}
          </h1>
          <p className="text-[13px] text-slate-500">
            {step.name} — {step.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 pt-1">
          <PositionStatusBadge status={position.status} />
          <Button
            variant="ghost"
            size="sm"
            loading={navigate.isNavigating}
            onClick={() => navigate.push("/positions")}
          >
            Cancel
          </Button>
        </div>
      </div>

      {saveError && (
        <ErrorAlert title="Couldn’t save this position" message={saveError} className="mb-5.5" />
      )}

      {saved && !saveError && (
        <div
          role="status"
          className="mb-5.5 rounded-lg border border-green-200 bg-green-50 px-3.5 py-3 text-[13px] text-green-800"
        >
          Changes saved.
        </div>
      )}

      {stepKey === "details" && <PositionDetailsStep values={values} onChange={change} />}

      {stepKey === "description" && <PositionDescriptionStep values={values} onChange={change} />}

      {stepKey === "application" && (
        <div className="flex flex-col gap-6">
          {/* Sits with the Listed/Unlisted/Disabled choice it belongs to: an
              unlisted position is "reachable by direct link only", and this is
              the only place in the app that link can be obtained. */}
          <PositionPublicLink
            slug={position.slug}
            status={position.status}
            publishMode={position.publishMode}
          />
          <PositionApplicationStep
            values={values}
            onChange={change}
            questionnaires={questionnaires}
          />
        </div>
      )}

      {stepKey === "pipeline" && (
        <PositionPipelineStep
          values={values}
          onChange={change}
          pipelines={pipelines}
          stages={stages}
          pipelineFrozen={!pipelineEditable}
          assignedPipelineName={assignedPipelineName}
          onEditStageActions={(stageId) => setSelectedStageId(stageId)}
        />
      )}

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 px-4.5">
        <div className="mb-1 text-[13px] font-semibold text-slate-900">Status</div>
        <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
          Closing a position stops new applications. Candidates already in the pipeline stay where
          they are — nobody is moved, rejected or emailed.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {POSITION_STATUS_TRANSITIONS[position.status].map((transition) => (
            <Button
              key={transition.status}
              size="sm"
              variant="secondary"
              disabled={setPositionStatus.isPending}
              // Spin only the button that was pressed; the rest just lock.
              loading={
                setPositionStatus.isPending &&
                setPositionStatus.variables?.status === transition.status
              }
              onClick={() => changeStatus(transition.status)}
            >
              {transition.label}
            </Button>
          ))}
        </div>
        {statusError && (
          <ErrorAlert title="Couldn’t change status" message={statusError} className="mt-3" />
        )}
      </section>

      <div className="mt-4 flex items-center gap-3 border-t border-slate-200 pt-5">
        <Link
          href={`/positions/${position.id}/board`}
          className="text-[13px] text-accent-11 hover:underline"
        >
          View board
        </Link>
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="text-[13px] text-accent-11 hover:underline"
        >
          Preview
        </button>
        <div className="flex-1" />
        <Button variant="primary" loading={updatePosition.isPending} onClick={save}>
          Save changes
        </Button>
      </div>

      {previewOpen && <PositionPreview values={values} onClose={() => setPreviewOpen(false)} />}

      {selectedStageId && (
        <div className="fixed inset-0 z-50">
          <StageActionsPanel
            positionId={position.id}
            stageId={selectedStageId}
            onClose={() => setSelectedStageId(null)}
          />
        </div>
      )}
    </div>
  );
}
