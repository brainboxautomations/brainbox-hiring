import { Resend } from "resend";

import { serverEnv } from "@/configurations/env-configuration";
import { formatFromHeader } from "@/utilities/email-address";
import { normalizeMessageId } from "@/utilities/email-headers";
import {
  RATE_LIMIT_RETRY_DELAYS_MS,
  classifyRelayError,
  limitReason,
  type EmailLimit,
} from "@/utilities/email-limits";
import { outboundMessageHeaders } from "@/utilities/message-id";

export type OutboundAttachment = {
  filename: string;
  content: Buffer;
  contentType: string | null;
};

export type OutboundEmail = {
  senderDisplayName: string | null;
  messageId: string;
  to: string;
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  text: string;
  attachments: OutboundAttachment[];
  inReplyTo?: string | null;
  references?: string[];
};

export type SentEmail = {
  relayMessageId: string;
  fromAddress: string;
  rfcMessageId: string | null;
};

export type InboundAttachmentSource = {
  id: string;
  filename: string | null;
  contentType: string | null;
  size: number;
};

export type InboundEmail = {
  emailId: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string | null;
  html: string | null;
  text: string | null;
  headers: Record<string, string>;
  rfcMessageId: string | null;
  receivedAt: string;
  attachments: InboundAttachmentSource[];
};

export type InboundAttachmentBytes = {
  content: Buffer;
  contentType: string | null;
  filename: string | null;
};

export type EmailTransport = {
  send(email: OutboundEmail): Promise<SentEmail>;
  fetchInbound(emailId: string): Promise<InboundEmail>;
  downloadInboundAttachment(emailId: string, attachmentId: string): Promise<InboundAttachmentBytes>;
};

export class EmailSendError extends Error {
  /** Set when the relay refused because a sending limit was reached. */
  readonly limit: EmailLimit | null;

  constructor(message: string, limit: EmailLimit | null = null) {
    super(message);
    this.name = "EmailSendError";
    this.limit = limit;
  }
}

export const EMAIL_RELAY_NOT_CONFIGURED =
  "Email is not configured: EMAIL_RELAY_ADDRESS is not set, so nothing can be sent";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class EmailReceiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailReceiveError";
  }
}

function normalizeHeaderRecord(raw: Record<string, string> | null): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") headers[key] = value;
  }
  return headers;
}

function createResendTransport(): EmailTransport {
  const { RESEND_API_KEY, EMAIL_RELAY_ADDRESS } = serverEnv();
  const resend = new Resend(RESEND_API_KEY);

  return {
    async send(email) {
      if (!EMAIL_RELAY_ADDRESS) throw new EmailSendError(EMAIL_RELAY_NOT_CONFIGURED);

      const from = formatFromHeader(email.senderDisplayName, EMAIL_RELAY_ADDRESS);

      const request = () =>
        resend.emails.send({
          from,
          to: email.to,
          cc: email.cc.length > 0 ? email.cc : undefined,
          bcc: email.bcc.length > 0 ? email.bcc : undefined,
          replyTo: EMAIL_RELAY_ADDRESS,
          subject: email.subject,
          html: email.html,
          text: email.text,
          headers: outboundMessageHeaders(email),
          attachments:
            email.attachments.length > 0
              ? email.attachments.map((attachment) => ({
                  filename: attachment.filename,
                  content: attachment.content,
                  contentType: attachment.contentType ?? undefined,
                }))
              : undefined,
        });

      // A burst past ten requests a second is refused for a moment, not for
      // good: wait and try again a few times before giving up on the email.
      let { data, error } = await request();
      for (const delay of RATE_LIMIT_RETRY_DELAYS_MS) {
        if (!error || classifyRelayError(error) !== "rate_limited") break;
        await sleep(delay);
        ({ data, error } = await request());
      }

      if (error) {
        const refusal = classifyRelayError(error);
        if (refusal === "daily" || refusal === "monthly") {
          throw new EmailSendError(limitReason(refusal), refusal);
        }
        throw new EmailSendError(error.message);
      }
      if (!data?.id) throw new EmailSendError("The relay accepted the email but returned no id");

      let rfcMessageId = normalizeMessageId(email.messageId);

      if (!rfcMessageId) {
        try {
          const detail = await resend.emails.get(data.id);
          rfcMessageId = normalizeMessageId(detail.data?.message_id ?? null);
        } catch {
          rfcMessageId = null;
        }
      }

      return { relayMessageId: data.id, fromAddress: from, rfcMessageId };
    },

    async fetchInbound(emailId) {
      const { data, error } = await resend.emails.receiving.get(emailId);
      if (error) throw new EmailReceiveError(error.message);
      if (!data) throw new EmailReceiveError(`The relay returned no email for ${emailId}`);

      return {
        emailId: data.id,
        from: data.from,
        to: data.to ?? [],
        cc: data.cc ?? [],
        subject: data.subject ?? null,
        html: data.html ?? null,
        text: data.text ?? null,
        headers: normalizeHeaderRecord(data.headers),
        rfcMessageId: normalizeMessageId(data.message_id),
        receivedAt: data.created_at,
        attachments: (data.attachments ?? []).map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          contentType: attachment.content_type ?? null,
          size: attachment.size,
        })),
      };
    },

    async downloadInboundAttachment(emailId, attachmentId) {
      const { data, error } = await resend.emails.receiving.attachments.get({
        emailId,
        id: attachmentId,
      });
      if (error) throw new EmailReceiveError(error.message);
      if (!data?.download_url) {
        throw new EmailReceiveError(`No download URL for attachment ${attachmentId}`);
      }

      const response = await fetch(data.download_url);
      if (!response.ok) {
        throw new EmailReceiveError(
          `Downloading attachment ${attachmentId} failed with ${response.status}`,
        );
      }

      return {
        content: Buffer.from(await response.arrayBuffer()),
        contentType: data.content_type ?? null,
        filename: data.filename ?? null,
      };
    },
  };
}

let transport: EmailTransport | null = null;

export function getEmailTransport(): EmailTransport {
  if (!transport) transport = createResendTransport();
  return transport;
}
