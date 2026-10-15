import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";
import { normalizeSubject } from "@/utilities/email-headers";
import { matchThreadByReferences, type HeaderMatch } from "@/utilities/thread-matching";

export const THREAD_LIST_SELECT =
  "id, person_id, position_id, application_id, subject, last_message_at, last_inbound_at, read_at, created_at, people(id, first_name, last_name, email, phone, headline), positions(id, title), applications(id, position_stages(name)), messages(body, direction, created_at)";

export const THREAD_MESSAGE_SELECT =
  "id, person_id, application_id, direction, from_address, to_address, cc, bcc, subject, body, attachments, status, thread_id, relay_message_id, rfc_message_id, inbound_email_id, headers, scheduled_for, sent_at, failure_reason, created_at, profiles(full_name)";

const UNIQUE_VIOLATION = "23505";

export type ThreadContext = {
  personId: string;
  positionId?: string | null;
  applicationId?: string | null;
  subject?: string | null;
};

export async function ensureThread(
  supabase: SupabaseClient<Database>,
  context: ThreadContext,
): Promise<{ threadId: string } | { error: string }> {
  const normalizedSubject = normalizeSubject(context.subject);

  const existing = await supabase
    .from("message_threads")
    .select("id")
    .eq("person_id", context.personId)
    .eq("normalized_subject", normalizedSubject)
    .maybeSingle();

  if (existing.error) return { error: existing.error.message };
  if (existing.data) return { threadId: existing.data.id };

  const inserted = await supabase
    .from("message_threads")
    .insert({
      person_id: context.personId,
      position_id: context.positionId ?? null,
      application_id: context.applicationId ?? null,
      subject: (context.subject ?? "").trim() || null,
      normalized_subject: normalizedSubject,
    })
    .select("id")
    .maybeSingle();

  if (inserted.data) return { threadId: inserted.data.id };

  if (inserted.error?.code === UNIQUE_VIOLATION) {
    const raced = await supabase
      .from("message_threads")
      .select("id")
      .eq("person_id", context.personId)
      .eq("normalized_subject", normalizedSubject)
      .maybeSingle();
    if (raced.data) return { threadId: raced.data.id };
  }

  return { error: inserted.error?.message ?? "Could not open a thread for that message" };
}

export async function touchThread(
  supabase: SupabaseClient<Database>,
  threadId: string,
  update: {
    at: string;
    direction: "inbound" | "outbound";
    positionId?: string | null;
    applicationId?: string | null;
  },
): Promise<void> {
  const patch: Database["public"]["Tables"]["message_threads"]["Update"] = {
    last_message_at: update.at,
  };

  if (update.direction === "inbound") patch.last_inbound_at = update.at;
  if (update.positionId) patch.position_id = update.positionId;
  if (update.applicationId) patch.application_id = update.applicationId;

  // The message itself is already saved, so this does not fail the send or the
  // receipt; it only keeps the inbox's ordering and unread state right. Logged
  // rather than dropped, so a thread stuck out of order can be traced.
  const { error } = await supabase.from("message_threads").update(patch).eq("id", threadId);
  if (error) console.error("thread not updated after a message", threadId, error.message);
}

export async function matchThreadByHeaders(
  supabase: SupabaseClient<Database>,
  references: string[],
  expectedPersonId: string | null,
): Promise<HeaderMatch> {
  if (references.length === 0) return { kind: "none" };

  const { data } = await supabase
    .from("messages")
    .select("rfc_message_id, thread_id, person_id")
    .in("rfc_message_id", references);

  const known = (data ?? [])
    .filter((row): row is typeof row & { rfc_message_id: string } => row.rfc_message_id !== null)
    .map((row) => ({
      rfcMessageId: row.rfc_message_id,
      threadId: row.thread_id,
      personId: row.person_id,
    }));

  return matchThreadByReferences(references, known, expectedPersonId);
}

export async function threadReplyHeaders(
  supabase: SupabaseClient<Database>,
  threadId: string,
): Promise<{ inReplyTo: string | null; references: string[] }> {
  const { data } = await supabase
    .from("messages")
    .select("rfc_message_id")
    .eq("thread_id", threadId)
    .not("rfc_message_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(10);

  const ids = (data ?? [])
    .map((row) => row.rfc_message_id)
    .filter((id): id is string => typeof id === "string");

  if (ids.length === 0) return { inReplyTo: null, references: [] };

  return { inReplyTo: ids[0] ?? null, references: ids.slice().reverse() };
}
