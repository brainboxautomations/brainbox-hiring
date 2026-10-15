import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapMessage } from "@/app/api/_mappers";
import { MESSAGE_SELECT } from "@/app/api/messages/_send";
import { sendScheduledMessageNow } from "@/app/api/workers/scheduled-actions/_run-messages";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const messageIdSchema = z.uuid("That is not a message id");

export const NOT_WAITING = "That message is not waiting to be sent, so it cannot be sent now";

/**
 * Sends a held email at once (skipping the rest of its undo window, or a time
 * someone scheduled), in this request rather than on the worker's next pass,
 * and answers with the message as it now stands: sent, failed with its
 * reason, or held again past the relay's daily limit.
 */
export async function POST(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const parsed = messageIdSchema.safeParse((await params).id);
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid id", 422);
  const id = parsed.data;

  try {
    const outcome = await sendScheduledMessageNow(supabase, id);
    if (!outcome) return apiError(NOT_WAITING, 409);

    const { data, error } = await supabase
      .from("messages")
      .select(MESSAGE_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (error) return apiError(error.message, 500);
    if (!data) return apiError("Message not found", 404);

    return NextResponse.json({ message: mapMessage(data) });
  } catch (error) {
    return apiUnexpected(error);
  }
}
