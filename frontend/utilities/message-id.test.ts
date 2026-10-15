import { describe, expect, it } from "vitest";

import { normalizeMessageId } from "@/utilities/email-headers";
import {
  createMessageId,
  formatMessageIdHeader,
  messageIdDomain,
  outboundMessageHeaders,
} from "@/utilities/message-id";

const RELAY = "talent@hiring.example.com";
const RFC_HEADER = /^<[^\s<>@]+@[^\s<>@]+>$/;

describe("messageIdDomain", () => {
  it("takes the domain from the verified sending address", () => {
    expect(messageIdDomain(RELAY)).toBe("hiring.example.com");
  });

  it("lower-cases the domain, which is case-insensitive", () => {
    expect(messageIdDomain("Talent@Hiring.Example.com")).toBe("hiring.example.com");
  });

  it("falls back rather than producing an address-shaped nothing", () => {
    expect(messageIdDomain("not-an-address")).toBe("localhost");
    expect(messageIdDomain("")).toBe("localhost");
    expect(messageIdDomain(null)).toBe("localhost");
  });
});

describe("createMessageId", () => {
  it("is one token at the sending domain", () => {
    const id = createMessageId(RELAY);

    expect(id.split("@")).toHaveLength(2);
    expect(id.endsWith("@hiring.example.com")).toBe(true);
  });

  it("is RFC 5322 shaped once bracketed", () => {
    expect(formatMessageIdHeader(createMessageId(RELAY))).toMatch(RFC_HEADER);
  });

  it("survives the normalizer both sides of threading use", () => {
    const id = createMessageId(RELAY);

    expect(normalizeMessageId(id)).toBe(id);
    expect(normalizeMessageId(formatMessageIdHeader(id))).toBe(id);
  });

  it("carries no character that would break a header", () => {
    expect(createMessageId(RELAY)).toMatch(/^[a-z0-9.\-_]+@[a-z0-9.-]+$/);
  });

  it("is unique across a burst of sends", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => createMessageId(RELAY)));
    expect(ids.size).toBe(1000);
  });
});

describe("outboundMessageHeaders", () => {
  it("sets our own Message-ID so a reply has something to point at", () => {
    const headers = outboundMessageHeaders({ messageId: "abc@hiring.example.com" });

    expect(headers).toEqual({ "Message-ID": "<abc@hiring.example.com>" });
  });

  it("sets the threading headers alongside it", () => {
    const headers = outboundMessageHeaders({
      messageId: "new@hiring.example.com",
      inReplyTo: "parent@hiring.example.com",
      references: ["oldest@hiring.example.com", "parent@hiring.example.com"],
    });

    expect(headers).toEqual({
      "Message-ID": "<new@hiring.example.com>",
      "In-Reply-To": "<parent@hiring.example.com>",
      References: "<oldest@hiring.example.com> <parent@hiring.example.com>",
    });
  });

  it("accepts ids that already carry their angle brackets", () => {
    const headers = outboundMessageHeaders({ messageId: "<abc@hiring.example.com>" });

    expect(headers).toEqual({ "Message-ID": "<abc@hiring.example.com>" });
  });

  it("drops anything that could inject a second header", () => {
    const headers = outboundMessageHeaders({
      messageId: "ok@hiring.example.com",
      inReplyTo: "bad@example.com>\r\nBcc: someone@elsewhere.test",
      references: ["also bad@example.com", "fine@example.com"],
    });

    expect(headers).toEqual({
      "Message-ID": "<ok@hiring.example.com>",
      References: "<fine@example.com>",
    });
  });

  it("is undefined when there is nothing worth sending", () => {
    expect(outboundMessageHeaders({})).toBeUndefined();
    expect(
      outboundMessageHeaders({ messageId: null, inReplyTo: null, references: [] }),
    ).toBeUndefined();
  });
});
