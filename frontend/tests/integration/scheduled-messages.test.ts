import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

import { POST as sendMessage } from "@/app/api/messages/route";
import { POST as cancelMessage } from "@/app/api/messages/[id]/cancel/route";
import { runDueScheduledMessages } from "@/app/api/workers/scheduled-actions/_run-messages";
import type { Message, ScheduledMessageRunSummary } from "@/types/api";
import {
  currentCookies,
  jsonRequest,
  restoreSession,
  routeParams,
  seedCandidate,
  signInTestUser,
  type Fixture,
  type L3Session,
} from "./_harness";
import {
  lastSentEmail,
  makeTransportFail,
  resetTransport,
  sentEmails,
} from "./_email-transport-mock";
import { setServiceClient } from "./_service-client";

const ENDPOINT = "http://localhost:3000/api/messages";

const MINUTE = 60_000;

let session: L3Session;
let sessionCookies: { name: string; value: string }[];
const fixtures: Fixture[] = [];

async function newCandidate() {
  const fixture = await seedCandidate(session.supabase);
  fixtures.push(fixture);
  return fixture;
}

async function schedule(
  fixture: Fixture,
  overrides: Record<string, unknown> = {},
): Promise<Message> {
  const response = await sendMessage(
    jsonRequest(ENDPOINT, "POST", {
      applicationId: fixture.applicationId,
      subject: "Interview with {{candidate.first_name}}",
      body: "Hi {{candidate.first_name}}, we would like to meet.",
      scheduledFor: new Date(Date.now() + 30 * MINUTE).toISOString(),
      ...overrides,
    }),
  );

  const body = (await response.json()) as { message?: Message; error?: string };
  if (!body.message) throw new Error(`schedule: ${response.status} ${body.error}`);
  return body.message;
}

async function cancel(messageId: string) {
  const response = await cancelMessage(
    jsonRequest(`${ENDPOINT}/${messageId}/cancel`, "POST", {}),
    routeParams({ id: messageId }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function messageRow(id: string) {
  const { data } = await session.supabase
    .from("messages")
    .select(
      "id, status, scheduled_for, sent_at, send_claimed_at, cancelled_at, failure_reason, relay_message_id, rfc_message_id, from_address, thread_id",
    )
    .eq("id", id)
    .single();

  if (!data) throw new Error(`no message row for ${id}`);
  return data;
}

async function makeDue(id: string) {
  const { error } = await session.supabase
    .from("messages")
    .update({ scheduled_for: new Date(Date.now() - MINUTE).toISOString() })
    .eq("id", id);

  expect(error).toBeNull();
}

async function drain(): Promise<ScheduledMessageRunSummary> {
  return runDueScheduledMessages(session.supabase, { now: new Date() });
}

beforeAll(async () => {
  session = await signInTestUser();
  sessionCookies = currentCookies();
  setServiceClient(session.supabase);
});

beforeEach(() => {
  resetTransport();
});

afterEach(() => {
  restoreSession(sessionCookies);
});

afterAll(async () => {
  restoreSession(sessionCookies);
  for (const fixture of fixtures) await fixture.cleanup();
});

describe("a queued message is composed, unclaimed and attached to a thread", () => {
  it("resolves merge variables at compose time, so the row the worker sends is final", async () => {
    const fixture = await newCandidate();
    const message = await schedule(fixture);

    expect(message.status).toBe("scheduled");
    expect(message.subject).toBe("Interview with Amara");
    expect(message.body).toContain("Hi Amara");
    expect(sentEmails()).toHaveLength(0);

    const row = await messageRow(message.id);
    expect(row.sent_at).toBeNull();
    expect(row.send_claimed_at).toBeNull();
    expect(row.cancelled_at).toBeNull();
    expect(row.thread_id).not.toBeNull();
  });
});

describe("the worker drains due messages and leaves the rest alone", () => {
  it("sends a due message through the one real send path and settles the row", async () => {
    const fixture = await newCandidate();
    const message = await schedule(fixture);
    await makeDue(message.id);

    const summary = await drain();
    expect(summary.sent).toBeGreaterThanOrEqual(1);

    const email = lastSentEmail();
    expect(email?.to).toBe(fixture.email);
    expect(email?.subject).toBe("Interview with Amara");
    expect(email?.text).toContain("Hi Amara");

    const row = await messageRow(message.id);
    expect(row.status).toBe("sent");
    expect(row.scheduled_for).toBeNull();
    expect(row.sent_at).not.toBeNull();
    expect(row.send_claimed_at).not.toBeNull();
    expect(row.relay_message_id).not.toBeNull();
    expect(row.rfc_message_id).not.toBeNull();
    expect(row.failure_reason).toBeNull();
  });

  it("leaves a message that is not yet due exactly where it is", async () => {
    const fixture = await newCandidate();
    const message = await schedule(fixture);

    await drain();

    expect(sentEmails()).toHaveLength(0);
    const row = await messageRow(message.id);
    expect(row.status).toBe("scheduled");
    expect(row.send_claimed_at).toBeNull();
  });

  it("does not send the same message twice when the worker runs again", async () => {
    const fixture = await newCandidate();
    const message = await schedule(fixture);
    await makeDue(message.id);

    await drain();
    const after = sentEmails().length;
    expect(after).toBe(1);

    await drain();
    await drain();

    expect(sentEmails()).toHaveLength(after);
    expect((await messageRow(message.id)).status).toBe("sent");
  });

  it("bumps the thread so a scheduled reply lands in the Inbox when it actually goes out", async () => {
    const fixture = await newCandidate();
    const message = await schedule(fixture);

    const before = await threadLastMessageAt(message.threadId);
    await makeDue(message.id);
    await drain();
    const after = await threadLastMessageAt(message.threadId);

    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });
});

describe("a failed scheduled send is durable and inspectable", () => {
  it("records the relay's rejection on the message row rather than retrying", async () => {
    const fixture = await newCandidate();
    const message = await schedule(fixture);
    await makeDue(message.id);

    makeTransportFail("the relay is unreachable");

    const summary = await drain();
    expect(summary.failed).toBeGreaterThanOrEqual(1);

    const row = await messageRow(message.id);
    expect(row.status).toBe("failed");
    expect(row.failure_reason).toContain("the relay is unreachable");
    expect(row.scheduled_for).toBeNull();
    expect(row.sent_at).toBeNull();
  });

  it("does not pick a failed message back up on the next run", async () => {
    const fixture = await newCandidate();
    const message = await schedule(fixture);
    await makeDue(message.id);

    makeTransportFail("the relay is unreachable");
    await drain();

    resetTransport();
    const summary = await drain();

    expect(summary.claimed).toBe(0);
    expect(sentEmails()).toHaveLength(0);
    expect((await messageRow(message.id)).status).toBe("failed");
  });
});

describe("a scheduled send can be cancelled before it goes out", () => {
  it("cancels a scheduled message and the worker then never sends it", async () => {
    const fixture = await newCandidate();
    const message = await schedule(fixture);

    const cancelled = await cancel(message.id);
    expect(cancelled.status).toBe(200);
    expect((cancelled.body.message as Message).status).toBe("cancelled");

    await makeDue(message.id);
    const summary = await drain();

    expect(summary.claimed).toBe(0);
    expect(sentEmails()).toHaveLength(0);

    const row = await messageRow(message.id);
    expect(row.status).toBe("cancelled");
    expect(row.cancelled_at).not.toBeNull();
  });

  it("refuses a second cancel with 409 rather than pretending it worked", async () => {
    const fixture = await newCandidate();
    const message = await schedule(fixture);

    expect((await cancel(message.id)).status).toBe(200);

    const second = await cancel(message.id);
    expect(second.status).toBe(409);
    expect(String(second.body.error)).toContain("already cancelled");
  });

  it("refuses to cancel a message that has already been sent", async () => {
    const fixture = await newCandidate();
    const message = await schedule(fixture);
    await makeDue(message.id);
    await drain();

    const refused = await cancel(message.id);
    expect(refused.status).toBe(409);
    expect((await messageRow(message.id)).status).toBe("sent");
  });

  it("answers 404 for a message that does not exist", async () => {
    const missing = await cancel(crypto.randomUUID());
    expect(missing.status).toBe(404);
  });

  it("answers 422 for something that is not a message id", async () => {
    const response = await cancelMessage(
      jsonRequest(`${ENDPOINT}/not-a-uuid/cancel`, "POST", {}),
      routeParams({ id: "not-a-uuid" }),
    );
    expect(response.status).toBe(422);
  });
});

async function threadLastMessageAt(threadId: string | null): Promise<string> {
  const { data } = await session.supabase
    .from("message_threads")
    .select("last_message_at")
    .eq("id", threadId as string)
    .single();

  if (!data) throw new Error(`no thread ${threadId}`);
  return data.last_message_at;
}
