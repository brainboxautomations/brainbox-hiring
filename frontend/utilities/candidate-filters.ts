import type { Candidate } from "@/types/api";

export type DateWindow = "any" | "7" | "30" | "90";

export type DateWindowOption = { value: DateWindow; label: string };

export const DATE_WINDOW_OPTIONS: DateWindowOption[] = [
  { value: "any", label: "Any time" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

export type CandidateFilters = {
  search: string;
  stageIds: Set<string>;
  starredOnly: boolean;
  unseenOnly: boolean;
  includeArchived: boolean;
  addedWithin: DateWindow;
  lastActivityWithin: DateWindow;
};

export function emptyCandidateFilters(): CandidateFilters {
  return {
    search: "",
    stageIds: new Set<string>(),
    starredOnly: false,
    unseenOnly: false,
    includeArchived: false,
    addedWithin: "any",
    lastActivityWithin: "any",
  };
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function dateWindowDays(window: DateWindow): number | null {
  return window === "any" ? null : Number(window);
}

export function isWithinDateWindow(timestamp: string, window: DateWindow, now: Date): boolean {
  const days = dateWindowDays(window);
  if (days === null) return true;

  const moment = new Date(timestamp).getTime();
  if (Number.isNaN(moment)) return false;

  const elapsedDays = (now.getTime() - moment) / MILLISECONDS_PER_DAY;
  return elapsedDays <= days;
}

export function matchesSearch(candidate: Candidate, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;

  const name = `${candidate.firstName} ${candidate.lastName ?? ""}`.toLowerCase();
  return name.includes(query) || candidate.email.toLowerCase().includes(query);
}

export function matchesCandidateFilters(
  candidate: Candidate,
  filters: CandidateFilters,
  now: Date,
): boolean {
  if (candidate.archived && !filters.includeArchived) return false;
  if (!matchesSearch(candidate, filters.search)) return false;
  if (filters.starredOnly && !candidate.starred) return false;
  if (filters.unseenOnly && candidate.seen) return false;

  if (filters.stageIds.size > 0) {
    if (!candidate.stageId || !filters.stageIds.has(candidate.stageId)) return false;
  }

  if (!isWithinDateWindow(candidate.appliedAt, filters.addedWithin, now)) return false;
  if (!isWithinDateWindow(candidate.lastActivityAt, filters.lastActivityWithin, now)) return false;

  return true;
}

export function filterCandidates(
  candidates: Candidate[],
  filters: CandidateFilters,
  now: Date,
): Candidate[] {
  return candidates.filter((candidate) => matchesCandidateFilters(candidate, filters, now));
}

export function hasActiveCandidateFilters(filters: CandidateFilters): boolean {
  return (
    filters.search.trim().length > 0 ||
    filters.stageIds.size > 0 ||
    filters.starredOnly ||
    filters.unseenOnly ||
    filters.includeArchived ||
    filters.addedWithin !== "any" ||
    filters.lastActivityWithin !== "any"
  );
}
