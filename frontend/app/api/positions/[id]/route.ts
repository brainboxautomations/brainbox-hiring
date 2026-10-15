import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SALARY_RANGE_REFINEMENT,
  positionInputSchema,
  salaryRangeOrdered,
} from "@/schemas/position-schema";
import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapPosition } from "@/app/api/_mappers";
import { POSITION_DETAIL_SELECT, toRow } from "@/app/api/positions/_shared";
import type { Database } from "@/types/database.types";

type RouteContext = { params: Promise<{ id: string }> };

const positionPatchSchema = positionInputSchema
  .partial()
  .extend({ status: z.enum(["draft", "open", "closed", "archived"]).optional() })
  .refine(salaryRangeOrdered, SALARY_RANGE_REFINEMENT);

async function countFor(supabase: SupabaseClient<Database>, positionId: string): Promise<number> {
  const { count } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("position_id", positionId);
  return count ?? 0;
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;

  const { data, error } = await supabase
    .from("positions")
    .select(POSITION_DETAIL_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) return apiError(error.message, 500);
  if (!data) return apiError("Position not found", 404);

  const count = await countFor(supabase, id);
  return NextResponse.json({
    position: mapPosition(data, count),
  });
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body");
  }

  const parsed = positionPatchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid update", 422);
  }
  const input = parsed.data;

  try {
    const { data: current, error: readErr } = await supabase
      .from("positions")
      .select("id, status, assigned_pipeline_id")
      .eq("id", id)
      .maybeSingle();
    if (readErr) return apiError(readErr.message, 500);
    if (!current) return apiError("Position not found", 404);

    const isDraft = current.status === "draft";
    const changingPipeline =
      input.assignedPipelineId !== undefined &&
      input.assignedPipelineId !== current.assigned_pipeline_id;

    if (changingPipeline && !isDraft) {
      return apiError(
        "Stage order is frozen once a position is live; cannot reassign its pipeline.",
        409,
      );
    }

    const { assignedPipelineId, status, ...fields } = input;
    const rowUpdate = toRow(fields);
    if (Object.keys(rowUpdate).length > 0) {
      const { error: updErr } = await supabase.from("positions").update(rowUpdate).eq("id", id);
      if (updErr) return apiError(updErr.message, 500);
    }

    if (changingPipeline && assignedPipelineId) {
      const { error: snapErr } = await supabase.rpc("snapshot_pipeline_to_position", {
        p_position_id: id,
        p_pipeline_id: assignedPipelineId,
      });
      if (snapErr) return apiError(`Pipeline snapshot failed: ${snapErr.message}`, 500);
    } else if (changingPipeline && assignedPipelineId === null) {
      await supabase.from("position_stages").delete().eq("position_id", id);
      await supabase.from("positions").update({ assigned_pipeline_id: null }).eq("id", id);
    }

    if (status) {
      const { error: statusErr } = await supabase.from("positions").update({ status }).eq("id", id);
      if (statusErr) return apiError(statusErr.message, 500);
    }

    const { data: full, error: fullErr } = await supabase
      .from("positions")
      .select(POSITION_DETAIL_SELECT)
      .eq("id", id)
      .single();
    if (fullErr || !full) return apiError(fullErr?.message ?? "Read failed", 500);

    const count = await countFor(supabase, id);
    return NextResponse.json({
      position: mapPosition(full, count),
    });
  } catch (error) {
    return apiUnexpected(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;

  const { error } = await supabase.from("positions").delete().eq("id", id);
  if (error) return apiError(error.message, 500);
  return NextResponse.json({ ok: true });
}
