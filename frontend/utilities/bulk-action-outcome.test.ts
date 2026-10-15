import { describe, expect, it } from "vitest";

import type { BulkActionResult } from "@/utilities/bulk-action-outcome";
import {
  buildBulkOutcome,
  buildHeldSendOutcome,
  buildUndoneOutcome,
  buildExportOutcome,
  bulkErrorOutcome,
  candidateNoun,
  describeBulkFailure,
  type BulkActionVerb,
} from "./bulk-action-outcome";

const MOVED: BulkActionVerb = { pastTense: "moved", successMessage: "Now in Shortlist." };

const NAMES: Record<string, string> = {
  "application-1": "Amara Okafor",
  "application-2": "Bilal Haddad",
};

const nameFor = (applicationId: string) => NAMES[applicationId] ?? null;

function result(
  updatedIds: string[],
  failures: { id: string; reason: string }[] = [],
): BulkActionResult {
  return {
    succeeded: updatedIds.length,
    failures: failures.map((failure) => ({
      applicationId: failure.id,
      reason: failure.reason,
    })),
  };
}

describe("candidateNoun", () => {
  it("uses the singular for one", () => {
    expect(candidateNoun(1)).toBe("candidate");
  });

  it("uses the plural for none and for many", () => {
    expect(candidateNoun(0)).toBe("candidates");
    expect(candidateNoun(20)).toBe("candidates");
  });
});

describe("describeBulkFailure", () => {
  it("names the candidate alongside the reason", () => {
    expect(
      describeBulkFailure(
        { applicationId: "application-1", reason: "Candidate not found" },
        nameFor,
      ),
    ).toBe("Amara Okafor — Candidate not found");
  });

  it("falls back to the id when the name is not on hand, so the row is never anonymous", () => {
    expect(
      describeBulkFailure({ applicationId: "application-9", reason: "permission denied" }, nameFor),
    ).toBe("application-9 — permission denied");
  });
});

describe("buildBulkOutcome (partial failure)", () => {
  it("reports a clean run as a success with no detail rows", () => {
    const outcome = buildBulkOutcome(result(["application-1", "application-2"]), 2, MOVED, nameFor);

    expect(outcome.tone).toBe("success");
    expect(outcome.title).toBe("2 candidates moved");
    expect(outcome.message).toBe("Now in Shortlist.");
    expect(outcome.details).toEqual([]);
  });

  it("reports a partial run as partial, naming every failure", () => {
    const outcome = buildBulkOutcome(
      result(["application-1"], [{ id: "application-2", reason: "Candidate not found" }]),
      2,
      MOVED,
      nameFor,
    );

    expect(outcome.tone).toBe("partial");
    expect(outcome.title).toBe("1 of 2 moved");
    expect(outcome.details).toEqual(["Bilal Haddad — Candidate not found"]);
  });

  it("says the successful ones went through so a partial run is not read as a rollback", () => {
    const outcome = buildBulkOutcome(
      result(["application-1"], [{ id: "application-2", reason: "boom" }]),
      2,
      MOVED,
      nameFor,
    );

    expect(outcome.message).toContain("The rest went through and are unaffected.");
  });

  it("reports a run where nothing succeeded as an error", () => {
    const outcome = buildBulkOutcome(
      result(
        [],
        [
          { id: "application-1", reason: "boom" },
          { id: "application-2", reason: "boom" },
        ],
      ),
      2,
      MOVED,
      nameFor,
    );

    expect(outcome.tone).toBe("error");
    expect(outcome.title).toBe("Nothing was moved");
    expect(outcome.details).toHaveLength(2);
  });

  it("keeps the singular reading when exactly one failed", () => {
    const outcome = buildBulkOutcome(
      result(["application-1"], [{ id: "application-2", reason: "boom" }]),
      2,
      MOVED,
      nameFor,
    );

    expect(outcome.message).toContain("1 failed and stays selected");
  });
});

describe("buildExportOutcome", () => {
  it("confirms a complete export", () => {
    const outcome = buildExportOutcome(4, [], nameFor);

    expect(outcome.tone).toBe("success");
    expect(outcome.title).toBe("4 candidates exported");
    expect(outcome.message).toBe("The CSV has been downloaded.");
  });

  it("names what was left out of a partial export", () => {
    const outcome = buildExportOutcome(1, ["application-2"], nameFor);

    expect(outcome.tone).toBe("partial");
    expect(outcome.title).toBe("1 of 2 exported");
    expect(outcome.details).toEqual(["Bilal Haddad — no longer on this position"]);
  });

  it("reports an export that read nothing as an error", () => {
    const outcome = buildExportOutcome(0, ["application-1", "application-2"], nameFor);

    expect(outcome.tone).toBe("error");
    expect(outcome.title).toBe("Nothing was exported");
  });
});

describe("bulkErrorOutcome", () => {
  it("carries the server's own message rather than a generic one", () => {
    const outcome = bulkErrorOutcome("archive", "Database is down");

    expect(outcome.tone).toBe("error");
    expect(outcome.title).toBe("Couldn’t archive");
    expect(outcome.message).toBe("Database is down");
  });
});

describe("buildBulkOutcome when emails are held past the daily limit", () => {
  const EMAILED: BulkActionVerb = {
    pastTense: "emailed",
    successMessage: "Each candidate received their own message.",
  };

  it("says how many went out now and how many go out after midnight UTC", () => {
    const outcome = buildBulkOutcome(
      { succeeded: 3, failures: [], deferred: 7 },
      10,
      EMAILED,
      nameFor,
    );

    expect(outcome.tone).toBe("partial");
    expect(outcome.title).toBe("3 emailed, 7 scheduled");
    expect(outcome.message).toMatch(/daily email limit was reached/);
    expect(outcome.message).toMatch(
      /7 candidates will be emailed automatically just after midnight UTC/,
    );
  });

  it("still lists real failures alongside the held ones", () => {
    const outcome = buildBulkOutcome(
      {
        succeeded: 1,
        failures: [{ applicationId: "application-1", reason: "No email address" }],
        deferred: 1,
      },
      3,
      EMAILED,
      nameFor,
    );

    expect(outcome.title).toBe("1 of 3 emailed, 1 scheduled");
    expect(outcome.message).toMatch(/1 candidate will be emailed/);
    expect(outcome.message).toMatch(/1 failed and stays selected/);
    expect(outcome.details).toEqual(["Amara Okafor — No email address"]);
  });
});

describe("buildHeldSendOutcome (undo window)", () => {
  it("says nothing has gone out yet and when it will", () => {
    const outcome = buildHeldSendOutcome(
      { held: 12, failures: [], requestedCount: 12, sendAtLabel: "3:42 PM" },
      nameFor,
    );

    expect(outcome.tone).toBe("success");
    expect(outcome.title).toBe("12 emails scheduled");
    expect(outcome.message).toMatch(/They go out at 3:42 PM/);
    expect(outcome.message).toMatch(/Undo all/);
  });

  it("keeps real failures selected alongside the held ones", () => {
    const outcome = buildHeldSendOutcome(
      {
        held: 2,
        failures: [{ applicationId: "application-1", reason: "No email address" }],
        requestedCount: 3,
        sendAtLabel: "3:42 PM",
      },
      nameFor,
    );

    expect(outcome.tone).toBe("partial");
    expect(outcome.title).toBe("2 of 3 scheduled");
    expect(outcome.details).toEqual(["Amara Okafor — No email address"]);
  });
});

describe("buildUndoneOutcome", () => {
  it("confirms the whole batch was stopped", () => {
    expect(buildUndoneOutcome(5, 0)).toMatchObject({
      tone: "success",
      message: "5 emails were stopped. Nothing was sent.",
    });
  });

  it("says plainly when some had already started sending", () => {
    const outcome = buildUndoneOutcome(4, 1);
    expect(outcome.tone).toBe("partial");
    expect(outcome.message).toMatch(/1 had already started sending/);
  });
});
