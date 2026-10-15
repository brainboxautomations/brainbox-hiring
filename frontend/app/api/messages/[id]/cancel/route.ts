import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapMessage } from "@/app/api/_mappers";
import { MESSAGE_SELECT } from "@/app/api/messages/_send";

type RouteContext = { params: Promise<{ id: string }> };

const messageIdSchema = z.uuid("That is not a message id");

export const ALREADY_SENDING =
  "That message is already on its way to the mail relay, so it can no longer be cancelled";

export const ALREADY_CANCELLED = "That message was already cancelled";

export const NOT_SCHEDULED = "That message was not waiting to be sent, so there is nothing to stop";

function refusalFor(status: string | null): string {
  if (status === "sending") return ALREADY_SENDING;
  if (status === "cancelled") return ALREADY_CANCELLED;
  return NOT_SCHEDULED;
}

export async function POST(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const parsed = messageIdSchema.safeParse((await params).id);
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid id", 422);
  const id = parsed.data;

  try {
    const { data: cancelled, error } = await supabase.rpc("cancel_scheduled_message", {
      p_id: id,
      p_now: new Date().toISOString(),
    });

    if (error) return apiError(error.message, 500);

    const { data, error: readError } = await supabase
      .from("messages")
      .select(MESSAGE_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (readError) return apiError(readError.message, 500);
    if (!data) return apiError("Message not found", 404);

    if (!cancelled) return apiError(refusalFor(data.status), 409);

    return NextResponse.json({ message: mapMessage(data) });
  } catch (error) {
    return apiUnexpected(error);
  }
}
