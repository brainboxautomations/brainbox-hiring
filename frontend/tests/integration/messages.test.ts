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

import { POST as sendMessage, GET as listMessages } from "@/app/api/messages/route";
import type { Message } from "@/types/api";
import {
  currentCookies,
  getRequest,
  jsonRequest,
  multipartRequest,
  restoreSession,
  seedCandidate,
  signInTestUser,
  signOutForRequest,
  type Fixture,
  type L3Session,
} from "./_harness";
import {
  lastSentEmail,
  makeTransportFail,
  resetTransport,
  sentEmails,
} from "./_email-transport-mock";
import { storedObject } from "./_object-storage-mock";

const ENDPOINT = "http://localhost:3000/api/messages";

let session: L3Session;
let sessionCookies: { name: string; value: string }[];
const fixtures: Fixture[] = [];

async function newCandidate(overrides: Parameters<typeof seedCandidate>[1] = {}) {
  const fixture = await seedCandidate(session.supabase, overrides);
  fixtures.push(fixture);
  return fixture;
}

async function post(payload: unknown, files: File[] = []) {
  const response = await sendMessage(multipartRequest(ENDPOINT, payload, files));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function postJson(payload: unknown) {
  const response = await sendMessage(jsonRequest(ENDPOINT, "POST", payload));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  session = await signInTestUser();
  sessionCookies = currentCookies();
});

afterEach(() => {
  restoreSession(sessionCookies);
  resetTransport();
});

afterAll(async () => {
  restoreSession(sessionCookies);
  for (const fixture of fixtures) await fixture.cleanup();
});

describe("POST /api/messages — the auth gate", () => {
  it("answers 401 as JSON when there is no session, never a redirect", async () => {
    signOutForRequest();
    const response = await sendMessage(jsonRequest(ENDPOINT, "POST", {}));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("sends nothing when the caller is not signed in", async () => {
    signOutForRequest();
    await sendMessage(jsonRequest(ENDPOINT, "POST", { subject: "hi", body: "hi" }));
    expect(sentEmails()).toHaveLength(0);
  });
});

describe("POST /api/messages — validation", () => {
  it("rejects a body with neither applicationId nor personId", async () => {
    const { status, body } = await postJson({ subject: "Hello", body: "Hi there" });
    expect(status).toBe(422);
    expect(String(body.error)).toContain("applicationId");
  });

  it("rejects an empty subject", async () => {
    const fixture = await newCandidate();
    const { status } = await postJson({
      applicationId: fixture.applicationId,
      subject: "   ",
      body: "Hi",
    });
    expect(status).toBe(422);
  });

  it("rejects an empty body", async () => {
    const fixture = await newCandidate();
    const { status } = await postJson({
      applicationId: fixture.applicationId,
      subject: "Hello",
      body: "",
    });
    expect(status).toBe(422);
  });

  it("rejects a malformed cc address rather than handing it to the relay", async () => {
    const fixture = await newCandidate();
    const { status } = await postJson({
      applicationId: fixture.applicationId,
      subject: "Hello",
      body: "Hi",
      cc: ["not-an-address"],
    });
    expect(status).toBe(422);
    expect(sentEmails()).toHaveLength(0);
  });

  it("404s for an application that does not exist", async () => {
    const { status } = await postJson({
      applicationId: crypto.randomUUID(),
      subject: "Hello",
      body: "Hi",
    });
    expect(status).toBe(404);
  });
});

describe("POST /api/messages — an immediate send", () => {
  it("sends through the relay and records the message", async () => {
    const fixture = await newCandidate();

    const { status, body } = await post({
      applicationId: fixture.applicationId,
      subject: "Your interview at {{company.name}}",
      body: "Hi {{candidate.first_name}},\n\nAbout the {{position.title}} role.\n\n{{sender.name}}",
    });

    expect(status).toBe(201);
    const message = body.message as Message;

    expect(message.status).toBe("sent");
    expect(message.direction).toBe("outbound");
    expect(message.relayMessageId).toMatch(/^fake-/);
    expect(message.sentAt).not.toBeNull();
    expect(message.scheduledFor).toBeNull();
    expect(message.toAddress).toBe(fixture.email);
    expect(message.personId).toBe(fixture.personId);
    expect(message.applicationId).toBe(fixture.applicationId);

    const delivered = lastSentEmail();
    expect(delivered?.to).toBe(fixture.email);
    expect(delivered?.subject).toBe("Your interview at Acme Inc.");
    expect(delivered?.html).toContain("Hi Amara,");
    expect(delivered?.html).toContain("Senior Frontend Engineer");
  });

  it("persists the row so it survives the request", async () => {
    const fixture = await newCandidate();
    await post({ applicationId: fixture.applicationId, subject: "Hello", body: "Hi" });

    const { data } = await session.supabase
      .from("messages")
      .select("id, status, direction, relay_message_id, sender_user_id")
      .eq("person_id", fixture.personId);

    expect(data).toHaveLength(1);
    expect(data?.[0]?.status).toBe("sent");
    expect(data?.[0]?.sender_user_id).toBe(session.userId);
  });

  it("carries cc and bcc through to the relay and onto the row", async () => {
    const fixture = await newCandidate();
    const { body } = await post({
      applicationId: fixture.applicationId,
      subject: "Hello",
      body: "Hi",
      cc: ["Hiring.Manager@Example.com", "hiring.manager@example.com"],
      bcc: ["archive@example.com"],
    });

    const message = body.message as Message;
    expect(message.cc).toEqual(["Hiring.Manager@example.com"]);
    expect(message.bcc).toEqual(["archive@example.com"]);
    expect(lastSentEmail()?.cc).toEqual(["Hiring.Manager@example.com"]);
    expect(lastSentEmail()?.bcc).toEqual(["archive@example.com"]);
  });

  it("stores the resolved body, not the template, so the thread shows what was received", async () => {
    const fixture = await newCandidate({ firstName: "Priya" });
    const { body } = await post({
      applicationId: fixture.applicationId,
      subject: "Hello {{candidate.first_name}}",
      body: "Hi {{candidate.first_name}}",
    });

    const message = body.message as Message;
    expect(message.subject).toBe("Hello Priya");
    expect(message.body).toContain("Hi Priya");
    expect(message.body).not.toContain("{{");
  });

  it("never leaves a raw merge token in what the candidate receives", async () => {
    const fixture = await newCandidate({ phone: null, customAttributes: {} });
    await post({
      applicationId: fixture.applicationId,
      subject: "Call {{candidate.phone}} about {{custom.nothing_here}}",
      body: "Hi {{candidate.first_name}}, your notice is {{custom.notice_period}}.",
    });

    const delivered = lastSentEmail();
    expect(delivered?.subject).not.toMatch(/\{\{|\}\}/);
    expect(delivered?.html).not.toMatch(/\{\{|\}\}/);
    expect(delivered?.text).not.toMatch(/\{\{|\}\}/);
  });

  it("uses the logged-in user as the display sender, not the position's sender name", async () => {
    const fixture = await newCandidate({ emailSenderName: "Acme Talent" });
    await post({ applicationId: fixture.applicationId, subject: "Hello", body: "Hi" });

    const { data: profile } = await session.supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", session.userId)
      .single();

    const expected =
      profile?.full_name?.trim() || (profile?.email ?? "").split("@")[0] || "Acme Inc.";
    expect(lastSentEmail()?.senderDisplayName).toBe(expected);
    expect(lastSentEmail()?.senderDisplayName).not.toBe("Acme Talent");
  });

  it("escapes markup that arrives through a candidate-controlled merge value", async () => {
    const fixture = await newCandidate({
      customAttributes: { note: "<script>alert(1)</script>" },
    });
    await post({
      applicationId: fixture.applicationId,
      subject: "Hello",
      body: "Note: {{custom.note}}",
    });

    expect(lastSentEmail()?.html).toContain("&lt;script&gt;");
    expect(lastSentEmail()?.html).not.toContain("<script>");
  });

  it("attaches an uploaded file and records its storage path", async () => {
    const fixture = await newCandidate();
    const file = new File(["interview brief"], "interview brief.pdf", {
      type: "application/pdf",
    });

    const { status, body } = await post(
      { applicationId: fixture.applicationId, subject: "Hello", body: "Hi" },
      [file],
    );

    expect(status).toBe(201);
    const message = body.message as Message;
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]?.path).toMatch(
      new RegExp(`^outbound/${session.userId}/[0-9a-f-]{36}-interview_brief\\.pdf$`),
    );

    const delivered = lastSentEmail();
    expect(delivered?.attachments).toHaveLength(1);
    expect(delivered?.attachments[0]?.content.toString()).toBe("interview brief");

    expect(
      storedObject("message-attachments", message.attachments[0]?.path as string),
    ).toBeDefined();
  });
});

describe("POST /api/messages — when the relay refuses", () => {
  it("answers 502 and records a failed message rather than losing it", async () => {
    const fixture = await newCandidate();
    makeTransportFail("the mail relay didn't respond");

    const { status, body } = await post({
      applicationId: fixture.applicationId,
      subject: "Hello",
      body: "Hi",
    });

    expect(status).toBe(502);
    expect(String(body.error)).toContain("relay");

    const { data } = await session.supabase
      .from("messages")
      .select("status, failure_reason, sent_at, relay_message_id")
      .eq("person_id", fixture.personId)
      .single();

    expect(data?.status).toBe("failed");
    expect(data?.failure_reason).toContain("relay");
    expect(data?.sent_at).toBeNull();
    expect(data?.relay_message_id).toBeNull();
  });
});

describe("POST /api/messages — scheduled send", () => {
  it("persists a pending row and does NOT call the relay", async () => {
    const fixture = await newCandidate();
    const when = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const { status, body } = await post({
      applicationId: fixture.applicationId,
      subject: "Hello {{candidate.first_name}}",
      body: "Hi",
      scheduledFor: when,
    });

    expect(status).toBe(201);
    const message = body.message as Message;
    expect(message.status).toBe("scheduled");
    expect(message.scheduledFor).not.toBeNull();
    expect(message.sentAt).toBeNull();
    expect(message.relayMessageId).toBeNull();
    expect(sentEmails()).toHaveLength(0);
  });

  it("leaves the scheduled row where the worker will find it", async () => {
    const fixture = await newCandidate();
    const when = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await post({
      applicationId: fixture.applicationId,
      subject: "Hello",
      body: "Hi",
      scheduledFor: when,
    });

    const { data } = await session.supabase
      .from("messages")
      .select("id, scheduled_for")
      .eq("person_id", fixture.personId)
      .eq("direction", "outbound")
      .eq("status", "scheduled")
      .lte("scheduled_for", new Date(Date.now() + 10 * 60 * 1000).toISOString());

    expect(data).toHaveLength(1);
  });

  it("sends immediately when the requested time has already passed", async () => {
    const fixture = await newCandidate();
    const { body } = await post({
      applicationId: fixture.applicationId,
      subject: "Hello",
      body: "Hi",
      scheduledFor: new Date(Date.now() - 60_000).toISOString(),
    });

    expect((body.message as Message).status).toBe("sent");
    expect(sentEmails()).toHaveLength(1);
  });

  it("refuses a send scheduled beyond the horizon", async () => {
    const fixture = await newCandidate();
    const { status } = await postJson({
      applicationId: fixture.applicationId,
      subject: "Hello",
      body: "Hi",
      scheduledFor: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(status).toBe(422);
  });
});

describe("GET /api/messages", () => {
  it("requires a session", async () => {
    signOutForRequest();
    const response = await listMessages(getRequest(`${ENDPOINT}?personId=${crypto.randomUUID()}`));
    expect(response.status).toBe(401);
  });

  it("returns the messages for a person, newest first", async () => {
    const fixture = await newCandidate();
    await post({ applicationId: fixture.applicationId, subject: "First", body: "one" });
    await post({ applicationId: fixture.applicationId, subject: "Second", body: "two" });

    const response = await listMessages(getRequest(`${ENDPOINT}?personId=${fixture.personId}`));

    expect(response.status).toBe(200);
    const { messages } = (await response.json()) as { messages: Message[] };
    expect(messages.map((m) => m.subject)).toEqual(["Second", "First"]);
  });
});
