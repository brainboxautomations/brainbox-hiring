import { describe, expect, it, vi } from "vitest";

import {
  ORPHAN_GRACE,
  batches,
  describeUploadPath,
  graceCutoff,
  runOrphanCleanup,
  type OrphanCleanupStore,
  type OrphanUpload,
} from "@/app/api/workers/orphan-cleanup/_run";

const POSITION_ID = "11111111-1111-4111-8111-111111111111";
const OBJECT_ID = "22222222-2222-4222-8222-222222222222";

function path(fileName: string) {
  return `applications/${POSITION_ID}/${OBJECT_ID}-${fileName}`;
}

function orphan(fileName: string, bucket = "resumes", size = 1000): OrphanUpload {
  return {
    bucket_id: bucket,
    name: path(fileName),
    created_at: "2026-09-01T00:00:00Z",
    size_bytes: size,
    mime_type: bucket === "videos" ? "video/webm" : "application/pdf",
  };
}

function fakeStore(orphans: OrphanUpload[], overrides: Partial<OrphanCleanupStore> = {}) {
  return {
    listOrphans: vi.fn(async () => orphans),
    startRun: vi.fn(async () => 42),
    remove: vi.fn(async (_bucket: string, names: string[]) => ({ removed: names, error: null })),
    record: vi.fn(async () => null as string | null),
    finishRun: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("runOrphanCleanup", () => {
  // A candidate who leaves the tab open overnight must still find their resume
  // when they submit next morning, so the grace period is a week, not a day.
  it("only asks for files abandoned for a week", async () => {
    const store = fakeStore([]);
    await runOrphanCleanup(store);

    expect(ORPHAN_GRACE).toBe("7 days");
    expect(store.listOrphans).toHaveBeenCalledWith("7 days");
  });

  it("removes each abandoned file from its own bucket", async () => {
    const store = fakeStore([orphan("a.pdf"), orphan("b.webm", "videos", 5000)]);

    const summary = await runOrphanCleanup(store);

    expect(store.remove).toHaveBeenCalledWith("resumes", [path("a.pdf")]);
    expect(store.remove).toHaveBeenCalledWith("videos", [path("b.webm")]);
    expect(summary).toMatchObject({ found: 2, removed: 2, failed: 0, bytesFreed: 6000, runId: 42 });
  });

  it("records each removed file with its position, name, type and reason", async () => {
    const store = fakeStore([orphan("Nadia_Rahman_Resume.pdf")]);

    await runOrphanCleanup(store);

    expect(store.record).toHaveBeenCalledWith([
      {
        run_id: 42,
        bucket_id: "resumes",
        storage_path: path("Nadia_Rahman_Resume.pdf"),
        position_id: POSITION_ID,
        file_name: "Nadia_Rahman_Resume.pdf",
        file_type: "application/pdf",
        size_bytes: 1000,
        reason: "abandoned_upload",
        uploaded_at: "2026-09-01T00:00:00Z",
      },
    ]);
  });

  // Storage keeps no copy. A deletion with no record is the one outcome the
  // job must never produce.
  it("deletes nothing if the run's audit record cannot be opened", async () => {
    const store = fakeStore([orphan("a.pdf")], {
      startRun: vi.fn(async () => {
        throw new Error("insert failed");
      }),
    });

    await expect(runOrphanCleanup(store)).rejects.toThrow("insert failed");
    expect(store.remove).not.toHaveBeenCalled();
  });

  // Without a row for empty nights, a job that silently stopped running would
  // look exactly like one with nothing to clean.
  it("records a run even when there is nothing to delete", async () => {
    const store = fakeStore([]);

    await runOrphanCleanup(store);

    expect(store.startRun).toHaveBeenCalled();
    expect(store.finishRun).toHaveBeenCalledWith(42, expect.objectContaining({ found: 0 }));
    expect(store.remove).not.toHaveBeenCalled();
  });

  it("closes the run with how far it got when it fails part-way", async () => {
    const store = fakeStore([], {
      listOrphans: vi.fn(async () => {
        throw new Error("rpc down");
      }),
    });

    await expect(runOrphanCleanup(store)).rejects.toThrow("rpc down");
    expect(store.finishRun).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ errors: ["rpc down"] }),
    );
  });

  // The audit must never list a file that is still there.
  it("records only what Storage confirms it removed", async () => {
    const store = fakeStore([orphan("a.pdf"), orphan("b.pdf")], {
      remove: vi.fn(async () => ({ removed: [path("a.pdf")], error: "b.pdf: permission denied" })),
    });

    const summary = await runOrphanCleanup(store);

    expect(store.record).toHaveBeenCalledWith([
      expect.objectContaining({ storage_path: path("a.pdf") }),
    ]);
    expect(summary).toMatchObject({ removed: 1, failed: 1, bytesFreed: 1000 });
    expect(summary.errors).toContain("resumes: b.pdf: permission denied");
  });

  it("records nothing when a batch removes nothing", async () => {
    const store = fakeStore([orphan("a.pdf")], {
      remove: vi.fn(async () => ({ removed: [], error: "network down" })),
    });

    await runOrphanCleanup(store);

    expect(store.record).not.toHaveBeenCalled();
  });

  it("caps one run and leaves the rest for a later night", async () => {
    const store = fakeStore([orphan("a"), orphan("b"), orphan("c")]);

    const summary = await runOrphanCleanup(store, { limit: 2 });

    expect(summary).toMatchObject({ found: 3, removed: 2, deferred: 1 });
  });

  it("keeps the paths in the server log when the record cannot be written", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = fakeStore([orphan("a.pdf")], {
      record: vi.fn(async () => "insert failed"),
    });

    const summary = await runOrphanCleanup(store);

    expect(summary.removed).toBe(1);
    expect(summary.errors).toContain("record: insert failed");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("describeUploadPath", () => {
  it("reads the position and file name out of an upload path", () => {
    expect(describeUploadPath(path("John_CV.pdf"))).toEqual({
      positionId: POSITION_ID,
      fileName: "John_CV.pdf",
    });
  });

  it("does not guess at a path of any other shape", () => {
    expect(describeUploadPath("elsewhere/cv.pdf")).toEqual({ positionId: null, fileName: null });
  });
});

describe("batches", () => {
  it("splits into chunks of the given size", () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([], 2)).toEqual([]);
  });
});

describe("graceCutoff", () => {
  const now = new Date("2026-10-07T12:00:00Z");

  it("reads the grace the audit row stores", () => {
    expect(graceCutoff(ORPHAN_GRACE, now)).toEqual(new Date("2026-09-30T12:00:00Z"));
    expect(graceCutoff("24 hours", now)).toEqual(new Date("2026-10-06T12:00:00Z"));
    expect(graceCutoff("1 day", now)).toEqual(new Date("2026-10-06T12:00:00Z"));
  });

  // A misread grace could delete uploads a candidate is still using.
  it("refuses a grace it does not understand rather than guessing", () => {
    expect(() => graceCutoff("1 week", now)).toThrow();
    expect(() => graceCutoff("soon", now)).toThrow();
  });
});
