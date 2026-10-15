import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailTransport, InboundEmail } from "@/configurations/email-transport";
import { putObject } from "@/configurations/object-storage";
import { ensureThread, matchThreadByHeaders, touchThread } from "@/app/api/messages/_threads";
import type { Database, Json } from "@/types/database.types";
import type { MessageAttachment } from "@/types/api";
import { extractAddress, inboundBodyText, threadReferenceIds } from "@/utilities/email-headers";
import {
  MAX_INBOUND_ATTACHMENT_BYTES,
  MAX_INBOUND_ATTACHMENT_COUNT,
  MESSAGE_ATTACHMENT_BUCKET,
  inboundAttachmentPath,
} from "@/utilities/message-attachments";

const UNIQUE_VIOLATION = "23505";

export type InboundOutcome =
  | { kind: "recorded"; messageId: string; threadId: string; personId: string }
  | { kind: "duplicate" }
  | { kind: "unmatched"; unmatchedId: string; reason: UnmatchedReason }
  | { kind: "error"; error: string };

export type UnmatchedReason = "no_matching_person" | "sender_unreadable";

async function alreadyRecorded(
  supabase: SupabaseClient<Database>,
  emailId: string,
): Promise<boolean> {
  const message = await supabase
    .from("messages")
    .select("id")
    .eq("inbound_email_id", emailId)
    .maybeSingle();
  if (message.data) return true;

  const unmatched = await supabase
    .from("unmatched_inbound_emails")
    .select("id")
    .eq("relay_email_id", emailId)
    .maybeSingle();

  return Boolean(unmatched.data);
}

async function storeAttachments(
  transport: EmailTransport,
  inbound: InboundEmail,
): Promise<{ stored: MessageAttachment[]; skipped: string[] }> {
  const stored: MessageAttachment[] = [];
  const skipped: string[] = [];

  for (const attachment of inbound.attachments.slice(0, MAX_INBOUND_ATTACHMENT_COUNT)) {
    const filename = attachment.filename ?? "attachment";

    if (attachment.size > MAX_INBOUND_ATTACHMENT_BYTES) {
      skipped.push(filename);
      continue;
    }

    try {
      const bytes = await transport.downloadInboundAttachment(inbound.emailId, attachment.id);
      const path = inboundAttachmentPath(inbound.emailId, bytes.filename ?? filename);

      // A failed write throws and lands in the catch below as a skipped file.
      await putObject(
        MESSAGE_ATTACHMENT_BUCKET,
        path,
        bytes.content,
        bytes.contentType ?? attachment.contentType ?? "application/octet-stream",
      );

      stored.push({
        path,
        filename,
        mimeType: attachment.contentType,
        size: attachment.size,
      });
    } catch {
      skipped.push(filename);
    }
  }

  if (inbound.attachments.length > MAX_INBOUND_ATTACHMENT_COUNT) {
    for (const extra of inbound.attachments.slice(MAX_INBOUND_ATTACHMENT_COUNT)) {
      skipped.push(extra.filename ?? "attachment");
    }
  }

  return { stored, skipped };
}

async function recordUnmatched(
  supabase: SupabaseClient<Database>,
  inbound: InboundEmail,
  reason: UnmatchedReason,
): Promise<InboundOutcome> {
  const { data, error } = await supabase
    .from("unmatched_inbound_emails")
    .insert({
      relay_email_id: inbound.emailId,
      rfc_message_id: inbound.rfcMessageId,
      from_address: inbound.from,
      to_addresses: inbound.to as unknown as Json,
      subject: inbound.subject,
      body_html: inbound.html,
      body_text: inboundBodyText({ text: inbound.text, html: inbound.html }),
      headers: inbound.headers as unknown as Json,
      attachments: inbound.attachments as unknown as Json,
      reason,
      received_at: inbound.receivedAt,
    })
    .select("id")
    .maybeSingle();

  if (data) return { kind: "unmatched", unmatchedId: data.id, reason };
  if (error?.code === UNIQUE_VIOLATION) return { kind: "duplicate" };

  return { kind: "error", error: error?.message ?? "Could not record the unmatched email" };
}

async function contextFor(
  supabase: SupabaseClient<Database>,
  personId: string,
): Promise<{ applicationId: string | null; positionId: string | null }> {
  const { data } = await supabase
    .from("applications")
    .select("id, position_id")
    .eq("person_id", personId)
    .order("applied_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return { applicationId: data?.id ?? null, positionId: data?.position_id ?? null };
}

export async function processInboundEmail(
  supabase: SupabaseClient<Database>,
  transport: EmailTransport,
  emailId: string,
): Promise<InboundOutcome> {
  if (await alreadyRecorded(supabase, emailId)) return { kind: "duplicate" };

  let inbound: InboundEmail;
  try {
    inbound = await transport.fetchInbound(emailId);
  } catch (error) {
    return {
      kind: "error",
      error: error instanceof Error ? error.message : "The relay would not return that email",
    };
  }

  const senderAddress = extractAddress(inbound.from);
  if (!senderAddress) return recordUnmatched(supabase, inbound, "sender_unreadable");

  const { data: person, error: personError } = await supabase
    .from("people")
    .select("id")
    .eq("email", senderAddress)
    .maybeSingle();

  // A failed lookup is not "nobody by that address". Filing a candidate's real
  // reply as unmatched would answer the webhook with 200, so Resend would never
  // retry. An error makes the route answer 500, and the retry is safe: an email
  // already recorded is recognised as a duplicate first.
  if (personError) return { kind: "error", error: personError.message };
  if (!person) return recordUnmatched(supabase, inbound, "no_matching_person");

  const references = threadReferenceIds(inbound.headers);
  const headerMatch = await matchThreadByHeaders(supabase, references, person.id);

  let threadId: string;
  if (headerMatch.kind === "matched") {
    threadId = headerMatch.threadId;
  } else {
    const opened = await ensureThread(supabase, {
      personId: person.id,
      subject: inbound.subject,
    });
    if ("error" in opened) return { kind: "error", error: opened.error };
    threadId = opened.threadId;
  }

  const { data: thread, error: threadError } = await supabase
    .from("message_threads")
    .select("application_id, position_id")
    .eq("id", threadId)
    .maybeSingle();
  if (threadError) return { kind: "error", error: threadError.message };

  let applicationId = thread?.application_id ?? null;
  let positionId = thread?.position_id ?? null;
  if (!applicationId) {
    const resolved = await contextFor(supabase, person.id);
    applicationId = resolved.applicationId;
    positionId = resolved.positionId;
  }

  const { stored, skipped } = await storeAttachments(transport, inbound);

  const { data: inserted, error } = await supabase
    .from("messages")
    .insert({
      person_id: person.id,
      application_id: applicationId,
      thread_id: threadId,
      direction: "inbound",
      from_address: senderAddress,
      to_address: inbound.to[0] ?? null,
      cc: inbound.cc as unknown as Json,
      bcc: [] as unknown as Json,
      subject: inbound.subject,
      body: inboundBodyText({ text: inbound.text, html: inbound.html }),
      attachments: stored as unknown as Json,
      headers: inbound.headers as unknown as Json,
      status: "received",
      rfc_message_id: inbound.rfcMessageId,
      inbound_email_id: inbound.emailId,
      failure_reason:
        skipped.length > 0
          ? `Could not store ${skipped.length} attachment(s): ${skipped.join(", ")}`
          : null,
      created_at: inbound.receivedAt,
      sent_at: inbound.receivedAt,
    })
    .select("id")
    .maybeSingle();

  if (!inserted) {
    if (error?.code === UNIQUE_VIOLATION) return { kind: "duplicate" };
    return { kind: "error", error: error?.message ?? "Could not record the inbound message" };
  }

  await touchThread(supabase, threadId, {
    at: inbound.receivedAt,
    direction: "inbound",
    positionId,
    applicationId,
  });

  return { kind: "recorded", messageId: inserted.id, threadId, personId: person.id };
}
