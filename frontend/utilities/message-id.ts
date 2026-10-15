import { normalizeMessageId } from "@/utilities/email-headers";

const FALLBACK_DOMAIN = "localhost";

export function messageIdDomain(relayAddress: string | null | undefined): string {
  const address = (relayAddress ?? "").trim();
  const at = address.lastIndexOf("@");
  const domain =
    at >= 0
      ? address
          .slice(at + 1)
          .trim()
          .toLowerCase()
      : "";
  return domain.length > 0 ? domain : FALLBACK_DOMAIN;
}

function uniqueToken(): string {
  const stamp = Date.now().toString(36);
  const random = globalThis.crypto.randomUUID().replace(/-/g, "");
  return `${stamp}.${random}`;
}

export function createMessageId(relayAddress: string | null | undefined): string {
  return `${uniqueToken()}@${messageIdDomain(relayAddress)}`;
}

export function formatMessageIdHeader(messageId: string): string {
  return `<${messageId}>`;
}

export type OutboundMessageHeaderInput = {
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
};

export function outboundMessageHeaders(
  input: OutboundMessageHeaderInput,
): Record<string, string> | undefined {
  const headers: Record<string, string> = {};

  const own = normalizeMessageId(input.messageId);
  if (own) headers["Message-ID"] = formatMessageIdHeader(own);

  const parent = normalizeMessageId(input.inReplyTo);
  if (parent) headers["In-Reply-To"] = formatMessageIdHeader(parent);

  const chain = (input.references ?? [])
    .map((reference) => normalizeMessageId(reference))
    .filter((reference): reference is string => reference !== null);
  if (chain.length > 0) headers.References = chain.map(formatMessageIdHeader).join(" ");

  return Object.keys(headers).length > 0 ? headers : undefined;
}
