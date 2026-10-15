"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useNavigate } from "@/hooks/use-navigate";

import { Button } from "@/components/atoms/button";
import { ErrorAlert } from "@/components/molecules/error-alert";
import { PositionFormSkeleton } from "@/components/molecules/position-form-skeleton";
import { PositionApplicationStep } from "@/components/organisms/position-form/position-application-step";
import { PositionDescriptionStep } from "@/components/organisms/position-form/position-description-step";
import { PositionDetailsStep } from "@/components/organisms/position-form/position-details-step";
import { PositionFormNav } from "@/components/organisms/position-form/position-form-nav";
import {
  POSITION_FORM_STEPS,
  type PositionFormStepKey,
} from "@/components/organisms/position-form/position-form-steps";
import {
  createPositionFormValues,
  salaryRangeError,
  toPositionInput,
  type PositionFormValues,
} from "@/components/organisms/position-form/position-form-values";
import { PositionPipelineStep } from "@/components/organisms/position-form/position-pipeline-step";
import { PositionPreview } from "@/components/organisms/position-form/position-preview";
import { PositionReviewStep } from "@/components/organisms/position-form/position-review-step";
import { StageActionsPanel } from "@/components/organisms/stage-actions-panel";
import { usePipelines } from "@/hooks/use-pipelines";
import { useProgressWhile } from "@/hooks/use-progress";
import { useQuestionnaires } from "@/hooks/use-questionnaires";
import { useCreatePosition, useUpdatePosition } from "@/hooks/use-positions";
import { apiErrorMessage } from "@/utilities/api-error";
import {
  clearPositionDraft,
  readPositionDraft,
  writePositionDraft,
} from "@/utilities/position-draft-storage";

export default function NewPositionPage() {
  const router = useRouter();
  const navigate = useNavigate();

  // The step lives in the URL and the answers in sessionStorage, so refreshing
  // mid-wizard returns to the same step with the same work rather than to an
  // empty step 1. Both are read once, during the first render, so there is no
  // flash of step 1 before the restore lands.
  //
  // `?step=` is what separates a refresh from a fresh start. The wizard writes
  // it on every step change, so a reload still carries it, while "Create
  // position" links to a bare /positions/new. Without that distinction an
  // abandoned draft would silently refill the form the next time someone
  // started a position — which is worse than losing it, since a stale title
  // and department look exactly like fields the user just filled in.
  const searchParams = useSearchParams();
  const requestedStep = searchParams.get("step");
  const resuming = POSITION_FORM_STEPS.some((candidate) => candidate.key === requestedStep);
  const restored = resuming ? readPositionDraft() : null;

  const [stepIndex, setStepIndex] = useState(() =>
    Math.max(
      0,
      POSITION_FORM_STEPS.findIndex((candidate) => candidate.key === requestedStep),
    ),
  );
  const [values, setValues] = useState<PositionFormValues>(
    () => restored?.values ?? createPositionFormValues(),
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  // The stage whose actions are being opened, while its save runs.
  const [openingStageId, setOpeningStageId] = useState<string | null>(null);
  const stageActionsSaving = openingStageId !== null;
  const [stageActionsTarget, setStageActionsTarget] = useState<{
    positionId: string;
    stageId: string;
  } | null>(null);
  // Set the first time "Add stage actions" creates a draft so it can be
  // reused, instead of creating a new draft position on every click — each
  // click used to spin up a fresh position, so a stage action saved against
  // the first draft would seem to "disappear" once a later click created a
  // second, unrelated draft and the panel switched to showing that one.
  // Restored alongside the answers: without it a refresh would forget the draft
  // already created here and submit would create a second, orphaned position.
  const [createdPositionId, setCreatedPositionId] = useState<string | null>(
    () => restored?.createdPositionId ?? null,
  );

  useProgressWhile(stageActionsSaving);

  // Mirror the current step into the URL. `replace` rather than `push` so the
  // browser Back button still leaves the wizard instead of walking back through
  // every step the user visited.
  const step = POSITION_FORM_STEPS[stepIndex]!;
  useEffect(() => {
    if (searchParams.get("step") === step.key) return;
    router.replace(`/positions/new?step=${step.key}`, { scroll: false });
  }, [router, searchParams, step.key]);

  // Starting fresh discards whatever an earlier, abandoned wizard left behind,
  // so the next refresh cannot resurrect it.
  useEffect(() => {
    if (!resuming) clearPositionDraft();
    // Only on mount: `resuming` goes false as soon as the step lands in the
    // URL, and re-running then would wipe the draft being written.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the answers as they change. Submitting clears the draft, so a save
  // that lands after that must not write it back — hence the guard.
  const draftCleared = useRef(false);
  useEffect(() => {
    if (draftCleared.current) return;
    writePositionDraft({ values, createdPositionId });
  }, [values, createdPositionId]);

  const pipelinesQuery = usePipelines();
  const questionnairesQuery = useQuestionnaires();
  const createPosition = useCreatePosition();
  const updatePosition = useUpdatePosition();

  const availablePipelines = useMemo(() => pipelinesQuery.data ?? [], [pipelinesQuery.data]);
  const availableQuestionnaires = useMemo(
    () => questionnairesQuery.data ?? [],
    [questionnairesQuery.data],
  );

  if (pipelinesQuery.isLoading || questionnairesQuery.isLoading) {
    return (
      <div className="mx-auto max-w-190 px-8 pb-16 pt-7">
        <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-slate-400">
          Create a new position
        </div>
        <PositionFormSkeleton />
      </div>
    );
  }

  const isReview = step.key === "review";
  // Saving and then loading the positions list is one wait to the user; the
  // spinner used to stop between the two and leave the button looking idle.
  // Includes opening a stage's actions, which saves the same position: Save as
  // draft or Publish running alongside it could create a second one.
  const saving =
    createPosition.isPending ||
    updatePosition.isPending ||
    navigate.isNavigating ||
    stageActionsSaving;

  const selectedPipelineId = values.assignedPipelineId || availablePipelines[0]?.id || "";
  const selectedPipeline =
    availablePipelines.find((pipeline) => pipeline.id === selectedPipelineId) ?? null;
  const stages = selectedPipeline?.stages ?? [];

  const questionnaireName =
    availableQuestionnaires.find(
      (questionnaire) => questionnaire.id === values.applicationQuestionnaireId,
    )?.name ?? "None";

  const change = (patch: Partial<PositionFormValues>) => {
    if (patch.title !== undefined && patch.title.trim()) setTitleError(null);
    setValues((previous) => ({ ...previous, ...patch }));
  };

  function detailsValid() {
    if (!values.title.trim()) {
      setTitleError("A position title is required.");
      return false;
    }
    return salaryRangeError(values) === null;
  }

  const goTo = (key: PositionFormStepKey) => {
    if (step.key === "details" && key !== "details" && !detailsValid()) return;
    setStepIndex(POSITION_FORM_STEPS.findIndex((candidate) => candidate.key === key));
  };

  function submit(status: "draft" | "open") {
    setSubmitError(null);
    if (!values.title.trim()) {
      setSubmitError("A position title is required.");
      goTo("details");
      return;
    }
    const salaryError = salaryRangeError(values);
    if (salaryError) {
      setSubmitError(salaryError);
      goTo("details");
      return;
    }
    const input = { ...toPositionInput(values), assignedPipelineId: selectedPipelineId || null };
    const onSettled = {
      onSuccess: () => {
        // The work is saved on the server now, so the scratch copy would only
        // resurrect a stale form the next time the wizard opened.
        draftCleared.current = true;
        clearPositionDraft();
        navigate.push("/positions");
      },
      onError: (error: unknown) =>
        setSubmitError(apiErrorMessage(error, "Could not save this position.")),
    };

    if (createdPositionId) {
      updatePosition.mutate({ id: createdPositionId, input: { ...input, status } }, onSettled);
    } else {
      createPosition.mutate({ ...input, status }, onSettled);
    }
  }

  async function goToStageActions(stageId: string) {
    setSubmitError(null);
    if (!values.title.trim()) {
      setSubmitError("A position title is required.");
      goTo("details");
      return;
    }
    const salaryError = salaryRangeError(values);
    if (salaryError) {
      setSubmitError(salaryError);
      goTo("details");
      return;
    }
    const input = { ...toPositionInput(values), assignedPipelineId: selectedPipelineId || null };
    const clickedStage = stages.find((row) => row.id === stageId);
    setOpeningStageId(stageId);
    try {
      // Reuse the draft created by an earlier "Add stage actions" click
      // instead of creating a new position every time — creating fresh each
      // time abandoned the previous draft (and any stage actions already
      // saved on it) the moment a second stage's actions were opened.
      const position = createdPositionId
        ? await updatePosition.mutateAsync({
            id: createdPositionId,
            input: { ...input, status: "draft" },
          })
        : await createPosition.mutateAsync({ ...input, status: "draft" });
      setCreatedPositionId(position.id);
      // The clicked stage id belongs to the pipeline TEMPLATE. Snapshotting
      // the pipeline onto the position copies its stages into new,
      // position-owned rows with their own ids (see
      // snapshot_pipeline_to_position), so the template's id never matches
      // anything on the position. The snapshot preserves sortOrder, so
      // that's the reliable join key.
      const createdStage =
        position.stages.find((row) => row.sortOrder === clickedStage?.sortOrder) ??
        position.stages.find((row) => row.id === stageId);
      if (!createdStage) {
        setSubmitError("That stage could not be found on the new position.");
        return;
      }
      setStageActionsTarget({ positionId: position.id, stageId: createdStage.id });
    } catch (error) {
      setSubmitError(apiErrorMessage(error, "Could not save this position."));
    } finally {
      setOpeningStageId(null);
    }
  }

  const onNext = () => {
    if (step.key === "details" && !detailsValid()) return;
    if (isReview) {
      submit("open");
      return;
    }
    setStepIndex((index) => Math.min(POSITION_FORM_STEPS.length - 1, index + 1));
  };

  const nextLabel = isReview ? "Publish position" : step.key === "pipeline" ? "Review" : "Next";

  return (
    <div className="mx-auto max-w-190 px-8 pb-16 pt-7">
      <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-slate-400">
        Create a new position
      </div>

      <PositionFormNav
        steps={POSITION_FORM_STEPS}
        current={step.key}
        completedBefore={stepIndex}
        onSelect={goTo}
      />

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-[22px] font-semibold tracking-[-0.02em]">{step.name}</h1>
          <p className="text-[13px] text-slate-500">{step.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Cancel means abandon: keeping the draft would silently refill
              // the form the next time someone started a position.
              draftCleared.current = true;
              clearPositionDraft();
              navigate.push("/positions");
            }}
          >
            Cancel
          </Button>
        </div>
      </div>

      {submitError && (
        <ErrorAlert title="Couldn’t save this position" message={submitError} className="mb-5.5" />
      )}

      {step.key === "details" && (
        <PositionDetailsStep values={values} onChange={change} titleError={titleError} />
      )}

      {step.key === "description" && <PositionDescriptionStep values={values} onChange={change} />}

      {step.key === "application" && (
        <PositionApplicationStep
          values={values}
          onChange={change}
          questionnaires={availableQuestionnaires}
        />
      )}

      {step.key === "pipeline" && (
        <PositionPipelineStep
          values={{ ...values, assignedPipelineId: selectedPipelineId }}
          onChange={change}
          pipelines={availablePipelines}
          stages={stages}
          onEditStageActions={(stageId) => void goToStageActions(stageId)}
          openingStageId={openingStageId}
        />
      )}

      {isReview && (
        <PositionReviewStep
          values={values}
          pipelineName={selectedPipeline?.name ?? null}
          stageCount={stages.length}
          questionnaireName={questionnaireName}
          onEditStep={goTo}
        />
      )}

      <div className="mt-6 flex items-center gap-3 border-t border-slate-200 pt-5">
        {stepIndex > 0 && (
          <Button variant="secondary" onClick={() => setStepIndex((index) => index - 1)}>
            Back
          </Button>
        )}
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="text-[13px] text-accent-11 hover:underline"
        >
          Preview
        </button>
        <div className="flex-1" />
        {isReview && (
          <Button variant="secondary" loading={saving} onClick={() => submit("draft")}>
            Save as draft
          </Button>
        )}
        <Button variant="primary" loading={saving} onClick={onNext}>
          {nextLabel}
        </Button>
      </div>

      {previewOpen && <PositionPreview values={values} onClose={() => setPreviewOpen(false)} />}

      {stageActionsTarget && (
        <div className="fixed inset-0 z-50">
          <StageActionsPanel
            positionId={stageActionsTarget.positionId}
            stageId={stageActionsTarget.stageId}
            onClose={() => setStageActionsTarget(null)}
            draftSavedBanner
          />
        </div>
      )}
    </div>
  );
}
