import { describe, expect, it } from "vitest";

import type { Candidate } from "@/types/api";
import {
  dateWindowDays,
  emptyCandidateFilters,
  filterCandidates,
  hasActiveCandidateFilters,
  isWithinDateWindow,
  matchesCandidateFilters,
  matchesSearch,
  type CandidateFilters,
} from "./candidate-filters";

const NOW = new Date("2026-08-05T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "application-1",
    firstName: "Amara",
    lastName: "Okafor",
    email: "amara.okafor@example.com",
    headline: "Senior Frontend Engineer",
    stageId: "stage-1",
    starred: false,
    seen: true,
    archived: false,
    questionnaire: "none",
    appliedAt: daysAgo(1),
    stageEnteredAt: daysAgo(1),
    lastActivityAt: daysAgo(1),
    ...overrides,
  };
}

function filtersWith(overrides: Partial<CandidateFilters>): CandidateFilters {
  return { ...emptyCandidateFilters(), ...overrides };
}

describe("dateWindowDays", () => {
  it("reads no boundary from the any-time window", () => {
    expect(dateWindowDays("any")).toBeNull();
  });

  it("reads the day count from each bounded window", () => {
    expect(dateWindowDays("7")).toBe(7);
    expect(dateWindowDays("30")).toBe(30);
    expect(dateWindowDays("90")).toBe(90);
  });
});

describe("isWithinDateWindow (added date and last activity date)", () => {
  it("admits everything when the window is any time", () => {
    expect(isWithinDateWindow(daysAgo(4000), "any", NOW)).toBe(true);
  });

  it("admits a timestamp inside the window", () => {
    expect(isWithinDateWindow(daysAgo(3), "7", NOW)).toBe(true);
  });

  it("admits a timestamp exactly on the boundary", () => {
    expect(isWithinDateWindow(daysAgo(7), "7", NOW)).toBe(true);
  });

  it("rejects a timestamp just outside the boundary", () => {
    expect(isWithinDateWindow(daysAgo(7.001), "7", NOW)).toBe(false);
  });

  it("admits a timestamp inside the wider window that the narrow one rejects", () => {
    const applied = daysAgo(45);
    expect(isWithinDateWindow(applied, "30", NOW)).toBe(false);
    expect(isWithinDateWindow(applied, "90", NOW)).toBe(true);
  });

  it("admits a timestamp in the future rather than treating clock skew as stale", () => {
    expect(isWithinDateWindow(daysAgo(-2), "7", NOW)).toBe(true);
  });

  it("rejects an unparseable timestamp instead of admitting it silently", () => {
    expect(isWithinDateWindow("not a date", "7", NOW)).toBe(false);
  });

  it("still admits an unparseable timestamp when no window is set", () => {
    expect(isWithinDateWindow("not a date", "any", NOW)).toBe(true);
  });
});

describe("matchesSearch", () => {
  it("matches on first name regardless of case", () => {
    expect(matchesSearch(makeCandidate(), "AMARA")).toBe(true);
  });

  it("matches on last name", () => {
    expect(matchesSearch(makeCandidate(), "okafor")).toBe(true);
  });

  it("matches on the full name across the space", () => {
    expect(matchesSearch(makeCandidate(), "amara ok")).toBe(true);
  });

  it("matches on email", () => {
    expect(matchesSearch(makeCandidate(), "@example.com")).toBe(true);
  });

  it("matches a candidate with no last name", () => {
    expect(matchesSearch(makeCandidate({ lastName: null }), "amara")).toBe(true);
  });

  it("does not match an unrelated query", () => {
    expect(matchesSearch(makeCandidate(), "zebra")).toBe(false);
  });

  it("treats a whitespace-only query as no query at all", () => {
    expect(matchesSearch(makeCandidate(), "   ")).toBe(true);
  });
});

describe("matchesCandidateFilters", () => {
  it("hides an archived candidate unless archived are included", () => {
    const archived = makeCandidate({ archived: true });
    expect(matchesCandidateFilters(archived, emptyCandidateFilters(), NOW)).toBe(false);
    expect(matchesCandidateFilters(archived, filtersWith({ includeArchived: true }), NOW)).toBe(
      true,
    );
  });

  it("keeps only starred candidates when starred only is on", () => {
    const filters = filtersWith({ starredOnly: true });
    expect(matchesCandidateFilters(makeCandidate({ starred: true }), filters, NOW)).toBe(true);
    expect(matchesCandidateFilters(makeCandidate({ starred: false }), filters, NOW)).toBe(false);
  });

  it("keeps only unseen candidates when unseen only is on", () => {
    const filters = filtersWith({ unseenOnly: true });
    expect(matchesCandidateFilters(makeCandidate({ seen: false }), filters, NOW)).toBe(true);
    expect(matchesCandidateFilters(makeCandidate({ seen: true }), filters, NOW)).toBe(false);
  });

  it("keeps only the chosen stages when a stage filter is set", () => {
    const filters = filtersWith({ stageIds: new Set(["stage-2"]) });
    expect(matchesCandidateFilters(makeCandidate({ stageId: "stage-2" }), filters, NOW)).toBe(true);
    expect(matchesCandidateFilters(makeCandidate({ stageId: "stage-1" }), filters, NOW)).toBe(
      false,
    );
  });

  it("drops a candidate with no stage when a stage filter is set", () => {
    const filters = filtersWith({ stageIds: new Set(["stage-2"]) });
    expect(matchesCandidateFilters(makeCandidate({ stageId: null }), filters, NOW)).toBe(false);
  });

  it("filters on added date independently of last activity", () => {
    const candidate = makeCandidate({ appliedAt: daysAgo(60), lastActivityAt: daysAgo(1) });
    expect(matchesCandidateFilters(candidate, filtersWith({ addedWithin: "30" }), NOW)).toBe(false);
    expect(matchesCandidateFilters(candidate, filtersWith({ lastActivityWithin: "30" }), NOW)).toBe(
      true,
    );
  });

  it("filters on last activity date independently of added date", () => {
    const candidate = makeCandidate({ appliedAt: daysAgo(1), lastActivityAt: daysAgo(60) });
    expect(matchesCandidateFilters(candidate, filtersWith({ lastActivityWithin: "30" }), NOW)).toBe(
      false,
    );
    expect(matchesCandidateFilters(candidate, filtersWith({ addedWithin: "30" }), NOW)).toBe(true);
  });

  it("requires every set filter to pass, not just one", () => {
    const filters = filtersWith({ starredOnly: true, addedWithin: "7" });
    expect(
      matchesCandidateFilters(
        makeCandidate({ starred: true, appliedAt: daysAgo(40) }),
        filters,
        NOW,
      ),
    ).toBe(false);
    expect(
      matchesCandidateFilters(
        makeCandidate({ starred: true, appliedAt: daysAgo(2) }),
        filters,
        NOW,
      ),
    ).toBe(true);
  });
});

describe("filterCandidates", () => {
  const candidates = [
    makeCandidate({ id: "recent", appliedAt: daysAgo(2), lastActivityAt: daysAgo(2) }),
    makeCandidate({ id: "stale", appliedAt: daysAgo(200), lastActivityAt: daysAgo(200) }),
    makeCandidate({ id: "quiet", appliedAt: daysAgo(2), lastActivityAt: daysAgo(120) }),
  ];

  it("returns everything when nothing is filtered", () => {
    expect(filterCandidates(candidates, emptyCandidateFilters(), NOW)).toHaveLength(3);
  });

  it("narrows to candidates added inside the window", () => {
    const kept = filterCandidates(candidates, filtersWith({ addedWithin: "30" }), NOW);
    expect(kept.map((c) => c.id)).toEqual(["recent", "quiet"]);
  });

  it("narrows to candidates active inside the window", () => {
    const kept = filterCandidates(candidates, filtersWith({ lastActivityWithin: "30" }), NOW);
    expect(kept.map((c) => c.id)).toEqual(["recent"]);
  });

  it("returns an empty list rather than throwing when nothing matches", () => {
    expect(filterCandidates(candidates, filtersWith({ search: "nobody" }), NOW)).toEqual([]);
  });
});

describe("hasActiveCandidateFilters", () => {
  it("reports no active filters on a fresh filter set", () => {
    expect(hasActiveCandidateFilters(emptyCandidateFilters())).toBe(false);
  });

  it("ignores a whitespace-only search", () => {
    expect(hasActiveCandidateFilters(filtersWith({ search: "  " }))).toBe(false);
  });

  it("reports an active filter for each control", () => {
    expect(hasActiveCandidateFilters(filtersWith({ search: "amara" }))).toBe(true);
    expect(hasActiveCandidateFilters(filtersWith({ stageIds: new Set(["stage-1"]) }))).toBe(true);
    expect(hasActiveCandidateFilters(filtersWith({ starredOnly: true }))).toBe(true);
    expect(hasActiveCandidateFilters(filtersWith({ unseenOnly: true }))).toBe(true);
    expect(hasActiveCandidateFilters(filtersWith({ includeArchived: true }))).toBe(true);
    expect(hasActiveCandidateFilters(filtersWith({ addedWithin: "7" }))).toBe(true);
    expect(hasActiveCandidateFilters(filtersWith({ lastActivityWithin: "90" }))).toBe(true);
  });
});
