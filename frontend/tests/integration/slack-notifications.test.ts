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

vi.mock("@/configurations/slack-transport", async () => {
  const { fakeSlackTransport, FakeSlackPostError } = await import("./_slack-transport-mock");
  return {
    SlackPostError: FakeSlackPostError,
    getSlackTransport: () => fakeSlackTransport,
  };
});

vi.mock("@/configurations/slack-delivery-config", async () => {
  const { fakeReadSlackDeliveryConfig } = await import("./_slack-config-mock");
  return { readSlackDeliveryConfig: fakeReadSlackDeliveryConfig };
});

vi.mock("@/configurations/supabase-service-configuration", async () => {
  const { getServiceClient } = await import("./_service-client");
  return {
    MissingServiceRoleKeyError: class MissingServiceRoleKeyError extends Error {},
    createSupabaseServiceClient: () => getServiceClient(),
  };
});

import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { POST as receiveWebhook } from "@/app/api/webhooks/resend/inbound/route";
import { SLACK_POST_TIMEOUT_MS } from "@/app/api/webhooks/resend/inbound/_slack-notifier";
import type { Database } from "@/types/database.types";
import { signPayload } from "@/utilities/webhook-signature";
import {
  currentCookies,
  restoreSession,
  seedCandidate,
  signInTestUser,
  type Fixture,
  type L3Session,
} from "./_harness";
import { queueInboundEmail, resetTransport } from "./_email-transport-mock";
import {
  FAKE_BOT_TOKEN,
  FAKE_CHANNEL_ID,
  makeSlackConfigUnreadable,
  makeSlackSwitchedOff,
  resetSlackDeliveryConfig,
} from "./_slack-config-mock";
import {
  lastSlackPost,
  makeSlackAnswerWithStatus,
  makeSlackNeverAnswer,
  makeSlackReject,
  resetSlackTransport,
  slackPosts,
} from "./_slack-transport-mock";
import { setServiceClient } from "./_service-client";
import { serviceRoleClient } from "./_service-role-client";

const WEBHOOK_URL = "http://localhost:3000/api/webhooks/resend/inbound";
const SECRET = "whsec_bDMtaW5ib3VuZC13ZWJob29rLXNlY3JldC1ub3QtYS1yZWFsLW9uZQ==";

let session: L3Session;
let serviceRole: SupabaseClient<Database>;
let sessionCookies: { name: string; value: string }[];
const fixtures: Fixture[] = [];

async function newCandidate(overrides: Parameters<typeof seedCandidate>[1] = {}) {
  const fixture = await seedCandidate(session.supabase, overrides);
  fixtures.push(fixture);
  return fixture;
}

function receivedPayload(emailId: string) {
  return JSON.stringify({
    type: "email.received",
    created_at: new Date().toISOString(),
    data: { email_id: emailId },
  });
}

async function deliver(payload: string) {
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
      body: payload,
    }),
  );

  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function deliverReplyFrom(
  fixture: Fixture,
  overrides: { subject?: string; text?: string } = {},
) {
  const emailId = `email_${crypto.randomUUID()}`;
  queueInboundEmail({
    emailId,
    from: fixture.email,
    subject: overrides.subject ?? "Re: Your interview at Acme",
    text: overrides.text ?? "Thursday afternoon works well for me.",
  });

  return deliver(receivedPayload(emailId));
}

async function messagesFor(personId: string) {
  const { data } = await session.supabase
    .from("messages")
    .select("id, direction, body, subject, thread_id")
    .eq("person_id", personId);
  return data ?? [];
}

async function ledgerFor(messageId: string) {
  const { data } = await session.supabase
    .from("slack_notifications")
    .select("id, status, detail, channel_id, slack_message_ts")
    .eq("message_id", messageId)
    .maybeSingle();
  return data;
}

beforeAll(async () => {
  session = await signInTestUser();
  sessionCookies = currentCookies();
  serviceRole = serviceRoleClient();
  setServiceClient(serviceRole);
});

afterEach(() => {
  restoreSession(sessionCookies);
  resetTransport();
  resetSlackTransport();
  resetSlackDeliveryConfig();
});

afterAll(async () => {
  restoreSession(sessionCookies);
  for (const fixture of fixtures) await fixture.cleanup();
});

describe("slack_delivery_config — the one exit the bot token has", () => {
  it("resolves the live configuration for the service role without being written to", async () => {
    const { readSlackDeliveryConfig } = await vi.importActual<
      typeof import("@/configurations/slack-delivery-config")
    >("@/configurations/slack-delivery-config");

    const result = await readSlackDeliveryConfig(serviceRole);

    expect(result.kind).toBe("config");
    if (result.kind !== "config") return;

    expect(typeof result.config.enabled).toBe("boolean");
    expect(["string", "object"]).toContain(typeof result.config.channelId);
    expect(["string", "object"]).toContain(typeof result.config.botToken);
    expect(result.config.enabled).toBe(
      result.config.channelId !== null && result.config.botToken !== null && result.config.enabled,
    );
  });

  it("is not callable by a signed-in user, so a browser session can never read the token", async () => {
    const { readSlackDeliveryConfig } = await vi.importActual<
      typeof import("@/configurations/slack-delivery-config")
    >("@/configurations/slack-delivery-config");

    const result = await readSlackDeliveryConfig(session.supabase);
    expect(result.kind).toBe("error");
  });
});

describe("an inbound candidate email reaches Slack (SLK-1)", () => {
  it("posts to the configured channel and records the delivery", async () => {
    const fixture = await newCandidate();
    const { status, body } = await deliverReplyFrom(fixture);

    expect(status).toBe(200);
    expect(body.status).toBe("recorded");
    expect(body.slack).toBe("delivered");

    const post = lastSlackPost();
    expect(post?.message.channelId).toBe(FAKE_CHANNEL_ID);
    expect(post?.token).toBe(FAKE_BOT_TOKEN);
    // The notification line names who replied and quotes the reply; the
    // subject sits in the structured blocks underneath, not the summary.
    expect(post?.message.text).toContain("Amara Okafor");
    expect(post?.message.text).toContain("Thursday afternoon works well for me.");
    expect(post?.message.text).toContain("Senior Frontend Engineer");

    const rendered = JSON.stringify(post?.message.blocks ?? []);
    expect(rendered).toContain("Amara Okafor");
    expect(rendered).toContain("Re: Your interview at Acme");
    expect(rendered).toContain("Thursday afternoon works well for me.");

    const ledger = await ledgerFor(body.messageId as string);
    expect(ledger?.status).toBe("delivered");
    expect(ledger?.channel_id).toBe(FAKE_CHANNEL_ID);
    expect(ledger?.slack_message_ts).not.toBeNull();
    expect(ledger?.detail).toBeNull();
  });

  it("writes exactly one ledger row even when Resend retries the same delivery", async () => {
    const fixture = await newCandidate();
    const emailId = `email_${crypto.randomUUID()}`;
    queueInboundEmail({ emailId, from: fixture.email });

    const payload = receivedPayload(emailId);
    const first = await deliver(payload);
    const second = await deliver(payload);

    expect(first.body.status).toBe("recorded");
    expect(second.body.status).toBe("duplicate");
    expect(slackPosts()).toHaveLength(1);
  });

  it("posts nothing at all when notifications are switched off (SLK-2)", async () => {
    makeSlackSwitchedOff();
    const fixture = await newCandidate();
    const { status, body } = await deliverReplyFrom(fixture);

    expect(status).toBe(200);
    expect(body.slack).toBe("skipped");
    expect(slackPosts()).toHaveLength(0);

    const ledger = await ledgerFor(body.messageId as string);
    expect(ledger?.status).toBe("skipped");
  });

  it("never puts the bot token in the webhook response", async () => {
    const fixture = await newCandidate();
    const { body } = await deliverReplyFrom(fixture);
    expect(JSON.stringify(body)).not.toContain("xoxb-");
  });
});

describe("a Slack failure never costs us a candidate email", () => {
  it("records the email and answers Resend 200 when the Slack call rejects", async () => {
    makeSlackReject("getaddrinfo ENOTFOUND slack.com");

    const fixture = await newCandidate();
    const { status, body } = await deliverReplyFrom(fixture, { text: "Rejected promise path." });

    expect(status).toBe(200);
    expect(body.status).toBe("recorded");
    expect(body.slack).toBe("failed");

    const messages = await messagesFor(fixture.personId);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.body).toContain("Rejected promise path");

    const ledger = await ledgerFor(body.messageId as string);
    expect(ledger?.status).toBe("failed");
    expect(ledger?.detail).toContain("ENOTFOUND");
  });

  it("records the email and answers Resend 200 when Slack answers a non-2xx", async () => {
    makeSlackAnswerWithStatus(503);

    const fixture = await newCandidate();
    const { status, body } = await deliverReplyFrom(fixture, { text: "Non-2xx path." });

    expect(status).toBe(200);
    expect(body.status).toBe("recorded");
    expect(body.slack).toBe("failed");

    const messages = await messagesFor(fixture.personId);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.body).toContain("Non-2xx path");

    const ledger = await ledgerFor(body.messageId as string);
    expect(ledger?.status).toBe("failed");
    expect(ledger?.detail).toContain("503");
  });

  it("records the email and answers Resend 200 when Slack never answers at all", async () => {
    makeSlackNeverAnswer();

    const fixture = await newCandidate();
    const startedAt = Date.now();
    const { status, body } = await deliverReplyFrom(fixture, { text: "Timeout path." });
    const elapsed = Date.now() - startedAt;

    expect(status).toBe(200);
    expect(body.status).toBe("recorded");
    expect(body.slack).toBe("failed");

    expect(elapsed).toBeGreaterThanOrEqual(SLACK_POST_TIMEOUT_MS);
    expect(elapsed).toBeLessThan(SLACK_POST_TIMEOUT_MS * 3);

    const messages = await messagesFor(fixture.personId);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.body).toContain("Timeout path");

    const ledger = await ledgerFor(body.messageId as string);
    expect(ledger?.status).toBe("failed");
    expect(ledger?.detail).toContain("did not answer");
  }, 30_000);

  it("records the email when the configuration itself cannot be read", async () => {
    makeSlackConfigUnreadable("permission denied for function slack_delivery_config");

    const fixture = await newCandidate();
    const { status, body } = await deliverReplyFrom(fixture, { text: "Unreadable config path." });

    expect(status).toBe(200);
    expect(body.status).toBe("recorded");
    expect(body.slack).toBe("failed");
    expect(await messagesFor(fixture.personId)).toHaveLength(1);

    const ledger = await ledgerFor(body.messageId as string);
    expect(ledger?.status).toBe("failed");
    expect(ledger?.channel_id).toBeNull();
  });

  it("still threads a later reply normally after a Slack outage", async () => {
    makeSlackReject("slack is down");

    const fixture = await newCandidate();
    const first = await deliverReplyFrom(fixture, { subject: "Re: Scheduling" });
    const second = await deliverReplyFrom(fixture, { subject: "RE: Scheduling" });

    expect(first.body.threadId).toBe(second.body.threadId);
    expect(await messagesFor(fixture.personId)).toHaveLength(2);
  });
});
