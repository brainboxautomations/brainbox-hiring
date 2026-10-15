import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const { cookieJar } = await import("./_cookie-jar");
  return { cookies: async () => cookieJar };
});

vi.mock("@/configurations/object-storage", async () => {
  const { fakeObjectStorage } = await import("./_object-storage-mock");
  return fakeObjectStorage;
});

vi.mock("@/configurations/email-transport", async () => {
  const { fakeTransport, FakeEmailSendError } = await import("./_email-transport-mock");
  return {
    EmailSendError: FakeEmailSendError,
    getEmailTransport: () => fakeTransport,
  };
});

vi.mock("@/configurations/supabase-service-configuration", async () => {
  const { getServiceClient } = await import("./_service-client");
  return {
    MissingServiceRoleKeyError: class MissingServiceRoleKeyError extends Error {},
    createSupabaseServiceClient: () => getServiceClient(),
  };
});

import { NextRequest } from "next/server";

import { POST as receiveWebhook } from "@/app/api/webhooks/resend/inbound/route";
import { POST as sendMessage } from "@/app/api/messages/route";
import { MESSAGE_ATTACHMENT_BUCKET } from "@/utilities/message-attachments";
import { signPayload } from "@/utilities/webhook-signature";
import {
  currentCookies,
  multipartRequest,
  restoreSession,
  seedCandidate,
  signInTestUser,
  type Fixture,
  type L3Session,
} from "./_harness";
import {
  inboundFetchCount,
  makeInboundFetchFail,
  queueInboundAttachment,
  queueInboundEmail,
  resetTransport,
} from "./_email-transport-mock";
import { storedObject } from "./_object-storage-mock";
import { setServiceClient } from "./_service-client";

const WEBHOOK_URL = "http://localhost:3000/api/webhooks/resend/inbound";
const MESSAGES_URL = "http://localhost:3000/api/messages";
const SECRET = "whsec_bDMtaW5ib3VuZC13ZWJob29rLXNlY3JldC1ub3QtYS1yZWFsLW9uZQ==";

let session: L3Session;
let sessionCookies: { name: string; value: string }[];
const fixtures: Fixture[] = [];
const unmatchedIds: string[] = [];

async function newCandidate(overrides: Parameters<typeof seedCandidate>[1] = {}) {
  const fixture = await seedCandidate(session.supabase, overrides);
  fixtures.push(fixture);
  return fixture;
}

function receivedPayload(emailId: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "email.received",
    created_at: new Date().toISOString(),
    data: { email_id: emailId, ...extra },
  });
}

async function signedRequest(
  payload: string,
  options: { id?: string; timestampSeconds?: number; signature?: string } = {},
) {
  const id = options.id ?? `msg_${crypto.randomUUID()}`;
  const timestamp = String(options.timestampSeconds ?? Math.floor(Date.now() / 1000));
  const signature = options.signature ?? `v1,${await signPayload(SECRET, id, timestamp, payload)}`;

  return new NextRequest(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": signature,
    },
    body: payload,
  });
}

async function deliver(payload: string, options: Parameters<typeof signedRequest>[1] = {}) {
  const response = await receiveWebhook(await signedRequest(payload, options));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function sendOutbound(applicationId: string, subject: string, body = "Hello there") {
  const response = await sendMessage(
    multipartRequest(MESSAGES_URL, { applicationId, subject, body }),
  );
  const json = (await response.json()) as { message: { id: string; threadId: string } };
  return json.message;
}

async function messagesFor(personId: string) {
  const { data } = await session.supabase
    .from("messages")
    .select("id, direction, body, subject, thread_id, inbound_email_id, from_address, attachments")
    .eq("person_id", personId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

beforeAll(async () => {
  session = await signInTestUser();
  sessionCookies = currentCookies();
  setServiceClient(session.supabase);
});

afterEach(() => {
  restoreSession(sessionCookies);
  resetTransport();
});

afterAll(async () => {
  restoreSession(sessionCookies);
  for (const id of unmatchedIds) {
    await session.supabase.from("unmatched_inbound_emails").delete().eq("id", id);
  }
  for (const fixture of fixtures) await fixture.cleanup();
});

describe("POST /api/webhooks/resend/inbound — the signature gate", () => {
  it("refuses a delivery that carries no signature headers", async () => {
    const payload = receivedPayload("email_unsigned");
    const response = await receiveWebhook(
      new NextRequest(WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      }),
    );

    expect(response.status).toBe(401);
    expect(inboundFetchCount("email_unsigned")).toBe(0);
  });

  it("refuses a payload that was altered after it was signed", async () => {
    const payload = receivedPayload("email_tampered");
    const id = `msg_${crypto.randomUUID()}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v1,${await signPayload(SECRET, id, timestamp, payload)}`;

    const response = await receiveWebhook(
      new NextRequest(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "svix-id": id,
          "svix-timestamp": timestamp,
          "svix-signature": signature,
        },
        body: receivedPayload("email_someone_elses"),
      }),
    );

    expect(response.status).toBe(401);
    expect(inboundFetchCount("email_someone_elses")).toBe(0);
  });

  it("refuses a signature made with the wrong secret", async () => {
    const payload = receivedPayload("email_wrong_secret");
    const { status } = await deliver(payload, { signature: "v1,bm90LXRoZS1zaWduYXR1cmU=" });
    expect(status).toBe(401);
  });

  it("refuses a genuine delivery that is being replayed hours later", async () => {
    const payload = receivedPayload("email_replayed");
    const { status } = await deliver(payload, {
      timestampSeconds: Math.floor(Date.now() / 1000) - 6 * 60 * 60,
    });

    expect(status).toBe(401);
    expect(inboundFetchCount("email_replayed")).toBe(0);
  });

  it("never reaches the relay for an unverified delivery", async () => {
    await deliver(receivedPayload("email_never_fetched"), { signature: "v1,AAAA" });
    expect(inboundFetchCount("email_never_fetched")).toBe(0);
  });

  it("refuses an oversized delivery, and refuses it without verifying it", async () => {
    const huge = JSON.stringify({
      type: "email.received",
      data: { padding: "x".repeat(1_100_000) },
    });
    const { status } = await deliver(huge, { id: "msg_oversized" });

    expect(status).toBe(413);
    expect(inboundFetchCount("email_oversized")).toBe(0);
  });

  it("reads a large but legal delivery whole, so the signature still verifies over every byte", async () => {
    const padded = JSON.stringify({
      type: "contact.created",
      data: { padding: "x".repeat(900_000) },
    });

    const { status, body } = await deliver(padded, { id: "msg_large_but_legal" });

    expect(status).toBe(200);
    expect(body.status).toBe("ignored");
  });
});

describe("POST /api/webhooks/resend/inbound — event routing", () => {
  it("acknowledges an event type it does not handle rather than making Resend retry", async () => {
    const payload = JSON.stringify({ type: "email.delivered", data: { email_id: "x" } });
    const { status, body } = await deliver(payload);
    expect(status).toBe(200);
    expect(body.status).toBe("ignored");
  });

  it("rejects an email.received event with no email_id", async () => {
    const payload = JSON.stringify({ type: "email.received", data: {} });
    const { status } = await deliver(payload);
    expect(status).toBe(422);
  });

  it("answers 500 when the relay will not hand over the message, so Resend retries", async () => {
    const emailId = `email_${crypto.randomUUID()}`;
    makeInboundFetchFail("the relay is down");

    const { status } = await deliver(receivedPayload(emailId));
    expect(status).toBe(500);
  });
});

describe("POST /api/webhooks/resend/inbound — matching the sender to a Person", () => {
  it("records the reply against the candidate it came from", async () => {
    const fixture = await newCandidate();
    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({
      emailId,
      from: `"Amara Okafor" <${fixture.email}>`,
      subject: "Re: Your interview at Acme",
      text: "Thursday afternoon works well for me.",
    });

    const { status, body } = await deliver(receivedPayload(emailId));

    expect(status).toBe(200);
    expect(body.status).toBe("recorded");

    const messages = await messagesFor(fixture.personId);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.direction).toBe("inbound");
    expect(messages[0]?.body).toContain("Thursday afternoon");
    expect(messages[0]?.from_address).toBe(fixture.email);
  });

  it("matches the address case-insensitively, as people.email is citext", async () => {
    const fixture = await newCandidate();
    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({ emailId, from: fixture.email.toUpperCase() });

    const { body } = await deliver(receivedPayload(emailId));
    expect(body.status).toBe("recorded");
    expect(await messagesFor(fixture.personId)).toHaveLength(1);
  });

  it("quarantines a reply from an address that is nobody we know, and drops nothing", async () => {
    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({
      emailId,
      from: "a-stranger@example.com",
      subject: "Free money",
      text: "Definitely not spam.",
    });

    const { status, body } = await deliver(receivedPayload(emailId));

    expect(status).toBe(200);
    expect(body.status).toBe("unmatched");
    expect(body.reason).toBe("no_matching_person");

    const { data } = await session.supabase
      .from("unmatched_inbound_emails")
      .select("id, from_address, subject, body_text, reason")
      .eq("relay_email_id", emailId)
      .single();

    expect(data?.from_address).toBe("a-stranger@example.com");
    expect(data?.body_text).toContain("Definitely not spam");
    if (data?.id) unmatchedIds.push(data.id);
  });

  it("quarantines a message whose From header cannot be read at all", async () => {
    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({ emailId, from: "<<not an address>>" });

    const { body } = await deliver(receivedPayload(emailId));
    expect(body.status).toBe("unmatched");
    expect(body.reason).toBe("sender_unreadable");

    const { data } = await session.supabase
      .from("unmatched_inbound_emails")
      .select("id")
      .eq("relay_email_id", emailId)
      .single();
    if (data?.id) unmatchedIds.push(data.id);
  });
});

describe("POST /api/webhooks/resend/inbound — idempotency", () => {
  it("recognises a retried delivery and writes only one message", async () => {
    const fixture = await newCandidate();
    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({ emailId, from: fixture.email });

    const payload = receivedPayload(emailId);
    const first = await deliver(payload);
    const second = await deliver(payload);

    expect(first.body.status).toBe("recorded");
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("duplicate");
    expect(await messagesFor(fixture.personId)).toHaveLength(1);
  });

  it("does not pay for a second relay call on a retry", async () => {
    const fixture = await newCandidate();
    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({ emailId, from: fixture.email });

    const payload = receivedPayload(emailId);
    await deliver(payload);
    await deliver(payload);

    expect(inboundFetchCount(emailId)).toBe(1);
  });

  it("recognises a retried delivery of an unmatched message too", async () => {
    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({ emailId, from: "another-stranger@example.com" });

    const payload = receivedPayload(emailId);
    await deliver(payload);
    const second = await deliver(payload);

    expect(second.body.status).toBe("duplicate");

    const { data } = await session.supabase
      .from("unmatched_inbound_emails")
      .select("id")
      .eq("relay_email_id", emailId);

    expect(data).toHaveLength(1);
    for (const row of data ?? []) unmatchedIds.push(row.id);
  });
});

describe("POST /api/webhooks/resend/inbound — threading", () => {
  it("threads a reply onto the message it answers, using In-Reply-To", async () => {
    const fixture = await newCandidate();
    const sent = await sendOutbound(fixture.applicationId, "Programming exercise");

    const { data: outbound } = await session.supabase
      .from("messages")
      .select("rfc_message_id, thread_id")
      .eq("id", sent.id)
      .single();

    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({
      emailId,
      from: fixture.email,
      subject: "Re: Programming exercise",
      headers: { "In-Reply-To": `<${outbound?.rfc_message_id}>` },
    });

    const { body } = await deliver(receivedPayload(emailId));

    expect(body.status).toBe("recorded");
    expect(body.threadId).toBe(outbound?.thread_id);
  });

  it("threads on References when In-Reply-To is missing", async () => {
    const fixture = await newCandidate();
    const sent = await sendOutbound(fixture.applicationId, "Take-home review");

    const { data: outbound } = await session.supabase
      .from("messages")
      .select("rfc_message_id, thread_id")
      .eq("id", sent.id)
      .single();

    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({
      emailId,
      from: fixture.email,
      subject: "Something else entirely",
      headers: { References: `<older@elsewhere.test> <${outbound?.rfc_message_id}>` },
    });

    const { body } = await deliver(receivedPayload(emailId));
    expect(body.threadId).toBe(outbound?.thread_id);
  });

  it("falls back to the subject when the reply carries no threading headers", async () => {
    const fixture = await newCandidate();
    const sent = await sendOutbound(fixture.applicationId, "Offer discussion");

    const { data: outbound } = await session.supabase
      .from("messages")
      .select("thread_id")
      .eq("id", sent.id)
      .single();

    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({
      emailId,
      from: fixture.email,
      subject: "Re: Offer discussion",
      headers: {},
    });

    const { body } = await deliver(receivedPayload(emailId));
    expect(body.threadId).toBe(outbound?.thread_id);
  });

  it("opens a new thread when nothing matches, rather than guessing", async () => {
    const fixture = await newCandidate();
    const sent = await sendOutbound(fixture.applicationId, "Interview invitation");

    const { data: outbound } = await session.supabase
      .from("messages")
      .select("thread_id")
      .eq("id", sent.id)
      .single();

    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({
      emailId,
      from: fixture.email,
      subject: "A completely unrelated question",
      headers: { "In-Reply-To": "<nothing-we-ever-sent@example.org>" },
    });

    const { body } = await deliver(receivedPayload(emailId));
    expect(body.threadId).not.toBe(outbound?.thread_id);
    expect(body.status).toBe("recorded");
  });

  it("refuses an In-Reply-To that points at another candidate's message", async () => {
    const amara = await newCandidate({ firstName: "Amara" });
    const theo = await newCandidate({ firstName: "Theo" });

    const sentToTheo = await sendOutbound(theo.applicationId, "Theo private thread");
    const { data: theoMessage } = await session.supabase
      .from("messages")
      .select("rfc_message_id, thread_id")
      .eq("id", sentToTheo.id)
      .single();

    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({
      emailId,
      from: amara.email,
      subject: "Re: Theo private thread",
      headers: { "In-Reply-To": `<${theoMessage?.rfc_message_id}>` },
    });

    const { body } = await deliver(receivedPayload(emailId));

    expect(body.status).toBe("recorded");
    expect(body.threadId).not.toBe(theoMessage?.thread_id);

    const { data: theoThread } = await session.supabase
      .from("messages")
      .select("id")
      .eq("thread_id", theoMessage?.thread_id as string);

    expect(theoThread).toHaveLength(1);
  });

  it("puts a later reply in the same thread as the first", async () => {
    const fixture = await newCandidate();
    await sendOutbound(fixture.applicationId, "Scheduling");

    const first = `email_${crypto.randomUUID()}`;
    const second = `email_${crypto.randomUUID()}`;
    queueInboundEmail({ emailId: first, from: fixture.email, subject: "Re: Scheduling" });
    queueInboundEmail({ emailId: second, from: fixture.email, subject: "RE: Scheduling" });

    const one = await deliver(receivedPayload(first));
    const two = await deliver(receivedPayload(second));

    expect(one.body.threadId).toBe(two.body.threadId);
  });

  it("marks the thread unread once a reply lands", async () => {
    const fixture = await newCandidate();
    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({ emailId, from: fixture.email, subject: "Question about the exercise" });

    const { body } = await deliver(receivedPayload(emailId));

    const { data: thread } = await session.supabase
      .from("message_threads")
      .select("last_inbound_at, read_at")
      .eq("id", body.threadId as string)
      .single();

    expect(thread?.last_inbound_at).not.toBeNull();
    expect(thread?.read_at).toBeNull();
  });
});

describe("POST /api/webhooks/resend/inbound — attachments", () => {
  it("stores an inbound attachment and records its path", async () => {
    const fixture = await newCandidate();
    const emailId = `email_${crypto.randomUUID()}`;

    queueInboundEmail({
      emailId,
      from: fixture.email,
      attachments: [{ id: "att_1", filename: "cv.pdf", contentType: "application/pdf", size: 12 }],
    });
    queueInboundAttachment(emailId, "att_1", {
      content: Buffer.from("a resume pdf"),
      contentType: "application/pdf",
      filename: "cv.pdf",
    });

    await deliver(receivedPayload(emailId));

    const messages = await messagesFor(fixture.personId);
    const attachments = messages[0]?.attachments as { path: string; filename: string }[];

    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.filename).toBe("cv.pdf");
    expect(attachments[0]?.path).toMatch(/^inbound\//);

    const stored = storedObject(MESSAGE_ATTACHMENT_BUCKET, attachments[0]?.path as string);
    expect(new TextDecoder().decode(stored?.bytes)).toBe("a resume pdf");
  });

  it("still records the message when an attachment cannot be stored", async () => {
    const fixture = await newCandidate();
    const emailId = `email_${crypto.randomUUID()}`;

    queueInboundEmail({
      emailId,
      from: fixture.email,
      text: "See attached.",
      attachments: [
        { id: "att_missing", filename: "broken.pdf", contentType: "application/pdf", size: 5 },
      ],
    });

    const { body } = await deliver(receivedPayload(emailId));
    expect(body.status).toBe("recorded");

    const { data } = await session.supabase
      .from("messages")
      .select("body, failure_reason, attachments")
      .eq("inbound_email_id", emailId)
      .single();

    expect(data?.body).toContain("See attached");
    expect(data?.failure_reason).toContain("broken.pdf");
    expect(data?.attachments).toEqual([]);
  });
});

describe("POST /api/webhooks/resend/inbound — the body that is stored", () => {
  it("stores the plain-text part, never the candidate's raw HTML", async () => {
    const fixture = await newCandidate();
    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({
      emailId,
      from: fixture.email,
      text: null,
      html: "<p>Hello <b>there</b></p><script>alert(1)</script>",
    });

    await deliver(receivedPayload(emailId));

    const messages = await messagesFor(fixture.personId);
    expect(messages[0]?.body).toBe("Hello there");
    expect(messages[0]?.body).not.toContain("<");
    expect(messages[0]?.body).not.toContain("alert");
  });
});
