import { NextResponse, type NextRequest } from "next/server";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapMessage, mapMessageThreadDetail } from "@/app/api/_mappers";
import { THREAD_LIST_SELECT, THREAD_MESSAGE_SELECT } from "@/app/api/messages/_threads";

type RouteContext = { params: Promise<{ threadId: string }> };

const MAX_MESSAGES = 500;

export async function GET(_request: NextRequest, context: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const { threadId } = await context.params;

  const { data: thread, error } = await supabase
    .from("message_threads")
    .select(THREAD_LIST_SELECT)
    .eq("id", threadId)
    .maybeSingle();

  if (error) return apiError(error.message, 500);
  if (!thread) return apiError("Thread not found", 404);

  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select(THREAD_MESSAGE_SELECT)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(MAX_MESSAGES);

  if (messagesError) return apiError(messagesError.message, 500);

  return NextResponse.json({
    thread: mapMessageThreadDetail(thread, (messages ?? []).map(mapMessage)),
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const { threadId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body");
  }

  const read = (body as { read?: unknown } | null)?.read;
  if (typeof read !== "boolean") return apiError("Pass read as a boolean", 422);

  try {
    const { data, error } = await supabase
      .from("message_threads")
      .update({ read_at: read ? new Date().toISOString() : null })
      .eq("id", threadId)
      .select("id, read_at")
      .maybeSingle();

    if (error) return apiError(error.message, 500);
    if (!data) return apiError("Thread not found", 404);

    return NextResponse.json({ thread: { id: data.id, readAt: data.read_at } });
  } catch (error) {
    return apiUnexpected(error);
  }
}
