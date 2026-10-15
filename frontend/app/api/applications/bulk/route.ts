import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapCandidate } from "@/app/api/_mappers";
import { CANDIDATE_SELECT } from "@/app/api/applications/_shared";
import { bulkCandidateUpdateSchema } from "@/schemas/bulk-candidate-schema";
import type { BulkCandidateFailure, BulkCandidatePatch } from "@/types/api";
import type { Database, TablesUpdate } from "@/types/database.types";

type Selection = { applicationId: string; positionId: string };

function rowUpdateFor(patch: BulkCandidatePatch): TablesUpdate<"applications"> {
  const rowUpdate: TablesUpdate<"applications"> = {};
  if (patch.stageId !== undefined) rowUpdate.current_stage_id = patch.stageId;
  if (patch.status !== undefined) rowUpdate.status = patch.status;
  return rowUpdate;
}

function uniqueIds(applicationIds: string[]): string[] {
  return [...new Set(applicationIds)];
}

async function updateOne(
  supabase: SupabaseClient<Database>,
  applicationId: string,
  rowUpdate: TablesUpdate<"applications">,
): Promise<BulkCandidateFailure | null> {
  const { error } = await supabase.from("applications").update(rowUpdate).eq("id", applicationId);
  return error ? { applicationId, reason: error.message } : null;
}

export async function POST(request: NextRequest) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body");
  }

  const parsed = bulkCandidateUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid bulk action", 422);
  }
  const { applicationIds, patch } = parsed.data;

  try {
    const requestedIds = uniqueIds(applicationIds);

    const { data: rows, error: readError } = await supabase
      .from("applications")
      .select("id, position_id")
      .in("id", requestedIds);
    if (readError) return apiError(readError.message, 500);

    const found: Selection[] = (rows ?? []).map((row) => ({
      applicationId: row.id,
      positionId: row.position_id,
    }));
    const foundIds = new Set(found.map((selection) => selection.applicationId));

    const failures: BulkCandidateFailure[] = requestedIds
      .filter((applicationId) => !foundIds.has(applicationId))
      .map((applicationId) => ({ applicationId, reason: "Candidate not found" }));

    let eligible = found;

    if (patch.stageId !== undefined) {
      const { data: stage, error: stageError } = await supabase
        .from("position_stages")
        .select("id, position_id")
        .eq("id", patch.stageId)
        .maybeSingle();
      if (stageError) return apiError(stageError.message, 500);
      if (!stage) return apiError("That stage does not exist", 422);

      eligible = found.filter((selection) => selection.positionId === stage.position_id);
      for (const selection of found) {
        if (selection.positionId !== stage.position_id) {
          failures.push({
            applicationId: selection.applicationId,
            reason: "That stage belongs to a different position",
          });
        }
      }
    }

    const rowUpdate = rowUpdateFor(patch);
    const updateFailures = await Promise.all(
      eligible.map((selection) => updateOne(supabase, selection.applicationId, rowUpdate)),
    );

    const failedIds = new Set<string>();
    for (const failure of updateFailures) {
      if (failure) {
        failures.push(failure);
        failedIds.add(failure.applicationId);
      }
    }

    const updatedIds = eligible
      .map((selection) => selection.applicationId)
      .filter((applicationId) => !failedIds.has(applicationId));

    if (updatedIds.length === 0) {
      return NextResponse.json({ updated: [], failures });
    }

    const { data: updatedRows, error: rereadError } = await supabase
      .from("applications")
      .select(CANDIDATE_SELECT)
      .in("id", updatedIds);
    if (rereadError) return apiError(rereadError.message, 500);

    return NextResponse.json({
      updated: (updatedRows ?? []).map((row) => mapCandidate(row)),
      failures,
    });
  } catch (error) {
    return apiUnexpected(error);
  }
}
