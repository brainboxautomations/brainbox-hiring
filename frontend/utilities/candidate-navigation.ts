import type { Candidate, PipelineStage } from "@/types/api";
import {
  emptyCandidateFilters,
  filterCandidates,
  type CandidateFilters,
  type DateWindow,
} from "@/utilities/candidate-filters";

export const POSITION_PARAM = "position";

const SEARCH_PARAM = "q";
const STAGES_PARAM = "stages";
const STARRED_PARAM = "starred";
const UNSEEN_PARAM = "unseen";
const ARCHIVED_PARAM = "archived";
const ADDED_PARAM = "added";
const ACTIVITY_PARAM = "activity";

const ON = "1";

const DATE_WINDOWS: DateWindow[] = ["any", "7", "30", "90"];

export type CandidateNavigationContext = {
  positionId: string;
  filters: CandidateFilters;
};

export type CandidateNeighbours = {
  previousId: string | null;
  nextId: string | null;
};

export const NO_NEIGHBOURS: CandidateNeighbours = { previousId: null, nextId: null };

function toDateWindow(raw: string | null): DateWindow {
  const match = DATE_WINDOWS.find((window) => window === raw);
  return match ?? "any";
}

export function candidateNavigationSearch(context: CandidateNavigationContext): string {
  const params = new URLSearchParams();
  const { positionId, filters } = context;

  params.set(POSITION_PARAM, positionId);

  const search = filters.search.trim();
  if (search) params.set(SEARCH_PARAM, search);

  const stageIds = [...filters.stageIds];
  if (stageIds.length > 0) params.set(STAGES_PARAM, stageIds.join(","));

  if (filters.starredOnly) params.set(STARRED_PARAM, ON);
  if (filters.unseenOnly) params.set(UNSEEN_PARAM, ON);
  if (filters.includeArchived) params.set(ARCHIVED_PARAM, ON);
  if (filters.addedWithin !== "any") params.set(ADDED_PARAM, filters.addedWithin);
  if (filters.lastActivityWithin !== "any") params.set(ACTIVITY_PARAM, filters.lastActivityWithin);

  return params.toString();
}

export function candidateHref(applicationId: string, context: CandidateNavigationContext): string {
  return `/candidates/${applicationId}?${candidateNavigationSearch(context)}`;
}

export function parseCandidateNavigationContext(
  params: URLSearchParams,
): CandidateNavigationContext | null {
  const positionId = params.get(POSITION_PARAM);
  if (!positionId) return null;

  const stages = params.get(STAGES_PARAM);

  return {
    positionId,
    filters: {
      ...emptyCandidateFilters(),
      search: params.get(SEARCH_PARAM) ?? "",
      stageIds: new Set(stages ? stages.split(",").filter(Boolean) : []),
      starredOnly: params.get(STARRED_PARAM) === ON,
      unseenOnly: params.get(UNSEEN_PARAM) === ON,
      includeArchived: params.get(ARCHIVED_PARAM) === ON,
      addedWithin: toDateWindow(params.get(ADDED_PARAM)),
      lastActivityWithin: toDateWindow(params.get(ACTIVITY_PARAM)),
    },
  };
}

export function boardStageOrder(stages: PipelineStage[]): PipelineStage[] {
  return [...stages].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function orderedBoardCandidates(
  candidates: Candidate[],
  stages: PipelineStage[],
  filters: CandidateFilters,
  now: Date,
): Candidate[] {
  const visible = filterCandidates(candidates, filters, now);
  const columnOrder = new Map(stages.map((stage, index) => [stage.id, index]));

  const ordered: Candidate[] = [];
  for (const stage of stages) {
    ordered.push(...visible.filter((candidate) => candidate.stageId === stage.id));
  }

  const unstaged = visible.filter(
    (candidate) => !candidate.stageId || !columnOrder.has(candidate.stageId),
  );

  return [...ordered, ...unstaged];
}

export function neighbouringCandidates(
  orderedIds: string[],
  currentId: string,
): CandidateNeighbours {
  const index = orderedIds.indexOf(currentId);
  if (index === -1) return NO_NEIGHBOURS;

  return {
    previousId: index > 0 ? (orderedIds[index - 1] ?? null) : null,
    nextId: index < orderedIds.length - 1 ? (orderedIds[index + 1] ?? null) : null,
  };
}
