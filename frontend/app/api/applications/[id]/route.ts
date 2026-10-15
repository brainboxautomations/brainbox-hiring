import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapCandidate } from "@/app/api/_mappers";
import { CANDIDATE_SELECT } from "@/app/api/applications/_shared";
import type { TablesUpdate } from "@/types/database.types";

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    starred: z.boolean().optional(),
    seen: z.boolean().optional(),
    stageId: z.uuid().nullable().optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

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

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid update", 422);
  }
  const input = parsed.data;

  try {
    const { data: current, error: readErr } = await supabase
      .from("applications")
      .select("id, position_id")
      .eq("id", id)
      .maybeSingle();
    if (readErr) return apiError(readErr.message, 500);
    if (!current) return apiError("Candidate not found", 404);

    if (input.stageId) {
      const { data: stage, error: stageErr } = await supabase
        .from("position_stages")
        .select("id")
        .eq("id", input.stageId)
        .eq("position_id", current.position_id)
        .maybeSingle();
      if (stageErr) return apiError(stageErr.message, 500);
      if (!stage) return apiError("Stage does not belong to this position", 422);
    }

    const rowUpdate: TablesUpdate<"applications"> = {};
    if (input.starred !== undefined) rowUpdate.starred = input.starred;
    if (input.seen !== undefined) rowUpdate.seen = input.seen;
    if (input.stageId !== undefined) rowUpdate.current_stage_id = input.stageId;
    if (input.status !== undefined) rowUpdate.status = input.status;

    const { error: updErr } = await supabase.from("applications").update(rowUpdate).eq("id", id);
    if (updErr) return apiError(updErr.message, 500);

    const { data: full, error: fullErr } = await supabase
      .from("applications")
      .select(CANDIDATE_SELECT)
      .eq("id", id)
      .single();
    if (fullErr || !full) return apiError(fullErr?.message ?? "Read failed", 500);

    return NextResponse.json({
      candidate: mapCandidate(full),
    });
  } catch (error) {
    return apiUnexpected(error);
  }
}
