import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { MAX_BULK_SELECTION } from "@/schemas/bulk-candidate-schema";

const cancelBatchSchema = z.object({
  messageIds: z.array(z.uuid()).min(1).max(MAX_BULK_SELECTION),
});

/**
 * "Undo all" for a bulk email still inside its undo window. Each message is
 * cancelled on its own terms: one the worker has already started sending is
 * left alone and reported, exactly as a single cancel would refuse it.
 */
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

  const parsed = cancelBatchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid batch", 422);
  }

  try {
    const now = new Date().toISOString();
    let cancelled = 0;
    let alreadyGone = 0;

    for (const id of parsed.data.messageIds) {
      const { data, error } = await supabase.rpc("cancel_scheduled_message", {
        p_id: id,
        p_now: now,
      });
      if (error) return apiError(error.message, 500);
      if (data) cancelled += 1;
      else alreadyGone += 1;
    }

    return NextResponse.json({ cancelled, alreadyGone });
  } catch (error) {
    return apiUnexpected(error);
  }
}
