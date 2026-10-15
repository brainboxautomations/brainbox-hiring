import type { SupabaseClient } from "@supabase/supabase-js";

import { companyEnv } from "@/configurations/env-configuration";
import { normalizeAddressList, normalizeAttachments } from "@/app/api/_mappers";
import { deliverToRelay, displaySenderName, downloadAttachments } from "@/app/api/messages/_send";
import { touchThread } from "@/app/api/messages/_threads";
import type { Database, Json } from "@/types/database.types";
import type { MessageAttachment, ScheduledMessageRunSummary } from "@/types/api";
import { htmlToPlainText } from "@/utilities/email-headers";
import { nextDailyLimitReset } from "@/utilities/email-limits";

export const DEFAULT_MESSAGE_BATCH_SIZE = 50;

const CLAIMED_MESSAGE_SELECT =
  "id, person_id, application_id, to_address, cc, bcc, subject, body, attachments, thread_id, sender_user_id, applications(position_id, positions(email_sender_name)), profiles(full_name, email)";

type ClaimedMessageRow = {
  id: string;
  person_id: string;
  application_id: string | null;
  to_address: string | null;
  cc: Json;
  bcc: Json;
  subject: string | null;
  body: string | null;
  attachments: Json;
  thread_id: string | null;
  sender_user_id: string | null;
  applications: {
    position_id: string;
    positions: { email_sender_name: string | null } | null;
  } | null;
  profiles: { full_name: string | null; email: string | null } | null;
};

type Settlement =
  | { status: "sent"; fromAddress: string; relayMessageId: string; rfcMessageId: string | null }
  | { status: "failed"; reason: string }
  /** Refused at the relay's daily limit: rescheduled for after the reset. */
  | { status: "deferred" };

function failed(reason: string): Settlement {
  return { status: "failed", reason };
}

function toSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function senderNameFor(row: ClaimedMessageRow): string {
  const profile = toSingle(row.profiles);
  const position = toSingle(toSingle(row.applications)?.positions);

  return displaySenderName({
    origin: row.sender_user_id ? "manual" : "automated",
    userFullName: profile?.full_name,
    userEmail: profile?.email,
    positionSenderName: position?.email_sender_name,
    companyName: companyEnv().COMPANY_NAME,
  });
}

async function sendClaimedMessage(
  supabase: SupabaseClient<Database>,
  row: ClaimedMessageRow,
): Promise<Settlement> {
  const toAddress = (row.to_address ?? "").trim();
  if (!toAddress) {
    return failed("That message has no recipient address, so it could not be sent");
  }

  const attachments: MessageAttachment[] = normalizeAttachments(row.attachments);
  const downloaded = await downloadAttachments(attachments);
  if ("error" in downloaded) return failed(downloaded.error);

  const html = row.body ?? "";

  const delivery = await deliverToRelay(supabase, {
    senderDisplayName: senderNameFor(row),
    to: toAddress,
    cc: normalizeAddressList(row.cc),
    bcc: normalizeAddressList(row.bcc),
    subject: row.subject ?? "",
    html,
    text: htmlToPlainText(html),
    files: downloaded.files,
    threadId: row.thread_id,
  });

  if (delivery.outcome === "failed") {
    if (delivery.limit === "daily") return { status: "deferred" };
    return failed(delivery.reason);
  }

  return {
    status: "sent",
    fromAddress: delivery.fromAddress,
    relayMessageId: delivery.relayMessageId,
    rfcMessageId: delivery.rfcMessageId,
  };
}

async function settle(
  supabase: SupabaseClient<Database>,
  row: ClaimedMessageRow,
  settlement: Exclude<Settlement, { status: "deferred" }>,
  at: Date,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("complete_scheduled_message", {
    p_id: row.id,
    p_status: settlement.status,
    p_now: at.toISOString(),
    p_failure_reason: settlement.status === "failed" ? settlement.reason : undefined,
    p_from_address: settlement.status === "sent" ? settlement.fromAddress : undefined,
    p_relay_message_id: settlement.status === "sent" ? settlement.relayMessageId : undefined,
    p_rfc_message_id:
      settlement.status === "sent" ? (settlement.rfcMessageId ?? undefined) : undefined,
  });

  return !error && data === true;
}

export async function runDueScheduledMessages(
  supabase: SupabaseClient<Database>,
  options: { now: Date; batchSize?: number },
): Promise<ScheduledMessageRunSummary> {
  const summary: ScheduledMessageRunSummary = { claimed: 0, sent: 0, failed: 0, deferred: 0 };
  const heldUntil = nextDailyLimitReset(options.now);
  let emailsHeld = false;

  const { data: claimedIds, error: claimError } = await supabase.rpc("claim_due_messages", {
    p_now: options.now.toISOString(),
    p_limit: options.batchSize ?? DEFAULT_MESSAGE_BATCH_SIZE,
  });

  if (claimError) throw new Error(`Could not claim due messages: ${claimError.message}`);
  const ids = claimedIds ?? [];
  if (ids.length === 0) return summary;

  summary.claimed = ids.length;

  const { data: rows, error: readError } = await supabase
    .from("messages")
    .select(CLAIMED_MESSAGE_SELECT)
    .in("id", ids);

  if (readError) throw new Error(`Could not read claimed messages: ${readError.message}`);

  for (const row of rows ?? []) {
    // Once the relay has refused one for the daily limit, the rest of the
    // batch would be refused too; they wait without asking again.
    const outcome = await processClaimedMessage(supabase, row, { emailsHeld, heldUntil });
    if (outcome === "deferred") emailsHeld = true;
    if (outcome) summary[outcome] += 1;
  }

  return summary;
}

/**
 * Sends one claimed message and records the result: sent, failed, or put back
 * until the daily limit resets. Returns what was recorded, or null when the
 * row had already been settled elsewhere.
 */
async function processClaimedMessage(
  supabase: SupabaseClient<Database>,
  row: ClaimedMessageRow,
  options: { emailsHeld: boolean; heldUntil: Date },
): Promise<"sent" | "failed" | "deferred" | null> {
  let settlement: Settlement;
  try {
    settlement = options.emailsHeld
      ? { status: "deferred" }
      : await sendClaimedMessage(supabase, row);
  } catch (error) {
    settlement = failed(error instanceof Error ? error.message : "Unexpected error");
  }

  if (settlement.status === "deferred") {
    const { data: deferred } = await supabase.rpc("defer_scheduled_message", {
      p_id: row.id,
      p_until: options.heldUntil.toISOString(),
      p_now: new Date().toISOString(),
    });
    return deferred === true ? "deferred" : null;
  }

  const sentAt = new Date();
  if (!(await settle(supabase, row, settlement, sentAt))) return null;

  if (settlement.status === "sent" && row.thread_id) {
    await touchThread(supabase, row.thread_id, {
      at: sentAt.toISOString(),
      direction: "outbound",
      positionId: toSingle(row.applications)?.position_id ?? null,
      applicationId: row.application_id,
    });
  }

  return settlement.status;
}

/**
 * "Send now" on a held email: claims just that one (scheduled -> sending, the
 * same move the worker makes) and sends it in this request, so the person sees
 * it go out instead of waiting for the worker's next pass. Returns null when
 * it was no longer waiting (already sent, sending, or undone).
 */
export async function sendScheduledMessageNow(
  supabase: SupabaseClient<Database>,
  messageId: string,
  now: Date = new Date(),
): Promise<"sent" | "failed" | "deferred" | null> {
  const { data: claimed, error } = await supabase
    .from("messages")
    .update({ status: "sending", send_claimed_at: now.toISOString() })
    .eq("id", messageId)
    .eq("status", "scheduled")
    .select(CLAIMED_MESSAGE_SELECT)
    .maybeSingle();

  if (error) throw new Error(`Could not claim the message: ${error.message}`);
  if (!claimed) return null;

  return processClaimedMessage(supabase, claimed, {
    emailsHeld: false,
    heldUntil: nextDailyLimitReset(now),
  });
}
