import { afterEach, describe, expect, it, vi } from "vitest";

const objectsByFolder: Record<string, { path: string; size: number; lastModified: Date }[]> = {};

vi.mock("@/configurations/object-storage", () => ({
  listObjects: vi.fn(async (folder: string) => objectsByFolder[folder] ?? []),
  removeObjects: vi.fn(async (_folder: string, paths: string[]) => ({
    removed: paths,
    error: null,
  })),
}));

const { supabaseOrphanStore } = await import("@/app/api/workers/orphan-cleanup/_run");
const { removeObjects } = await import("@/configurations/object-storage");

const DAY = 86_400_000;
const old = new Date(Date.now() - 10 * DAY);
const fresh = new Date(Date.now() - 1 * DAY);

function fakeSupabase(referenced: Set<string>) {
  const rpc = vi.fn(async (_name: string, args: { p_paths: string[] }) => ({
    data: args.p_paths.filter((path) => !referenced.has(path)),
    error: null,
  }));
  // Only rpc is reached by listOrphans and remove.
  return { client: { rpc } as never, rpc };
}

afterEach(() => {
  for (const key of Object.keys(objectsByFolder)) delete objectsByFolder[key];
  vi.clearAllMocks();
});

describe("supabaseOrphanStore against R2", () => {
  it("returns only uploads that are past the grace period and referenced by nothing", async () => {
    objectsByFolder.resumes = [
      { path: "applications/p/a-abandoned.pdf", size: 100, lastModified: old },
      { path: "applications/p/b-submitted.pdf", size: 200, lastModified: old },
      { path: "applications/p/c-in-progress.pdf", size: 300, lastModified: fresh },
    ];
    objectsByFolder.videos = [
      { path: "applications/p/d-abandoned.webm", size: 400, lastModified: old },
    ];
    const { client, rpc } = fakeSupabase(new Set(["applications/p/b-submitted.pdf"]));

    const orphans = await supabaseOrphanStore(client).listOrphans("7 days");

    expect(orphans.map((o) => `${o.bucket_id}/${o.name}`)).toEqual([
      "resumes/applications/p/a-abandoned.pdf",
      "videos/applications/p/d-abandoned.webm",
    ]);
    expect(orphans[0]).toMatchObject({ size_bytes: 100, created_at: old.toISOString() });

    // A file inside the grace period is never even offered for checking.
    const checked = rpc.mock.calls.flatMap(([, args]) => args.p_paths);
    expect(checked).not.toContain("applications/p/c-in-progress.pdf");
    expect(rpc).toHaveBeenCalledWith("unreferenced_upload_paths", expect.anything());
  });

  it("lists nothing when no upload is old enough", async () => {
    objectsByFolder.resumes = [
      { path: "applications/p/c-in-progress.pdf", size: 300, lastModified: fresh },
    ];
    const { client, rpc } = fakeSupabase(new Set());

    expect(await supabaseOrphanStore(client).listOrphans("7 days")).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("deletes from the folder of the bucket it was given", async () => {
    const { client } = fakeSupabase(new Set());
    await supabaseOrphanStore(client).remove("videos", ["applications/p/d.webm"]);
    expect(removeObjects).toHaveBeenCalledWith("videos", ["applications/p/d.webm"]);
  });
});
