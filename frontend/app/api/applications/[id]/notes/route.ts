import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapNote } from "@/app/api/_mappers";

type RouteContext = { params: Promise<{ id: string }> };

const NOTE_SELECT = "id, body, created_at, profiles(full_name)";

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;

  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_SELECT)
    .eq("application_id", id)
    .order("created_at", { ascending: false });
  if (error) return apiError(error.message, 500);

  const notes = (data ?? []).map((row) => mapNote(row));
  return NextResponse.json({ notes });
}

const postSchema = z.object({ body: z.string().trim().min(1, "Note can't be empty") });

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, user } = ctx;
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError("Invalid JSON body");
  }

  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid note", 422);
  }

  try {
    const { data, error } = await supabase
      .from("notes")
      .insert({ application_id: id, author_user_id: user.id, body: parsed.data.body })
      .select(NOTE_SELECT)
      .single();
    if (error) return apiError(error.message, 500);

    return NextResponse.json({ note: mapNote(data) }, { status: 201 });
  } catch (error) {
    return apiUnexpected(error);
  }
}
