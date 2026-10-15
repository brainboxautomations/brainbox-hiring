import { NextResponse, type NextRequest } from "next/server";

import { apiError, requireUser } from "@/app/api/_helpers";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Removes a department from the list the position form offers. Positions store
 * the name as text, so any that already use it keep it.
 */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const { error } = await ctx.supabase.from("departments").delete().eq("id", id);
  if (error) return apiError(error.message, 500);

  return NextResponse.json({ ok: true });
}
