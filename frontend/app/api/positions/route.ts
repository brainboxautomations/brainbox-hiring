import { NextResponse, type NextRequest } from "next/server";

import { positionCreateSchema } from "@/schemas/position-schema";
import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapPosition, mapPositionListItem } from "@/app/api/_mappers";
import {
  POSITION_DETAIL_SELECT,
  candidateCounts,
  toRow,
  uniqueSlug,
} from "@/app/api/positions/_shared";
import type { TablesInsert } from "@/types/database.types";

export async function GET() {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const { data, error } = await supabase
    .from("positions")
    .select(
      "id, title, slug, department, position_type, locations, remote_flag, status, publish_mode, created_at",
    )
    .order("created_at", { ascending: false });
  if (error) return apiError(error.message, 500);

  const counts = await candidateCounts(supabase);
  const positions = (data ?? []).map((row) => mapPositionListItem(row, counts.get(row.id) ?? 0));
  return NextResponse.json({ positions });
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

  const parsed = positionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid position", 422);
  }
  const input = parsed.data;

  try {
    const slug = await uniqueSlug(supabase, input.title);
    const row: TablesInsert<"positions"> = {
      ...toRow(input),
      title: input.title,
      slug,
      status: "draft",
    };

    const { data: created, error: insertError } = await supabase
      .from("positions")
      .insert(row)
      .select("id")
      .single();
    if (insertError || !created) return apiError(insertError?.message ?? "Insert failed", 500);

    if (input.assignedPipelineId) {
      const { error: snapErr } = await supabase.rpc("snapshot_pipeline_to_position", {
        p_position_id: created.id,
        p_pipeline_id: input.assignedPipelineId,
      });
      if (snapErr) return apiError(`Pipeline snapshot failed: ${snapErr.message}`, 500);
    }

    if (input.status === "open") {
      const { error: statusErr } = await supabase
        .from("positions")
        .update({ status: "open" })
        .eq("id", created.id);
      if (statusErr) return apiError(statusErr.message, 500);
    }

    const { data: full, error: readErr } = await supabase
      .from("positions")
      .select(POSITION_DETAIL_SELECT)
      .eq("id", created.id)
      .single();
    if (readErr || !full) return apiError(readErr?.message ?? "Read failed", 500);

    return NextResponse.json({ position: mapPosition(full, 0) }, { status: 201 });
  } catch (error) {
    return apiUnexpected(error);
  }
}
