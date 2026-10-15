import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { NOT_PENDING } from "@/app/api/scheduled-actions/_shared";

type RouteContext = { params: Promise<{ id: string }> };

const idSchema = z.uuid("That is not an automation id");

/**
 * Stops one queued automation for one candidate. Only a waiting row: one the
 * worker has claimed is about to talk to the mail relay and is not stolen back
 * (the same rule as cancel-on-move).
 */
export async function POST(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = idSchema.safeParse((await params).id);
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid id", 422);

  try {
    const { data, error } = await ctx.supabase
      .from("scheduled_actions")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", parsed.data)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (error) return apiError(error.message, 500);
    if (!data) return apiError(NOT_PENDING, 409);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiUnexpected(error);
  }
}
