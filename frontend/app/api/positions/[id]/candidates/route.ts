import { NextResponse, type NextRequest } from "next/server";

import { apiError, requireUser } from "@/app/api/_helpers";
import { mapCandidate } from "@/app/api/_mappers";
import { CANDIDATE_SELECT } from "@/app/api/applications/_shared";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;

  const { data, error } = await supabase
    .from("applications")
    .select(CANDIDATE_SELECT)
    .eq("position_id", id)
    .order("applied_at", { ascending: false });
  if (error) return apiError(error.message, 500);

  const candidates = (data ?? []).map((row) => mapCandidate(row));
  return NextResponse.json({ candidates });
}
