import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const { cookieJar } = await import("./_cookie-jar");
  return { cookies: async () => cookieJar };
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

import { GET as listThreads } from "@/app/api/threads/route";
import { GET as getThread, PATCH as patchThread } from "@/app/api/threads/[threadId]/route";
import { GET as listUnmatched } from "@/app/api/threads/unmatched/route";
import { POST as sendMessage } from "@/app/api/messages/route";
import { POST as receiveWebhook } from "@/app/api/webhooks/resend/inbound/route";
import type { MessageThread, MessageThreadDetail, UnmatchedInboundEmail } from "@/types/api";
import { signPayload } from "@/utilities/webhook-signature";
import {
  currentCookies,
  getRequest,
  jsonRequest,
  multipartRequest,
  restoreSession,
  routeParams,
  seedCandidate,
  signInTestUser,
  signOutForRequest,
  type Fixture,
  type L3Session,
} from "./_harness";
import { lastSentEmail, queueInboundEmail, resetTransport } from "./_email-transport-mock";
import { setServiceClient } from "./_service-client";

const THREADS_URL = "http://localhost:3000/api/threads";
const MESSAGES_URL = "http://localhost:3000/api/messages";
const WEBHOOK_URL = "http://localhost:3000/api/webhooks/resend/inbound";
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

async function sendOutbound(payload: Record<string, unknown>) {
  const response = await sendMessage(multipartRequest(MESSAGES_URL, payload));
  const json = (await response.json()) as { message?: { id: string; threadId: string } };
  return { status: response.status, message: json.message };
}

async function deliverInbound(emailId: string) {
  const payload = JSON.stringify({ type: "email.received", data: { email_id: emailId } });
  const id = `msg_${crypto.randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));

  const request = new NextRequest(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${await signPayload(SECRET, id, timestamp, payload)}`,
    },
    body: payload,
  });

  const response = await receiveWebhook(request);
  return (await response.json()) as Record<string, unknown>;
}

async function threadsFor(query = "") {
  const response = await listThreads(getRequest(`${THREADS_URL}${query}`));
  const json = (await response.json()) as { threads: MessageThread[] };
  return { status: response.status, threads: json.threads };
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

describe("GET /api/threads", () => {
  it("requires a session", async () => {
    signOutForRequest();
    const response = await listThreads(getRequest(THREADS_URL));
    expect(response.status).toBe(401);
  });

  it("opens a thread as soon as the first email is sent", async () => {
    const fixture = await newCandidate();
    await sendOutbound({
      applicationId: fixture.applicationId,
      subject: "Your application",
      body: "Hi there",
    });

    const { threads } = await threadsFor(`?personId=${fixture.personId}`);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.subject).toBe("Your application");
    expect(threads[0]?.personEmail).toBe(fixture.email);
    expect(threads[0]?.unread).toBe(false);
  });

  it("carries the position and stage context the Inbox side panel needs", async () => {
    const fixture = await newCandidate({ positionTitle: "Staff Platform Engineer" });
    await sendOutbound({
      applicationId: fixture.applicationId,
      subject: "Context check",
      body: "Hi",
    });

    const { threads } = await threadsFor(`?personId=${fixture.personId}`);
    expect(threads[0]?.positionTitle).toBe("Staff Platform Engineer");
    expect(threads[0]?.positionId).toBe(fixture.positionId);
    expect(threads[0]?.applicationId).toBe(fixture.applicationId);
  });

  it("scopes to one position when asked", async () => {
    const mine = await newCandidate({ positionTitle: "Scoped role" });
    const other = await newCandidate({ positionTitle: "Another role" });

    await sendOutbound({ applicationId: mine.applicationId, subject: "Scoped", body: "Hi" });
    await sendOutbound({ applicationId: other.applicationId, subject: "Unscoped", body: "Hi" });

    const { threads } = await threadsFor(`?positionId=${mine.positionId}`);
    expect(threads.map((thread) => thread.personId)).toEqual([mine.personId]);
  });

  it("lists most-recent-first across positions", async () => {
    const first = await newCandidate();
    const second = await newCandidate();

    await sendOutbound({ applicationId: first.applicationId, subject: "Older", body: "Hi" });
    await sendOutbound({ applicationId: second.applicationId, subject: "Newer", body: "Hi" });

    const { threads } = await threadsFor();
    const ordered = threads.filter((thread) =>
      [first.personId, second.personId].includes(thread.personId),
    );

    expect(ordered.map((thread) => thread.personId)).toEqual([second.personId, first.personId]);
  });

  it("shows an inbound reply as unread, and only unread threads when filtered", async () => {
    const fixture = await newCandidate();
    await sendOutbound({ applicationId: fixture.applicationId, subject: "Ping", body: "Hi" });

    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({ emailId, from: fixture.email, subject: "Re: Ping", text: "Pong" });
    await deliverInbound(emailId);

    const all = await threadsFor(`?personId=${fixture.personId}`);
    expect(all.threads[0]?.unread).toBe(true);
    expect(all.threads[0]?.preview).toBe("Pong");

    const unread = await threadsFor(`?personId=${fixture.personId}&unread=true`);
    expect(unread.threads).toHaveLength(1);
  });
});

describe("GET /api/threads/[threadId]", () => {
  it("returns the two-way history in order", async () => {
    const fixture = await newCandidate();
    const sent = await sendOutbound({
      applicationId: fixture.applicationId,
      subject: "Two way",
      body: "Our message",
    });

    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({
      emailId,
      from: fixture.email,
      subject: "Re: Two way",
      text: "Their reply",
    });
    await deliverInbound(emailId);

    const response = await getThread(
      getRequest(`${THREADS_URL}/${sent.message?.threadId}`),
      routeParams({ threadId: sent.message?.threadId as string }),
    );

    expect(response.status).toBe(200);
    const { thread } = (await response.json()) as { thread: MessageThreadDetail };

    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[0]?.direction).toBe("outbound");
    expect(thread.messages[1]?.direction).toBe("inbound");
    expect(thread.messages[1]?.body).toBe("Their reply");
  });

  it("404s for a thread that does not exist", async () => {
    const id = crypto.randomUUID();
    const response = await getThread(
      getRequest(`${THREADS_URL}/${id}`),
      routeParams({ threadId: id }),
    );
    expect(response.status).toBe(404);
  });

  it("marks a thread read", async () => {
    const fixture = await newCandidate();
    await sendOutbound({ applicationId: fixture.applicationId, subject: "Read me", body: "Hi" });

    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({ emailId, from: fixture.email, subject: "Re: Read me" });
    const outcome = await deliverInbound(emailId);
    const threadId = outcome.threadId as string;

    const response = await patchThread(
      jsonRequest(`${THREADS_URL}/${threadId}`, "PATCH", { read: true }),
      routeParams({ threadId }),
    );
    expect(response.status).toBe(200);

    const { threads } = await threadsFor(`?personId=${fixture.personId}`);
    expect(threads[0]?.unread).toBe(false);
  });

  it("rejects a patch body that is not a read flag", async () => {
    const fixture = await newCandidate();
    const sent = await sendOutbound({
      applicationId: fixture.applicationId,
      subject: "Bad patch",
      body: "Hi",
    });

    const threadId = sent.message?.threadId as string;
    const response = await patchThread(
      jsonRequest(`${THREADS_URL}/${threadId}`, "PATCH", { read: "yes" }),
      routeParams({ threadId }),
    );
    expect(response.status).toBe(422);
  });
});

describe("replying from the Inbox goes through the one send path", () => {
  it("keeps the reply in the same thread and quotes the parent Message-ID", async () => {
    const fixture = await newCandidate();
    const opening = await sendOutbound({
      applicationId: fixture.applicationId,
      subject: "Reply flow",
      body: "Hi",
    });
    const threadId = opening.message?.threadId as string;

    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({ emailId, from: fixture.email, subject: "Re: Reply flow", text: "Hello" });
    await deliverInbound(emailId);

    const reply = await sendOutbound({
      applicationId: fixture.applicationId,
      threadId,
      subject: "Re: Reply flow",
      body: "Answering you",
    });

    expect(reply.status).toBe(201);
    expect(reply.message?.threadId).toBe(threadId);

    const { data: inbound } = await session.supabase
      .from("messages")
      .select("rfc_message_id")
      .eq("inbound_email_id", emailId)
      .single();

    expect(lastSentEmail()?.inReplyTo).toBe(inbound?.rfc_message_id);
    expect(lastSentEmail()?.references?.length).toBeGreaterThan(0);
  });
});

describe("GET /api/threads/unmatched", () => {
  it("requires a session", async () => {
    signOutForRequest();
    const response = await listUnmatched();
    expect(response.status).toBe(401);
  });

  it("surfaces quarantined mail so nothing is silently dropped", async () => {
    const emailId = `email_${crypto.randomUUID()}`;
    const from = `nobody-${crypto.randomUUID()}@example.com`;
    queueInboundEmail({ emailId, from, subject: "Who am I", text: "A stranger writes." });
    await deliverInbound(emailId);

    const { data } = await session.supabase
      .from("unmatched_inbound_emails")
      .select("id")
      .eq("relay_email_id", emailId)
      .single();
    if (data?.id) unmatchedIds.push(data.id);

    const response = await listUnmatched();
    const { emails } = (await response.json()) as { emails: UnmatchedInboundEmail[] };
    const mine = emails.find((email) => email.fromAddress === from);

    expect(mine?.subject).toBe("Who am I");
    expect(mine?.reason).toBe("no_matching_person");
    expect(mine?.preview).toContain("stranger");
  });
});
