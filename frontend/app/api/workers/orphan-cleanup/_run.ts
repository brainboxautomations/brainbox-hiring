import type { SupabaseClient } from "@supabase/supabase-js";

import { listObjects, removeObjects, type StorageFolder } from "@/configurations/object-storage";
import type { Database } from "@/types/database.types";

/**
 * How long an unreferenced upload is left alone before it counts as abandoned.
 *
 * Files upload the moment a candidate picks them, before the application
 * exists. A week, not a day: a candidate who leaves the tab open overnight and
 * submits the next morning must still find their resume where they left it.
 */
export const ORPHAN_GRACE = "7 days";

/** The folders candidates upload into; message attachments are never orphans. */
const CANDIDATE_FOLDERS: StorageFolder[] = ["resumes", "videos"];

/** Paths are checked against the database in chunks of this size. */
const REFERENCE_CHECK_BATCH = 500;

const GRACE_UNITS_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

/**
 * The upload time before which a file counts as abandoned. The grace is kept
 * as Postgres interval text ("7 days") because the audit row stores it that
 * way; only "<n> minutes|hours|days" is understood, and anything else throws
 * rather than deleting on a misread grace.
 */
export function graceCutoff(grace: string, now: Date): Date {
  const match = /^(\d+)\s+(minute|hour|day)s?$/.exec(grace.trim());
  if (!match) throw new Error(`Unsupported grace period: ${grace}`);
  return new Date(now.getTime() - Number(match[1]) * GRACE_UNITS_MS[match[2]!]!);
}

/** Bounds one run, so a large backlog is worked off over several nights. */
export const MAX_REMOVALS_PER_RUN = 500;

/** Storage's remove call takes a list; this keeps each request modest. */
export const REMOVE_BATCH_SIZE = 100;

/** The only reason files are deleted today; see the audit table in 0045. */
export const DELETION_REASON = "abandoned_upload";

export type OrphanUpload = {
  bucket_id: string;
  name: string;
  created_at: string;
  size_bytes: number | null;
  mime_type: string | null;
};

export type OrphanCleanupSummary = {
  found: number;
  removed: number;
  bytesFreed: number;
  failed: number;
  /** Past the per-run cap; picked up on a later night. */
  deferred: number;
  errors: string[];
};

export type DeletedUploadRecord = {
  run_id: number;
  bucket_id: string;
  storage_path: string;
  position_id: string | null;
  file_name: string | null;
  file_type: string | null;
  size_bytes: number | null;
  reason: string;
  uploaded_at: string;
};

export type OrphanCleanupStore = {
  listOrphans: (grace: string) => Promise<OrphanUpload[]>;
  /** Opens the run's audit row and returns its id. */
  startRun: (grace: string) => Promise<number>;
  /** Returns the names Storage confirms it removed. */
  remove: (bucket: string, names: string[]) => Promise<{ removed: string[]; error: string | null }>;
  record: (rows: DeletedUploadRecord[]) => Promise<string | null>;
  finishRun: (runId: number, summary: OrphanCleanupSummary) => Promise<void>;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UPLOAD_PATH = new RegExp(`^applications/(${UUID})/${UUID}-(.+)$`);

/**
 * Reads the position and the readable file name out of an upload's path,
 * `applications/<position id>/<random id>-<file name>`, the one shape both
 * upload paths produce (see migration 0010). Anything else yields nulls rather
 * than a guess.
 */
export function describeUploadPath(path: string): {
  positionId: string | null;
  fileName: string | null;
} {
  const match = UPLOAD_PATH.exec(path);
  return match
    ? { positionId: match[1] ?? null, fileName: match[2] ?? null }
    : { positionId: null, fileName: null };
}

export function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
}

/**
 * Deletes abandoned candidate uploads, and records the run and every file
 * removed.
 *
 * Files live in Cloudflare R2. The store lists the candidate uploads older than
 * the grace period, and the database decides which of them are abandoned
 * (`unreferenced_upload_paths`, 0052: no `documents` row and no answer points
 * at the file).
 *
 * The run's audit row is opened before anything is deleted, and if it cannot
 * be, nothing is: a deletion with no record is the one outcome to avoid, since
 * Storage keeps no copy. Only what Storage confirms as removed is counted and
 * recorded, so the audit never lists a file that is still there.
 */
export async function runOrphanCleanup(
  store: OrphanCleanupStore,
  { limit = MAX_REMOVALS_PER_RUN, batchSize = REMOVE_BATCH_SIZE } = {},
): Promise<OrphanCleanupSummary & { runId: number }> {
  const runId = await store.startRun(ORPHAN_GRACE);

  const summary: OrphanCleanupSummary = {
    found: 0,
    removed: 0,
    bytesFreed: 0,
    failed: 0,
    deferred: 0,
    errors: [],
  };

  try {
    const orphans = await store.listOrphans(ORPHAN_GRACE);
    const attempted = orphans.slice(0, limit);
    summary.found = orphans.length;
    summary.deferred = orphans.length - attempted.length;

    const byBucket = new Map<string, OrphanUpload[]>();
    for (const orphan of attempted) {
      const list = byBucket.get(orphan.bucket_id) ?? [];
      list.push(orphan);
      byBucket.set(orphan.bucket_id, list);
    }

    for (const [bucket, files] of byBucket) {
      for (const batch of batches(files, batchSize)) {
        const { removed, error } = await store.remove(
          bucket,
          batch.map((file) => file.name),
        );
        if (error) summary.errors.push(`${bucket}: ${error}`);

        const removedNames = new Set(removed);
        const removedFiles = batch.filter((file) => removedNames.has(file.name));
        summary.removed += removedFiles.length;
        summary.failed += batch.length - removedFiles.length;
        summary.bytesFreed += removedFiles.reduce(
          (total, file) => total + (file.size_bytes ?? 0),
          0,
        );

        if (removedFiles.length === 0) continue;

        const recordError = await store.record(
          removedFiles.map((file) => {
            const { positionId, fileName } = describeUploadPath(file.name);
            return {
              run_id: runId,
              bucket_id: file.bucket_id,
              storage_path: file.name,
              position_id: positionId,
              file_name: fileName,
              file_type: file.mime_type,
              size_bytes: file.size_bytes,
              reason: DELETION_REASON,
              uploaded_at: file.created_at,
            };
          }),
        );
        if (recordError) {
          // The files are gone either way; keep the paths somewhere durable.
          summary.errors.push(`record: ${recordError}`);
          console.error("orphan-cleanup: removed but not recorded", removedFiles);
        }
      }
    }
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    // Closed even when the run fails part-way, so the audit shows how far it got.
    await store.finishRun(runId, summary);
  }

  return { ...summary, runId };
}

export function supabaseOrphanStore(supabase: SupabaseClient<Database>): OrphanCleanupStore {
  return {
    listOrphans: async (grace) => {
      const cutoff = graceCutoff(grace, new Date());
      const orphans: OrphanUpload[] = [];

      for (const folder of CANDIDATE_FOLDERS) {
        const old = (await listObjects(folder, "applications/")).filter(
          (object) => object.lastModified && object.lastModified < cutoff,
        );

        for (const chunk of batches(old, REFERENCE_CHECK_BATCH)) {
          const { data, error } = await supabase.rpc("unreferenced_upload_paths", {
            p_paths: chunk.map((object) => object.path),
          });
          if (error)
            throw new Error(`Could not check uploads against the database: ${error.message}`);

          const unreferenced = new Set(data ?? []);
          for (const object of chunk) {
            if (!unreferenced.has(object.path)) continue;
            orphans.push({
              bucket_id: folder,
              name: object.path,
              created_at: object.lastModified!.toISOString(),
              size_bytes: object.size,
              // R2's listing does not include each object's type.
              mime_type: null,
            });
          }
        }
      }

      return orphans;
    },
    startRun: async (grace) => {
      const { data, error } = await supabase
        .from("orphan_cleanup_runs")
        .insert({ grace })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(
          `Could not open the cleanup's audit record, so nothing was deleted: ${error?.message ?? "no row returned"}`,
        );
      }
      return data.id;
    },
    remove: async (bucket, names) => removeObjects(bucket as StorageFolder, names),
    record: async (rows) => {
      const { error } = await supabase.from("deleted_application_uploads").insert(rows);
      return error?.message ?? null;
    },
    finishRun: async (runId, summary) => {
      const { error } = await supabase
        .from("orphan_cleanup_runs")
        .update({
          finished_at: new Date().toISOString(),
          found: summary.found,
          removed: summary.removed,
          failed: summary.failed,
          deferred: summary.deferred,
          bytes_freed: summary.bytesFreed,
          errors: summary.errors,
        })
        .eq("id", runId);
      if (error) console.error("orphan-cleanup: could not close run", runId, error.message);
    },
  };
}
