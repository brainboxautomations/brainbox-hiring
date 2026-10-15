import { NextResponse, type NextRequest } from "next/server";

import { apiError, requireUser } from "@/app/api/_helpers";
import { mapMessageThread } from "@/app/api/_mappers";
import { THREAD_LIST_SELECT } from "@/app/api/messages/_threads";

const MAX_THREADS = 200;

export async function GET(request: NextRequest) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const params = request.nextUrl.searchParams;
  const positionId = params.get("positionId");
  const personId = params.get("personId");
  const unreadOnly = params.get("unread") === "true";

  let query = supabase.from("message_threads").select(THREAD_LIST_SELECT);
  if (positionId) query = query.eq("position_id", positionId);
  if (personId) query = query.eq("person_id", personId);
  if (unreadOnly) query = query.not("last_inbound_at", "is", null);

  const { data, error } = await query
    .order("last_message_at", { ascending: false })
    .order("created_at", { referencedTable: "messages", ascending: false })
    .limit(1, { referencedTable: "messages" })
    .limit(MAX_THREADS);

  if (error) return apiError(error.message, 500);

  const threads = (data ?? []).map(mapMessageThread);

  return NextResponse.json({
    threads: unreadOnly ? threads.filter((thread) => thread.unread) : threads,
  });
}
