import type { SupabaseClient } from "@supabase/supabase-js";

import { companyEnv, serverEnv } from "@/configurations/env-configuration";
import {
  EMAIL_RELAY_NOT_CONFIGURED,
  EmailSendError,
  getEmailTransport,
  type OutboundAttachment,
} from "@/configurations/email-transport";
import type { Database, Json } from "@/types/database.types";
import type { MessageAttachment } from "@/types/api";
import { normalizeEmailAddress } from "@/utilities/email-address";
import {
  buildMergeContext,
  resolveMergeVariables,
  type MergeContext,
  type MergeLocation,
} from "@/utilities/merge-variables";
import { getObject } from "@/configurations/object-storage";
import { nextDailyLimitReset, type EmailLimit } from "@/utilities/email-limits";
import { MESSAGE_ATTACHMENT_BUCKET } from "@/utilities/message-attachments";
import { createMessageId } from "@/utilities/message-id";
import { richTextToHtml, richTextToPlainText } from "@/utilities/rich-text";
import { ensureThread, threadReplyHeaders, touchThread } from "@/app/api/messages/_threads";

export type MessageOrigin = "manual" | "automated";

export const MESSAGE_CONTEXT_SELECT =
  "id, person_id, position_id, people(id, first_name, last_name, email, phone, custom_attributes), positions(id, title, department, locations, remote_flag, salary_from, salary_to, salary_period, salary_currency, email_sender_name)";

export const PERSON_CONTEXT_SELECT = "id, first_name, last_name, email, phone, custom_attributes";

export const MESSAGE_SELECT =
  "id, person_id, application_id, direction, from_address, to_address, cc, bcc, subject, body, attachments, status, thread_id, relay_message_id, rfc_message_id, inbound_email_id, headers, scheduled_for, sent_at, failure_reason, created_at, profiles(full_name)";

type PersonRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  custom_attributes: Json;
};

type PositionRow = {
  id: string;
  title: string;
  department: string | null;
  locations: Json;
  remote_flag: boolean;
  salary_from: number | null;
  salary_to: number | null;
  salary_period: string | null;
  salary_currency: string | null;
  email_sender_name: string | null;
};

export type SendTarget = {
  personId: string;
  applicationId: string | null;
  person: PersonRow;
  position: PositionRow | null;
};

function normalizeCustomAttributes(raw: Json): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") attributes[key] = value;
  }
  return attributes;
}

function normalizeMergeLocations(raw: Json): MergeLocation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): MergeLocation | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const { country, detail } = item as Record<string, unknown>;
      if (typeof country !== "string") return null;
      return { country, detail: typeof detail === "string" ? detail : null };
    })
    .filter((x): x is MergeLocation => x !== null);
}

function toSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function loadSendTarget(
  supabase: SupabaseClient<Database>,
  input: { applicationId?: string | null; personId?: string | null },
): Promise<{ target: SendTarget } | { error: string; status: number }> {
  if (input.applicationId) {
    const { data, error } = await supabase
      .from("applications")
      .select(MESSAGE_CONTEXT_SELECT)
      .eq("id", input.applicationId)
      .maybeSingle();

    if (error) return { error: error.message, status: 500 };
    if (!data) return { error: "Application not found", status: 404 };

    const person = toSingle(data.people);
    if (!person) return { error: "That application has no person attached", status: 409 };

    return {
      target: {
        personId: data.person_id,
        applicationId: data.id,
        person,
        position: toSingle(data.positions),
      },
    };
  }

  const { data, error } = await supabase
    .from("people")
    .select(PERSON_CONTEXT_SELECT)
    .eq("id", input.personId as string)
    .maybeSingle();

  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Person not found", status: 404 };

  return { target: { personId: data.id, applicationId: null, person: data, position: null } };
}

export function mergeContextFor(target: SendTarget, senderName: string): MergeContext {
  const { COMPANY_NAME, COMPANY_CAREERS_URL } = companyEnv();

  return buildMergeContext({
    candidate: {
      firstName: target.person.first_name,
      lastName: target.person.last_name,
      email: target.person.email,
      phone: target.person.phone,
      customAttributes: normalizeCustomAttributes(target.person.custom_attributes),
    },
    position: target.position
      ? {
          title: target.position.title,
          department: target.position.department,
          locations: normalizeMergeLocations(target.position.locations),
          remoteFlag: target.position.remote_flag,
          salaryFrom: target.position.salary_from,
          salaryTo: target.position.salary_to,
          salaryPeriod: target.position.salary_period,
          salaryCurrency: target.position.salary_currency,
        }
      : null,
    company: { name: COMPANY_NAME, careersUrl: COMPANY_CAREERS_URL },
    senderName,
  });
}

export function displaySenderName(input: {
  origin: MessageOrigin;
  userFullName?: string | null;
  userEmail?: string | null;
  positionSenderName?: string | null;
  companyName: string;
}): string {
  if (input.origin === "automated") {
    return (input.positionSenderName ?? "").trim() || input.companyName;
  }

  const fullName = (input.userFullName ?? "").trim();
  if (fullName) return fullName;

  const email = (input.userEmail ?? "").trim();
  const localPart = email.includes("@") ? email.slice(0, email.indexOf("@")) : email;
  return localPart || input.companyName;
}

const HTML_SHELL_OPEN =
  '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.7;color:#1e293b">';
const HTML_SHELL_CLOSE = "</div>";

export type ComposedEmail = {
  subject: string;
  html: string;
  text: string;
};

export function composeEmail(
  subjectTemplate: string,
  bodyTemplate: string,
  context: MergeContext,
): ComposedEmail {
  const subject = resolveMergeVariables(subjectTemplate, context).trim();
  const body = resolveMergeVariables(bodyTemplate, context);

  return {
    subject,
    html: `${HTML_SHELL_OPEN}${richTextToHtml(body)}${HTML_SHELL_CLOSE}`,
    text: richTextToPlainText(body),
  };
}

export async function downloadAttachments(
  attachments: MessageAttachment[],
): Promise<{ files: OutboundAttachment[] } | { error: string }> {
  const files: OutboundAttachment[] = [];

  for (const attachment of attachments) {
    let bytes: Uint8Array;
    try {
      ({ bytes } = await getObject(MESSAGE_ATTACHMENT_BUCKET, attachment.path));
    } catch {
      return { error: `Could not read the attachment ${attachment.filename}` };
    }

    files.push({
      filename: attachment.filename,
      content: Buffer.from(bytes),
      contentType: attachment.mimeType,
    });
  }

  return { files };
}

export type OutboundDelivery = {
  senderDisplayName: string;
  to: string;
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  text: string;
  files: OutboundAttachment[];
  threadId: string | null;
};

export type DeliveryResult =
  | {
      outcome: "sent";
      fromAddress: string;
      relayMessageId: string;
      rfcMessageId: string | null;
    }
  | { outcome: "failed"; reason: string; limit: EmailLimit | null };

export async function deliverToRelay(
  supabase: SupabaseClient<Database>,
  delivery: OutboundDelivery,
): Promise<DeliveryResult> {
  const { EMAIL_RELAY_ADDRESS } = serverEnv();

  const replyTo = delivery.threadId
    ? await threadReplyHeaders(supabase, delivery.threadId)
    : { inReplyTo: null, references: [] };

  try {
    const sent = await getEmailTransport().send({
      senderDisplayName: delivery.senderDisplayName,
      messageId: createMessageId(EMAIL_RELAY_ADDRESS),
      to: delivery.to,
      cc: delivery.cc,
      bcc: delivery.bcc,
      subject: delivery.subject,
      html: delivery.html,
      text: delivery.text,
      attachments: delivery.files,
      inReplyTo: replyTo.inReplyTo,
      references: replyTo.references,
    });

    return {
      outcome: "sent",
      fromAddress: sent.fromAddress,
      relayMessageId: sent.relayMessageId,
      rfcMessageId: sent.rfcMessageId,
    };
  } catch (error) {
    const reason =
      error instanceof EmailSendError || error instanceof Error
        ? error.message
        : "The mail relay did not respond";

    return {
      outcome: "failed",
      reason,
      limit: error instanceof EmailSendError ? error.limit : null,
    };
  }
}

export type TemplatedEmailSender =
  | { origin: "automated" }
  | { origin: "manual"; userId: string; fullName: string | null; email: string | null };

export type TemplatedEmailResult =
  | { outcome: "sent"; messageId: string }
  | { outcome: "scheduled"; messageId: string; scheduledFor: string }
  | { outcome: "failed"; reason: string; messageId: string | null; limit?: EmailLimit | null };

export type DispatchInput = {
  target: SendTarget;
  senderDisplayName: string;
  senderUserId: string | null;
  subjectTemplate: string;
  bodyTemplate: string;
  recordedBodyTemplate?: string;
  cc: string[];
  bcc: string[];
  attachments: MessageAttachment[];
  scheduledFor: string | null;
  threadId?: string | null;
  /**
   * What to do when the relay refuses because its daily limit is reached:
   * "schedule" holds the email until just after the reset (a person's send,
   * which has a stored body to send later); "report" records nothing and
   * returns the limit, so the automation worker can put its action back in
   * the queue. Left out, the refusal is recorded as a failed message.
   */
  onDailyLimit?: "schedule" | "report";
};

export const RECORDED_BODY_CANNOT_BE_SCHEDULED =
  "A scheduled message is sent from its stored body, so it cannot be stored in a redacted form";

export type DispatchResult =
  | { outcome: "sent"; messageId: string; threadId: string }
  | {
      outcome: "scheduled";
      messageId: string;
      threadId: string;
      /** Held past the relay's daily limit rather than scheduled by the sender. */
      deferred: boolean;
      scheduledFor: string;
    }
  | {
      outcome: "failed";
      messageId: string | null;
      error: string;
      status: number;
      limit?: EmailLimit | null;
    };

export async function dispatchMessage(
  supabase: SupabaseClient<Database>,
  input: DispatchInput,
): Promise<DispatchResult> {
  const { EMAIL_RELAY_ADDRESS } = serverEnv();
  if (!EMAIL_RELAY_ADDRESS) {
    return { outcome: "failed", messageId: null, error: EMAIL_RELAY_NOT_CONFIGURED, status: 503 };
  }

  const toAddress = normalizeEmailAddress(input.target.person.email);
  if (!toAddress) {
    return {
      outcome: "failed",
      messageId: null,
      error: "That candidate has no valid email address",
      status: 422,
    };
  }

  if (input.scheduledFor && input.recordedBodyTemplate) {
    return {
      outcome: "failed",
      messageId: null,
      error: RECORDED_BODY_CANNOT_BE_SCHEDULED,
      status: 422,
    };
  }

  const context = mergeContextFor(input.target, input.senderDisplayName);
  const composed = composeEmail(input.subjectTemplate, input.bodyTemplate, context);
  const recorded = input.recordedBodyTemplate
    ? composeEmail(input.subjectTemplate, input.recordedBodyTemplate, context)
    : composed;

  const thread = input.threadId
    ? { threadId: input.threadId }
    : await ensureThread(supabase, {
        personId: input.target.personId,
        positionId: input.target.position?.id ?? null,
        applicationId: input.target.applicationId,
        subject: composed.subject,
      });

  if ("error" in thread) {
    return { outcome: "failed", messageId: null, error: thread.error, status: 500 };
  }

  const baseRow = {
    person_id: input.target.personId,
    application_id: input.target.applicationId,
    direction: "outbound" as const,
    to_address: toAddress,
    cc: input.cc as unknown as Json,
    bcc: input.bcc as unknown as Json,
    subject: composed.subject,
    body: recorded.html,
    attachments: input.attachments as unknown as Json,
    sender_user_id: input.senderUserId,
    thread_id: thread.threadId,
  };

  const schedule = async (scheduledFor: string, deferred: boolean): Promise<DispatchResult> => {
    const { data, error } = await supabase
      .from("messages")
      .insert({
        ...baseRow,
        from_address: EMAIL_RELAY_ADDRESS,
        status: "scheduled",
        scheduled_for: scheduledFor,
      })
      .select("id")
      .single();

    if (error || !data) {
      return {
        outcome: "failed",
        messageId: null,
        error: error?.message ?? "Could not schedule the message",
        status: 500,
      };
    }

    return {
      outcome: "scheduled",
      messageId: data.id,
      threadId: thread.threadId,
      deferred,
      scheduledFor,
    };
  };

  if (input.scheduledFor) return schedule(input.scheduledFor, false);

  const downloaded = await downloadAttachments(input.attachments);
  if ("error" in downloaded) {
    return { outcome: "failed", messageId: null, error: downloaded.error, status: 422 };
  }

  const delivery = await deliverToRelay(supabase, {
    senderDisplayName: input.senderDisplayName,
    to: toAddress,
    cc: input.cc,
    bcc: input.bcc,
    subject: composed.subject,
    html: composed.html,
    text: composed.text,
    files: downloaded.files,
    threadId: thread.threadId,
  });

  if (delivery.outcome === "failed") {
    if (
      delivery.limit === "daily" &&
      input.onDailyLimit === "schedule" &&
      !input.recordedBodyTemplate
    ) {
      return schedule(nextDailyLimitReset(new Date()).toISOString(), true);
    }
    if (delivery.limit && input.onDailyLimit === "report") {
      return {
        outcome: "failed",
        messageId: null,
        error: delivery.reason,
        status: 429,
        limit: delivery.limit,
      };
    }

    const { data } = await supabase
      .from("messages")
      .insert({
        ...baseRow,
        from_address: EMAIL_RELAY_ADDRESS,
        status: "failed",
        failure_reason: delivery.reason,
      })
      .select("id")
      .single();

    return {
      outcome: "failed",
      messageId: data?.id ?? null,
      error: delivery.reason,
      status: delivery.limit ? 429 : 502,
      limit: delivery.limit,
    };
  }

  const sentAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("messages")
    .insert({
      ...baseRow,
      from_address: delivery.fromAddress,
      status: "sent",
      relay_message_id: delivery.relayMessageId,
      rfc_message_id: delivery.rfcMessageId,
      sent_at: sentAt,
    })
    .select("id")
    .single();

  if (error || !data) {
    return {
      outcome: "failed",
      messageId: null,
      error: `The email was sent (relay id ${delivery.relayMessageId}) but could not be recorded: ${error?.message ?? "insert failed"}`,
      status: 500,
    };
  }

  await touchThread(supabase, thread.threadId, {
    at: sentAt,
    direction: "outbound",
    positionId: input.target.position?.id ?? null,
    applicationId: input.target.applicationId,
  });

  return { outcome: "sent", messageId: data.id, threadId: thread.threadId };
}

export async function sendTemplatedEmail(
  supabase: SupabaseClient<Database>,
  input: {
    applicationId: string;
    sender: TemplatedEmailSender;
    subjectTemplate: string;
    bodyTemplate: string;
    recordedBodyTemplate?: string;
    onDailyLimit?: DispatchInput["onDailyLimit"];
    /** Store it to send later instead of sending now (see dispatchMessage). */
    scheduledFor?: string | null;
  },
): Promise<TemplatedEmailResult> {
  const loaded = await loadSendTarget(supabase, { applicationId: input.applicationId });
  if ("error" in loaded) {
    return { outcome: "failed", reason: loaded.error, messageId: null };
  }

  const manual = input.sender.origin === "manual" ? input.sender : null;

  const result = await dispatchMessage(supabase, {
    target: loaded.target,
    senderDisplayName: displaySenderName({
      origin: input.sender.origin,
      userFullName: manual?.fullName ?? null,
      userEmail: manual?.email ?? null,
      positionSenderName: loaded.target.position?.email_sender_name,
      companyName: companyEnv().COMPANY_NAME,
    }),
    senderUserId: manual?.userId ?? null,
    subjectTemplate: input.subjectTemplate,
    bodyTemplate: input.bodyTemplate,
    recordedBodyTemplate: input.recordedBodyTemplate,
    cc: [],
    bcc: [],
    attachments: [],
    scheduledFor: input.scheduledFor ?? null,
    onDailyLimit: input.onDailyLimit,
  });

  if (result.outcome === "failed") {
    return {
      outcome: "failed",
      reason: result.error,
      messageId: result.messageId,
      limit: result.limit ?? null,
    };
  }

  if (result.outcome === "scheduled") {
    return { outcome: "scheduled", messageId: result.messageId, scheduledFor: result.scheduledFor };
  }

  return { outcome: "sent", messageId: result.messageId };
}
