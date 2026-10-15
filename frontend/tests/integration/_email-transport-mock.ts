import type {
  InboundAttachmentBytes,
  InboundEmail,
  OutboundEmail,
  SentEmail,
} from "@/configurations/email-transport";

export class FakeEmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailSendError";
  }
}

export class FakeEmailReceiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailReceiveError";
  }
}

type Behaviour = { kind: "accept" } | { kind: "reject"; message: string };

const state: {
  sent: OutboundEmail[];
  behaviour: Behaviour;
  inbound: Map<string, InboundEmail>;
  attachmentBytes: Map<string, InboundAttachmentBytes>;
  inboundFailure: string | null;
  fetchCounts: Map<string, number>;
} = {
  sent: [],
  behaviour: { kind: "accept" },
  inbound: new Map(),
  attachmentBytes: new Map(),
  inboundFailure: null,
  fetchCounts: new Map(),
};

export const fakeTransport = {
  async send(email: OutboundEmail): Promise<SentEmail> {
    if (state.behaviour.kind === "reject") {
      throw new FakeEmailSendError(state.behaviour.message);
    }
    state.sent.push(email);
    return {
      relayMessageId: `fake-${crypto.randomUUID()}`,
      fromAddress: `${email.senderDisplayName ?? "Acme Inc."} <talent@hiring.example.com>`,
      rfcMessageId: `${crypto.randomUUID()}@ap-northeast-1.amazonses.com`,
    };
  },

  async fetchInbound(emailId: string): Promise<InboundEmail> {
    state.fetchCounts.set(emailId, (state.fetchCounts.get(emailId) ?? 0) + 1);
    if (state.inboundFailure) throw new FakeEmailReceiveError(state.inboundFailure);

    const email = state.inbound.get(emailId);
    if (!email) throw new FakeEmailReceiveError(`No inbound email queued for ${emailId}`);
    return email;
  },

  async downloadInboundAttachment(
    emailId: string,
    attachmentId: string,
  ): Promise<InboundAttachmentBytes> {
    const bytes = state.attachmentBytes.get(`${emailId}:${attachmentId}`);
    if (!bytes) throw new FakeEmailReceiveError(`No bytes queued for attachment ${attachmentId}`);
    return bytes;
  },
};

export function sentEmails(): OutboundEmail[] {
  return state.sent;
}

export function lastSentEmail(): OutboundEmail | undefined {
  return state.sent[state.sent.length - 1];
}

export function resetTransport(): void {
  state.sent = [];
  state.behaviour = { kind: "accept" };
  state.inbound = new Map();
  state.attachmentBytes = new Map();
  state.inboundFailure = null;
  state.fetchCounts = new Map();
}

export function makeTransportFail(message: string): void {
  state.behaviour = { kind: "reject", message };
}

export function makeInboundFetchFail(message: string | null): void {
  state.inboundFailure = message;
}

export function queueInboundEmail(
  email: Partial<InboundEmail> & { emailId: string },
): InboundEmail {
  const complete: InboundEmail = {
    from: "candidate@example.com",
    to: ["talent@hiring.example.com"],
    cc: [],
    subject: "Re: Your interview",
    html: null,
    text: "Thanks, Thursday works.",
    headers: {},
    rfcMessageId: `${crypto.randomUUID()}@mail.example.com`,
    receivedAt: new Date().toISOString(),
    attachments: [],
    ...email,
  };

  state.inbound.set(complete.emailId, complete);
  return complete;
}

export function queueInboundAttachment(
  emailId: string,
  attachmentId: string,
  bytes: InboundAttachmentBytes,
): void {
  state.attachmentBytes.set(`${emailId}:${attachmentId}`, bytes);
}

export function inboundFetchCount(emailId: string): number {
  return state.fetchCounts.get(emailId) ?? 0;
}
