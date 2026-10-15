import { describe, expect, it } from "vitest";

import type { Candidate, PipelineStage } from "@/types/api";
import { emptyCandidateFilters, type CandidateFilters } from "@/utilities/candidate-filters";
import {
  boardStageOrder,
  candidateHref,
  candidateNavigationSearch,
  neighbouringCandidates,
  orderedBoardCandidates,
  parseCandidateNavigationContext,
  NO_NEIGHBOURS,
} from "@/utilities/candidate-navigation";

const STAGES: PipelineStage[] = [
  { id: "stage-1", name: "Applied", sortOrder: 1 },
  { id: "stage-2", name: "Shortlist", sortOrder: 2 },
  { id: "stage-3", name: "Rejected", sortOrder: 3 },
  { id: "stage-4", name: "Hired", sortOrder: 4 },
];

const NOW = new Date("2026-08-10T12:00:00.000Z");

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "application-1",
    firstName: "Amara",
    lastName: "Okafor",
    email: "amara@example.com",
    headline: "Engineer",
    stageId: "stage-1",
    starred: false,
    seen: true,
    archived: false,
    questionnaire: "none",
    appliedAt: NOW.toISOString(),
    stageEnteredAt: NOW.toISOString(),
    lastActivityAt: NOW.toISOString(),
    ...overrides,
  };
}

function filters(overrides: Partial<CandidateFilters> = {}): CandidateFilters {
  return { ...emptyCandidateFilters(), ...overrides };
}

describe("neighbouringCandidates", () => {
  const ordered = ["a", "b", "c"];

  it("returns the candidate on either side", () => {
    expect(neighbouringCandidates(ordered, "b")).toEqual({ previousId: "a", nextId: "c" });
  });

  it("has no previous at the start of the set", () => {
    expect(neighbouringCandidates(ordered, "a")).toEqual({ previousId: null, nextId: "b" });
  });

  it("has no next at the end of the set, and does not wrap round", () => {
    expect(neighbouringCandidates(ordered, "c")).toEqual({ previousId: "b", nextId: null });
  });

  it("offers nothing at all when the current candidate is not in the set", () => {
    expect(neighbouringCandidates(ordered, "z")).toEqual(NO_NEIGHBOURS);
  });

  it("offers nothing for an empty set", () => {
    expect(neighbouringCandidates([], "a")).toEqual(NO_NEIGHBOURS);
  });

  it("offers nothing when the set holds only the current candidate", () => {
    expect(neighbouringCandidates(["a"], "a")).toEqual(NO_NEIGHBOURS);
  });
});

describe("orderedBoardCandidates", () => {
  it("walks the board column by column, in board order", () => {
    const cards = [
      candidate({ id: "c-rejected", stageId: "stage-3" }),
      candidate({ id: "c-shortlist", stageId: "stage-2" }),
      candidate({ id: "c-applied", stageId: "stage-1" }),
    ];

    const ordered = orderedBoardCandidates(cards, boardStageOrder(STAGES), filters(), NOW);

    expect(ordered.map((c) => c.id)).toEqual(["c-applied", "c-shortlist", "c-rejected"]);
  });

  it("orders every stage by sort order, with no stage held back", () => {
    expect(boardStageOrder(STAGES).map((stage) => stage.id)).toEqual([
      "stage-1",
      "stage-2",
      "stage-3",
      "stage-4",
    ]);
  });

  it("sorts by sort order rather than trusting the order it was handed", () => {
    const shuffled = [STAGES[3]!, STAGES[0]!, STAGES[2]!, STAGES[1]!];

    expect(boardStageOrder(shuffled).map((stage) => stage.sortOrder)).toEqual([1, 2, 3, 4]);
  });

  it("walks candidates through rejection stages in the same order the board shows", () => {
    const cards = [
      candidate({ id: "c-hired", stageId: "stage-4" }),
      candidate({ id: "c-rejected", stageId: "stage-3" }),
      candidate({ id: "c-applied", stageId: "stage-1" }),
    ];

    const ordered = orderedBoardCandidates(cards, boardStageOrder(STAGES), filters(), NOW);

    expect(ordered.map((c) => c.id)).toEqual(["c-applied", "c-rejected", "c-hired"]);
  });

  it("keeps a candidate with no stage rather than dropping them", () => {
    const cards = [
      candidate({ id: "c-nowhere", stageId: null }),
      candidate({ id: "c-applied", stageId: "stage-1" }),
    ];

    const ordered = orderedBoardCandidates(cards, boardStageOrder(STAGES), filters(), NOW);

    expect(ordered.map((c) => c.id)).toEqual(["c-applied", "c-nowhere"]);
  });

  it("iterates only what the filters left on the board", () => {
    const cards = [
      candidate({ id: "c-starred", starred: true }),
      candidate({ id: "c-plain", starred: false }),
    ];

    const ordered = orderedBoardCandidates(
      cards,
      boardStageOrder(STAGES),
      filters({ starredOnly: true }),
      NOW,
    );

    expect(ordered.map((c) => c.id)).toEqual(["c-starred"]);
  });
});

describe("candidate navigation context round-trips through the query string", () => {
  it("carries only the position when no filter is set", () => {
    const search = candidateNavigationSearch({ positionId: "position-1", filters: filters() });

    expect(search).toBe("position=position-1");
  });

  it("carries every filter the board was showing", () => {
    const search = candidateNavigationSearch({
      positionId: "position-1",
      filters: filters({
        search: "amara",
        stageIds: new Set(["stage-1", "stage-2"]),
        starredOnly: true,
        unseenOnly: true,
        includeArchived: true,
        addedWithin: "30",
        lastActivityWithin: "7",
      }),
    });

    const parsed = parseCandidateNavigationContext(new URLSearchParams(search));

    expect(parsed?.positionId).toBe("position-1");
    expect(parsed?.filters.search).toBe("amara");
    expect([...(parsed?.filters.stageIds ?? [])]).toEqual(["stage-1", "stage-2"]);
    expect(parsed?.filters.starredOnly).toBe(true);
    expect(parsed?.filters.unseenOnly).toBe(true);
    expect(parsed?.filters.includeArchived).toBe(true);
    expect(parsed?.filters.addedWithin).toBe("30");
    expect(parsed?.filters.lastActivityWithin).toBe("7");
  });

  it("reads no context at all when the position is absent", () => {
    expect(parseCandidateNavigationContext(new URLSearchParams("starred=1"))).toBeNull();
  });

  it("falls back to no date window when the query names one that does not exist", () => {
    const parsed = parseCandidateNavigationContext(
      new URLSearchParams("position=position-1&added=yesterday"),
    );

    expect(parsed?.filters.addedWithin).toBe("any");
  });

  it("builds a profile link that carries the board's context", () => {
    const href = candidateHref("application-9", {
      positionId: "position-1",
      filters: filters({ starredOnly: true }),
    });

    expect(href).toBe("/candidates/application-9?position=position-1&starred=1");
  });
});
