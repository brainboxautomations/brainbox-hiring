"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { cn } from "@/utilities/cn";
import {
  useBulkEmailCandidates,
  useBulkSendQuestionnaire,
  useBulkUpdateCandidates,
  useCandidates,
  useExportCandidates,
  useUpdateCandidate,
} from "@/hooks/use-candidates";
import { usePosition, usePositions } from "@/hooks/use-positions";
import { useMessageTemplates } from "@/hooks/use-message-templates";
import { useCancelMessageBatch } from "@/hooks/use-messages";
import { messageTimestamp } from "@/utilities/relative-time";
import { useQuestionnaires } from "@/hooks/use-questionnaires";
import { StageActionsPanel } from "@/components/organisms/stage-actions-panel";
import type { BulkCandidatePatch, Candidate, PipelineStage, PositionListItem } from "@/types/api";
import { apiErrorMessage } from "@/utilities/api-error";
import {
  buildBulkOutcome,
  buildHeldSendOutcome,
  buildUndoneOutcome,
  buildExportOutcome,
  bulkErrorOutcome,
  type BulkActionOutcome,
  type BulkActionVerb,
} from "@/utilities/bulk-action-outcome";
import {
  emptyCandidateFilters,
  hasActiveCandidateFilters,
  type CandidateFilters,
  type DateWindow,
} from "@/utilities/candidate-filters";
import {
  boardStageOrder,
  orderedBoardCandidates,
  type CandidateNavigationContext,
} from "@/utilities/candidate-navigation";
import { MAX_BULK_SELECTION } from "@/schemas/bulk-candidate-schema";
import { candidateExportCsv, candidateExportFilename } from "@/utilities/candidate-export";
import { CheckboxIndicator } from "@/components/atoms/checkbox";
import { CandidatesBoardSkeleton } from "@/components/molecules/candidates-board-skeleton";
import { DateWindowFilter } from "@/components/molecules/date-window-filter";
import { FloatingMenu } from "@/components/molecules/floating-menu";
import { BulkActionBar, type BulkActionId } from "@/components/organisms/bulk-action-bar";
import { CandidateCard } from "@/components/organisms/candidate-card";
import { useNow } from "@/hooks/use-now";
import { SearchIcon, FilterIcon, ChevronDownIcon, StarIcon } from "@/components/atoms/icons";
import { Clock } from "lucide-react";

const STAGE_DOT_CLASS = "bg-slate-400";

function locationLabel(p: PositionListItem): string {
  const first = p.locations[0];
  if (!first) return "—";
  return first.detail?.trim() || first.country;
}

function candidateName(candidate: Candidate): string {
  return [candidate.firstName, candidate.lastName].filter(Boolean).join(" ").trim();
}

function downloadCsvFile(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export function PipelineBoardScreen({ positionId }: { positionId: string }) {
  const positionQuery = usePosition(positionId);
  const positionsQuery = usePositions();
  // Declared before the query so polling can be held off while a card is being
  // dragged; a refetch landing mid-drag would undo the optimistic move.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const candidatesQuery = useCandidates(positionId, { paused: draggingId !== null });
  const searchParams = useSearchParams();

  const position = positionQuery.data;
  const candidates = useMemo(() => candidatesQuery.data ?? [], [candidatesQuery.data]);

  const boardStages = useMemo(() => boardStageOrder(position?.stages ?? []), [position]);

  const updateCandidate = useUpdateCandidate(positionId);
  const bulkUpdateCandidates = useBulkUpdateCandidates(positionId);
  const bulkEmailCandidates = useBulkEmailCandidates(positionId);
  const cancelMessageBatch = useCancelMessageBatch();
  const bulkSendQuestionnaire = useBulkSendQuestionnaire(positionId);
  const exportCandidates = useExportCandidates();
  const messageTemplates = useMessageTemplates();
  const questionnaires = useQuestionnaires();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectModeOverride, setSelectModeOverride] = useState<boolean | null>(null);
  const [selectionOverride, setSelectionOverride] = useState<Set<string> | null>(null);
  const [filters, setFilters] = useState<CandidateFilters>(emptyCandidateFilters);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [pendingBulkAction, setPendingBulkAction] = useState<BulkActionId | null>(null);
  const [bulkOutcome, setBulkOutcome] = useState<BulkActionOutcome | null>(null);
  const [stageActionsStageId, setStageActionsStageId] = useState<string | null>(null);

  const patchFilters = (patch: Partial<CandidateFilters>) =>
    setFilters((previous) => ({ ...previous, ...patch }));

  // Ticks so "12m in stage" keeps counting without a reload. Deliberately not
  // fed into the sort below: re-ordering the board every tick would move cards
  // out from under the pointer mid-drag.
  const now = useNow();

  const visible = useMemo(
    () => orderedBoardCandidates(candidates, boardStages, filters, new Date()),
    [candidates, boardStages, filters],
  );

  const navigationContext: CandidateNavigationContext = { positionId, filters };

  const arrivedToEmailEveryone = searchParams.get("select") === "all";

  const selectableIds = useMemo(
    () => visible.slice(0, MAX_BULK_SELECTION).map((candidate) => candidate.id),
    [visible],
  );

  const selectMode = selectModeOverride ?? arrivedToEmailEveryone;

  const selected = useMemo(
    () => new Set(selectionOverride ?? (arrivedToEmailEveryone ? selectableIds : [])),
    [selectionOverride, arrivedToEmailEveryone, selectableIds],
  );

  const selectionNotice =
    selected.size >= MAX_BULK_SELECTION
      ? `A bulk action covers at most ${MAX_BULK_SELECTION} candidates at a time. ${selected.size} of the ${visible.length} in this view are selected — narrow the filters and run it again for the rest.`
      : null;

  const byStage = (stageId: string) => visible.filter((c) => c.stageId === stageId);
  const activeCount = boardStages.reduce((n, s) => n + byStage(s.id).length, 0);

  const replaceSelection = (ids: Iterable<string>) => setSelectionOverride(new Set(ids));

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      if (next.size >= MAX_BULK_SELECTION) return;
      next.add(id);
    }
    setSelectionOverride(next);
  };

  const toggleStageFilter = (stageId: string) =>
    setFilters((previous) => {
      const stageIds = new Set(previous.stageIds);
      if (stageIds.has(stageId)) {
        stageIds.delete(stageId);
      } else {
        stageIds.add(stageId);
      }
      return { ...previous, stageIds };
    });

  const toggleStar = (id: string) => {
    const c = candidates.find((x) => x.id === id);
    if (!c) return;
    updateCandidate.mutate({ id, patch: { starred: !c.starred } });
  };

  const openCandidate = (id: string) => {
    const c = candidates.find((x) => x.id === id);
    if (c && !c.seen) updateCandidate.mutate({ id, patch: { seen: true } });
  };

  const moveCandidate = (id: string, stageId: string) => {
    const c = candidates.find((x) => x.id === id);
    if (!c || c.stageId === stageId) return;
    updateCandidate.mutate({ id, patch: { stageId } });
  };

  const endDrag = () => {
    setDraggingId(null);
    setDragOverStage(null);
  };

  const dropOnStage = (stageId: string) => {
    if (draggingId) moveCandidate(draggingId, stageId);
    endDrag();
  };

  const nameForApplication = (applicationId: string): string | null => {
    const candidate = candidates.find((c) => c.id === applicationId);
    return candidate ? candidateName(candidate) : null;
  };

  const runBulkUpdate = (
    action: Exclude<BulkActionId, "export">,
    patch: BulkCandidatePatch,
    verb: BulkActionVerb,
  ) => {
    const applicationIds = [...selected];
    if (applicationIds.length === 0) return;

    setPendingBulkAction(action);
    setBulkOutcome(null);

    bulkUpdateCandidates.mutate(
      { applicationIds, patch },
      {
        onSuccess: (result) => {
          setPendingBulkAction(null);
          setBulkOutcome(
            buildBulkOutcome(
              { succeeded: result.updated.length, failures: result.failures },
              applicationIds.length,
              verb,
              nameForApplication,
            ),
          );
          replaceSelection(result.failures.map((failure) => failure.applicationId));
        },
        onError: (error) => {
          setPendingBulkAction(null);
          setBulkOutcome(
            bulkErrorOutcome(
              verb.pastTense,
              apiErrorMessage(error, "The server refused this bulk action."),
            ),
          );
        },
      },
    );
  };

  const bulkMoveToStage = (stageId: string) => {
    const stage = position?.stages.find((s) => s.id === stageId);
    runBulkUpdate(
      "move",
      { stageId },
      {
        pastTense: "moved",
        successMessage: `Now in ${stage?.name ?? "the chosen stage"}.`,
      },
    );
  };

  const bulkSendEmail = (messageTemplateId: string) => {
    const applicationIds = [...selected];
    if (applicationIds.length === 0) return;

    setPendingBulkAction("email");
    setBulkOutcome(null);

    bulkEmailCandidates.mutate(
      { applicationIds, messageTemplateId },
      {
        onSuccess: (result) => {
          setPendingBulkAction(null);
          const heldIds = result.scheduledMessageIds ?? [];
          if (result.scheduledReason === "undo" && heldIds.length > 0) {
            const undoAll = async () => {
              try {
                const undone = await cancelMessageBatch.mutateAsync(heldIds);
                setBulkOutcome(buildUndoneOutcome(undone.cancelled, undone.alreadyGone));
              } catch (error) {
                setBulkOutcome(
                  bulkErrorOutcome(
                    "undone",
                    apiErrorMessage(
                      error,
                      "The batch could not be undone. Undo each one from its thread.",
                    ),
                  ),
                );
              }
            };
            setBulkOutcome({
              ...buildHeldSendOutcome(
                {
                  held: heldIds.length,
                  failures: result.failures,
                  requestedCount: applicationIds.length,
                  sendAtLabel: messageTimestamp(result.scheduledFor ?? null),
                },
                nameForApplication,
              ),
              action: { label: "Undo all", onClick: () => void undoAll() },
            });
            replaceSelection(result.failures.map((failure) => failure.applicationId));
            return;
          }
          setBulkOutcome(
            buildBulkOutcome(
              {
                succeeded: result.sent.length,
                failures: result.failures,
                deferred: result.scheduled?.length ?? 0,
              },
              applicationIds.length,
              {
                pastTense: "emailed",
                successMessage: "Each candidate received their own message.",
              },
              nameForApplication,
            ),
          );
          replaceSelection(result.failures.map((failure) => failure.applicationId));
        },
        onError: (error) => {
          setPendingBulkAction(null);
          setBulkOutcome(
            bulkErrorOutcome(
              "emailed",
              apiErrorMessage(error, "The server refused this bulk email."),
            ),
          );
        },
      },
    );
  };

  const bulkSendQuestionnaireToSelection = (
    questionnaireTemplateId: string,
    sendReminders: boolean,
  ) => {
    const applicationIds = [...selected];
    if (applicationIds.length === 0) return;

    setPendingBulkAction("questionnaire");
    setBulkOutcome(null);

    bulkSendQuestionnaire.mutate(
      { applicationIds, questionnaireTemplateId, sendReminders },
      {
        onSuccess: (result) => {
          setPendingBulkAction(null);
          setBulkOutcome(
            buildBulkOutcome(
              { succeeded: result.sent.length, failures: result.failures },
              applicationIds.length,
              {
                pastTense: "sent the questionnaire",
                successMessage: "Each candidate received their own single-use link.",
              },
              nameForApplication,
            ),
          );
          replaceSelection(result.failures.map((failure) => failure.applicationId));
        },
        onError: (error) => {
          setPendingBulkAction(null);
          setBulkOutcome(
            bulkErrorOutcome(
              "send the questionnaire",
              apiErrorMessage(error, "The server refused this bulk questionnaire send."),
            ),
          );
        },
      },
    );
  };

  const bulkArchive = () =>
    runBulkUpdate(
      "archive",
      { status: "archived" },
      {
        pastTense: "archived",
        successMessage: "They stay searchable with “Include archived” on.",
      },
    );

  const bulkExport = () => {
    const applicationIds = [...selected];
    if (applicationIds.length === 0) return;

    setPendingBulkAction("export");
    setBulkOutcome(null);

    exportCandidates.mutate(applicationIds, {
      onSuccess: ({ records, missingIds }) => {
        setPendingBulkAction(null);
        if (records.length > 0) {
          downloadCsvFile(
            candidateExportFilename(position?.title ?? "candidates", new Date()),
            candidateExportCsv(records),
          );
        }
        setBulkOutcome(buildExportOutcome(records.length, missingIds, nameForApplication));
      },
      onError: (error) => {
        setPendingBulkAction(null);
        setBulkOutcome(
          bulkErrorOutcome("export", apiErrorMessage(error, "The server refused this export.")),
        );
      },
    });
  };

  const hasActiveFilters = hasActiveCandidateFilters(filters);

  if (positionQuery.isLoading) {
    return (
      <div
        role="status"
        className="flex h-full items-center justify-center text-[13px] text-slate-400"
      >
        Loading pipeline…
      </div>
    );
  }

  if (positionQuery.isError || !position) {
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
      >
        <div className="text-[15px] font-semibold text-red-800">Couldn’t load this position</div>
        <div className="max-w-85 text-[13px] leading-relaxed text-red-700">
          {positionQuery.error instanceof Error
            ? positionQuery.error.message
            : "It may have been removed."}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={positionQuery.isFetching}
            onClick={() => positionQuery.refetch()}
            className="flex h-8 items-center rounded-md border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {positionQuery.isFetching ? "Retrying…" : "Try again"}
          </button>
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

  return (
    <div className="relative flex h-full min-h-0">
      {sidebarOpen && (
        <aside className="flex w-62 shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-slate-100 pl-4 pr-3.5">
            <span className="font-mono text-[11px] tracking-[0.1em] text-slate-400">FILTERS</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFilters(emptyCandidateFilters())}
                className="text-[11px] text-accent-11 hover:underline"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"
                aria-label="Collapse filters"
              >
                <ChevronDownIcon size={14} className="rotate-90" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-5 pt-3.5">
            <div className="mb-4 flex h-8 items-center gap-2 rounded-md border border-slate-300 px-2.5">
              <SearchIcon size={13} className="shrink-0 text-slate-400" />
              <input
                value={filters.search}
                onChange={(e) => patchFilters({ search: e.target.value })}
                placeholder="Name or email…"
                aria-label="Filter by name or email"
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-slate-400"
              />
            </div>

            <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-600">
              <span>Stage</span>
              {filters.stageIds.size > 0 && (
                <span className="font-mono text-[10px] font-normal text-slate-400">
                  {filters.stageIds.size} selected
                </span>
              )}
            </div>
            <div className="mb-4.5 flex flex-col gap-px">
              {boardStages.map((s) => {
                const on = filters.stageIds.has(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    aria-label={s.name}
                    onClick={() => toggleStageFilter(s.id)}
                    className="flex items-center gap-2.5 rounded-md px-1.5 py-1.25 hover:bg-slate-50"
                  >
                    <CheckboxIndicator checked={on} size={15} />
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STAGE_DOT_CLASS)} />
                    <span className="min-w-0 flex-1 truncate text-left text-xs text-slate-700">
                      {s.name}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">
                      {byStage(s.id).length}
                    </span>
                  </button>
                );
              })}
            </div>

            <DateWindowFilter
              legend="Added date"
              name="added-date"
              value={filters.addedWithin}
              onChange={(addedWithin: DateWindow) => patchFilters({ addedWithin })}
            />

            <DateWindowFilter
              legend="Last activity"
              name="last-activity-date"
              value={filters.lastActivityWithin}
              onChange={(lastActivityWithin: DateWindow) => patchFilters({ lastActivityWithin })}
            />

            <div className="flex flex-col gap-3 border-t border-slate-100 pt-3.5">
              <Toggle
                label="Starred only"
                icon={<StarIcon size={14} filled className="text-amber-600" />}
                on={filters.starredOnly}
                onChange={() => patchFilters({ starredOnly: !filters.starredOnly })}
              />
              <Toggle
                label="Unseen only"
                icon={<span className="h-1.75 w-1.75 rounded-full bg-accent-9" />}
                on={filters.unseenOnly}
                onChange={() => patchFilters({ unseenOnly: !filters.unseenOnly })}
              />
              <Toggle
                label="Include archived"
                on={filters.includeArchived}
                onChange={() => patchFilters({ includeArchived: !filters.includeArchived })}
              />
            </div>
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
          {!sidebarOpen && (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50"
              aria-label="Show filters"
            >
              <FilterIcon size={15} />
            </button>
          )}

          <PositionSwitcher
            currentId={position.id}
            title={position.title}
            positions={positionsQuery.data ?? []}
          />

          <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-slate-100 px-2 font-mono text-[11px] font-semibold text-slate-600">
            {activeCount} active
          </span>

          <div className="flex-1" />

          <div className="flex h-8 w-50 shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5">
            <SearchIcon size={13} className="shrink-0 text-slate-400" />
            <input
              value={filters.search}
              onChange={(e) => patchFilters({ search: e.target.value })}
              placeholder="Search candidates…"
              aria-label="Search candidates"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400"
            />
          </div>

          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className={cn(
              "flex h-8 shrink-0 items-center gap-1.75 rounded-md border px-2.75 text-[13px] font-medium",
              hasActiveFilters
                ? "border-accent-9 bg-accent-3 text-accent-11"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            <FilterIcon size={14} />
            Filters
            {hasActiveFilters && <span className="h-1.5 w-1.5 rounded-full bg-accent-9" />}
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectModeOverride(!selectMode);
              replaceSelection([]);
              setBulkOutcome(null);
            }}
            className={cn(
              "flex h-8 shrink-0 items-center gap-1.75 rounded-md border px-2.75 text-[13px] font-medium",
              selectMode
                ? "border-accent-9 bg-accent-3 text-accent-11"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            <span
              className={cn(
                "flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border",
                selectMode ? "border-accent-9 bg-accent-9 text-white" : "border-slate-400",
              )}
            />
            Select
          </button>

          {selectMode && (
            <button
              type="button"
              disabled={visible.length === 0}
              onClick={() => replaceSelection(selectableIds)}
              className="flex h-8 shrink-0 items-center rounded-md border border-slate-300 bg-white px-2.75 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              Select all {visible.length}
            </button>
          )}
        </div>

        {candidatesQuery.isLoading ? (
          <div role="status" className="flex-1 overflow-hidden">
            <span className="sr-only">Loading candidates…</span>
            <CandidatesBoardSkeleton />
          </div>
        ) : candidatesQuery.isError ? (
          <div
            role="alert"
            className="flex flex-1 flex-col items-center justify-center gap-3 text-center"
          >
            <div className="text-[13px] text-red-700">
              {candidatesQuery.error instanceof Error
                ? candidatesQuery.error.message
                : "Couldn’t load candidates."}
            </div>
            <button
              type="button"
              disabled={candidatesQuery.isFetching}
              onClick={() => candidatesQuery.refetch()}
              className="flex h-8 items-center rounded-md border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {candidatesQuery.isFetching ? "Retrying…" : "Try again"}
            </button>
          </div>
        ) : boardStages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
            <div className="text-[15px] font-semibold text-slate-700">No pipeline assigned</div>
            <div className="max-w-90 text-[13px] leading-relaxed text-slate-500">
              Assign a pipeline to this position to start moving candidates through stages.
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-x-auto overflow-y-hidden">
            <div className="flex h-full w-max items-start gap-3.5 p-4">
              {boardStages.map((stage) => (
                <BoardColumn
                  key={stage.id}
                  stage={stage}
                  cards={byStage(stage.id)}
                  navigationContext={navigationContext}
                  selectMode={selectMode}
                  selected={selected}
                  draggingId={draggingId}
                  dragOverStage={dragOverStage}
                  onOpen={openCandidate}
                  onToggleSelect={toggleSelect}
                  onToggleStar={toggleStar}
                  onCardDragStart={setDraggingId}
                  onCardDragEnd={endDrag}
                  onStageDragOver={setDragOverStage}
                  onStageDrop={dropOnStage}
                  onOpenStageActions={setStageActionsStageId}
                  now={now}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {(selected.size > 0 || bulkOutcome !== null) && (
        <BulkActionBar
          selectedCount={selected.size}
          stages={position.stages}
          messageTemplates={messageTemplates.data ?? []}
          questionnaires={questionnaires.data ?? []}
          pendingAction={pendingBulkAction}
          outcome={bulkOutcome}
          notice={selectionNotice}
          onMoveToStage={bulkMoveToStage}
          onSendEmail={bulkSendEmail}
          onSendQuestionnaire={bulkSendQuestionnaireToSelection}
          onArchive={bulkArchive}
          onExport={bulkExport}
          onClearSelection={() => {
            replaceSelection([]);
            setBulkOutcome(null);
          }}
          onDismissOutcome={() => setBulkOutcome(null)}
        />
      )}

      {stageActionsStageId && (
        <div className="fixed inset-0 z-50">
          <StageActionsPanel
            positionId={positionId}
            stageId={stageActionsStageId}
            onClose={() => setStageActionsStageId(null)}
          />
        </div>
      )}
    </div>
  );
}

function BoardColumn({
  stage,
  cards,
  navigationContext,
  selectMode,
  selected,
  draggingId,
  dragOverStage,
  onOpen,
  onToggleSelect,
  onToggleStar,
  onCardDragStart,
  onCardDragEnd,
  onStageDragOver,
  onStageDrop,
  onOpenStageActions,
  now,
}: {
  stage: PipelineStage;
  cards: Candidate[];
  now: number;
  navigationContext: CandidateNavigationContext;
  selectMode: boolean;
  selected: Set<string>;
  draggingId: string | null;
  dragOverStage: string | null;
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onToggleStar: (id: string) => void;
  onCardDragStart: (id: string) => void;
  onCardDragEnd: () => void;
  onStageDragOver: (stageId: string) => void;
  onStageDrop: (stageId: string) => void;
  onOpenStageActions: (stageId: string) => void;
}) {
  const isDropTarget = draggingId !== null && dragOverStage === stage.id;
  return (
    <div className="flex max-h-full w-67 shrink-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-1 pb-2.5 pt-0.5">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", STAGE_DOT_CLASS)} />
        <span className="truncate text-[13px] font-semibold text-slate-900">{stage.name}</span>
        <span className="ml-auto font-mono text-[11px] text-slate-400">{cards.length}</span>
        <button
          type="button"
          onClick={() => onOpenStageActions(stage.id)}
          title={`Automations for ${stage.name}`}
          aria-label={`Automations for ${stage.name}`}
          className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <Clock size={13} aria-hidden="true" />
        </button>
      </div>
      <div
        onDragOver={(e) => {
          if (!draggingId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          onStageDragOver(stage.id);
        }}
        onDrop={(e) => {
          e.preventDefault();
          onStageDrop(stage.id);
        }}
        className={cn(
          "flex min-h-20 flex-1 flex-col gap-2 overflow-y-auto rounded-xl p-0.5 transition-colors",
          isDropTarget && "bg-accent-2 ring-[1.5px] ring-accent-9",
        )}
      >
        {cards.length === 0 ? (
          <div
            className={cn(
              "mt-0.5 rounded-lg border border-dashed px-3 py-6 text-center text-xs leading-relaxed",
              isDropTarget ? "border-accent-9 text-accent-10" : "border-slate-300 text-slate-400",
            )}
          >
            {isDropTarget ? "Drop to move here" : "No candidates in this stage"}
          </div>
        ) : (
          cards.map((c) => (
            <div
              key={c.id}
              draggable={!selectMode}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                onCardDragStart(c.id);
              }}
              onDragEnd={onCardDragEnd}
              onClickCapture={(e) => {
                if (selectMode) {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleSelect(c.id);
                } else {
                  onOpen(c.id);
                }
              }}
              className={cn("transition-opacity", draggingId === c.id && "opacity-40")}
            >
              <CandidateCard
                candidate={c}
                navigationContext={navigationContext}
                selectMode={selectMode}
                selected={selected.has(c.id)}
                onToggleSelect={() => onToggleSelect(c.id)}
                onToggleStar={() => onToggleStar(c.id)}
                now={now}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PositionSwitcher({
  currentId,
  title,
  positions,
}: {
  currentId: string;
  title: string;
  positions: PositionListItem[];
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="relative">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-md py-1.25 pl-1 pr-2 hover:bg-slate-50"
      >
        <h1 className="whitespace-nowrap text-base font-semibold tracking-[-0.01em]">{title}</h1>
        <ChevronDownIcon size={15} className="text-slate-500" />
      </button>
      <FloatingMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} align="start">
        <div className="w-75 rounded-xl border border-slate-200 bg-white p-1.5 shadow-modal">
          {positions
            .filter((p) => p.status !== "archived")
            .map((p) => (
              <Link
                key={p.id}
                href={`/positions/${p.id}/board`}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-slate-100",
                  p.id === currentId && "bg-slate-50",
                )}
              >
                <span
                  className={cn(
                    "h-1.75 w-1.75 shrink-0 rounded-full",
                    p.status === "open" ? "bg-green-600" : "bg-slate-400",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-slate-900">{p.title}</div>
                  <div className="text-[11px] text-slate-400">
                    {[p.department, locationLabel(p)].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <span className="font-mono text-[11px] text-slate-400">{p.candidateCount}</span>
              </Link>
            ))}
        </div>
      </FloatingMenu>
    </div>
  );
}

function Toggle({
  label,
  icon,
  on,
  onChange,
}: {
  label: string;
  icon?: React.ReactNode;
  on: boolean;
  onChange: () => void;
}) {
  return (
    <button type="button" onClick={onChange} className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-xs text-slate-700">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          "relative h-4.5 w-7.5 shrink-0 rounded-full transition-colors",
          on ? "bg-accent-9" : "bg-slate-200",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-all",
            on ? "left-3.5" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}
