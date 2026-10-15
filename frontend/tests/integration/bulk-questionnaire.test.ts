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

import { POST as bulkQuestionnaire } from "@/app/api/applications/bulk-questionnaire/route";
import { POST as bulkEmail } from "@/app/api/applications/bulk-email/route";
import { POST as resendQuestionnaire } from "@/app/api/questionnaire-responses/[id]/resend/route";
import type { BulkCandidateSendResult } from "@/types/api";
import { DEFAULT_REMINDER } from "@/utilities/stage-action-form";
import { resetTransport, sentEmails } from "./_email-transport-mock";
import {
  currentCookies,
  jsonRequest,
  restoreSession,
  routeParams,
  seedCandidate,
  signInTestUser,
  signOutForRequest,
  type Fixture,
  type L3Session,
} from "./_harness";
import { queuedActionsFor, seedPipelineForPosition } from "./_stage-automation-fixture";

const ENDPOINT = "http://localhost:3000/api/applications/bulk-questionnaire";
const EMAIL_ENDPOINT = "http://localhost:3000/api/applications/bulk-email";

const LINK_PATTERN = /\/q\/([A-Za-z0-9_-]+)/g;

type Seat = {
  fixture: Fixture;
  stageId: string;
  positionTitle: string;
  firstName: string;
};

let session: L3Session;
let sessionCookies: { name: string; value: string }[];
let seats: Seat[];
let questionnaireId: string;
let messageTemplateId: string;
const cleanups: Array<() => Promise<void>> = [];

async function seedSeat(index: number, suffix: string): Promise<Seat> {
  const firstName = `Candidate${index}`;
  const positionTitle = `L3 BulkQ Position ${index} ${suffix}`;

  const fixture = await seedCandidate(session.supabase, { firstName, positionTitle });
  const pipeline = await seedPipelineForPosition(session.supabase, fixture.positionId);

  cleanups.push(pipeline.cleanup);
  cleanups.push(fixture.cleanup);

  const { error } = await session.supabase
    .from("applications")
    .update({ current_stage_id: pipeline.stageOneId })
    .eq("id", fixture.applicationId);
  if (error) throw new Error(`seed stage: ${error.message}`);

  return { fixture, stageId: pipeline.stageOneId, positionTitle, firstName };
}

async function run(body: unknown) {
  resetTransport();
  const response = await bulkQuestionnaire(jsonRequest(ENDPOINT, "POST", body));
  return {
    status: response.status,
    body: (await response.json()) as Partial<BulkCandidateSendResult> & { error?: string },
  };
}

function tokensIn(html: string): string[] {
  return [...html.matchAll(LINK_PATTERN)].map((match) => match[1] as string);
}

async function responsesFor(applicationId: string) {
  const { data } = await session.supabase
    .from("questionnaire_responses")
    .select("id, context, status, access_token_hash, origin_stage_id, reminder_config, sent_at")
    .eq("application_id", applicationId);
  return data ?? [];
}

async function remindersFor(applicationId: string) {
  const rows = await queuedActionsFor(session.supabase, applicationId);
  return rows.filter((row) => row.kind === "reminder");
}

async function clearSends(): Promise<void> {
  for (const seat of seats) {
    await session.supabase
      .from("questionnaire_responses")
      .delete()
      .eq("application_id", seat.fixture.applicationId);
  }
}

beforeAll(async () => {
  session = await signInTestUser();
  sessionCookies = currentCookies();

  const suffix = crypto.randomUUID();
  seats = [await seedSeat(0, suffix), await seedSeat(1, suffix), await seedSeat(2, suffix)];

  const { data: questionnaire, error } = await session.supabase
    .from("questionnaire_templates")
    .insert({ name: `L3 bulk questionnaire ${suffix}` })
    .select("id")
    .single();
  if (error || !questionnaire) throw new Error(`seed questionnaire: ${error?.message}`);
  questionnaireId = questionnaire.id;

  const { data: template, error: templateError } = await session.supabase
    .from("message_templates")
    .insert({
      name: `L3 bulk position email ${suffix}`,
      subject: "About {{position.title}}",
      body: "Hi {{candidate.first_name}}, this role has been paused.",
    })
    .select("id")
    .single();
  if (templateError || !template) throw new Error(`seed template: ${templateError?.message}`);
  messageTemplateId = template.id;
});

afterEach(async () => {
  restoreSession(sessionCookies);
});

afterAll(async () => {
  restoreSession(sessionCookies);
  await session.supabase.from("message_templates").delete().eq("id", messageTemplateId);
  await session.supabase.from("questionnaire_templates").delete().eq("id", questionnaireId);
  for (const cleanup of cleanups) await cleanup();
});

describe("bulk send questionnaire is auth-gated and validated", () => {
  it("401s without a session", async () => {
    signOutForRequest();
    const response = await bulkQuestionnaire(
      jsonRequest(ENDPOINT, "POST", {
        applicationIds: [crypto.randomUUID()],
        questionnaireTemplateId: crypto.randomUUID(),
        sendReminders: false,
      }),
    );
    expect(response.status).toBe(401);
  });

  it("400s invalid JSON", async () => {
    const response = await bulkQuestionnaire(
      new Request(ENDPOINT, { method: "POST", body: "not json" }) as never,
    );
    expect(response.status).toBe(400);
  });

  it("422s an empty selection", async () => {
    const { status } = await run({
      applicationIds: [],
      questionnaireTemplateId: questionnaireId,
      sendReminders: false,
    });
    expect(status).toBe(422);
  });

  it("422s a questionnaire that does not exist, and sends nothing", async () => {
    const { status, body } = await run({
      applicationIds: [seats[0]!.fixture.applicationId],
      questionnaireTemplateId: crypto.randomUUID(),
      sendReminders: false,
    });

    expect(status).toBe(422);
    expect(body.error).toBe("That questionnaire does not exist");
    expect(sentEmails()).toHaveLength(0);
  });
});

describe("bulk send questionnaire never gives one candidate another's link", () => {
  afterEach(clearSends);

  it("sends one message per candidate, to them alone, with nobody CC'd or BCC'd", async () => {
    const { status, body } = await run({
      applicationIds: seats.map((seat) => seat.fixture.applicationId),
      questionnaireTemplateId: questionnaireId,
      sendReminders: false,
    });

    expect(status).toBe(200);
    expect(body.sent).toHaveLength(seats.length);
    expect(body.failures).toEqual([]);

    const emails = sentEmails();
    expect(emails).toHaveLength(seats.length);
    expect(new Set(emails.map((email) => email.to)).size).toBe(seats.length);

    for (const email of emails) {
      expect(email.cc).toEqual([]);
      expect(email.bcc).toEqual([]);
    }
  });

  it("gives every candidate exactly one link, and no two candidates the same one", async () => {
    await run({
      applicationIds: seats.map((seat) => seat.fixture.applicationId),
      questionnaireTemplateId: questionnaireId,
      sendReminders: false,
    });

    const tokens = sentEmails().map((email) => {
      const found = tokensIn(email.html);
      expect(found).toHaveLength(1);
      return found[0] as string;
    });

    expect(new Set(tokens).size).toBe(seats.length);
  });

  it("resolves each candidate's token to their own candidacy and to nobody else's", async () => {
    await run({
      applicationIds: seats.map((seat) => seat.fixture.applicationId),
      questionnaireTemplateId: questionnaireId,
      sendReminders: false,
    });

    for (const email of sentEmails()) {
      const seat = seats.find((candidate) => candidate.fixture.email === email.to);
      expect(seat).toBeDefined();

      const token = tokensIn(email.html)[0] as string;
      const { data } = await session.supabase.rpc("public_questionnaire_by_token", {
        p_token: token,
      });

      expect(data?.[0]?.position_title).toBe(seat!.positionTitle);
    }
  });

  it("addresses each message to that candidate alone, naming nobody else", async () => {
    await run({
      applicationIds: seats.map((seat) => seat.fixture.applicationId),
      questionnaireTemplateId: questionnaireId,
      sendReminders: false,
    });

    for (const email of sentEmails()) {
      const seat = seats.find((candidate) => candidate.fixture.email === email.to);
      expect(email.html).toContain(seat!.firstName);

      for (const other of seats.filter((candidate) => candidate !== seat)) {
        expect(email.html).not.toContain(other.firstName);
        expect(email.html).not.toContain(other.positionTitle);
      }
    }
  });

  it("writes one pending response per candidate, each with its own stored token digest", async () => {
    await run({
      applicationIds: seats.map((seat) => seat.fixture.applicationId),
      questionnaireTemplateId: questionnaireId,
      sendReminders: false,
    });

    const digests: string[] = [];
    for (const seat of seats) {
      const rows = await responsesFor(seat.fixture.applicationId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.context).toBe("manual_sent");
      expect(rows[0]?.status).toBe("pending");
      expect(rows[0]?.access_token_hash).toBeTruthy();
      digests.push(rows[0]!.access_token_hash as string);
    }

    expect(new Set(digests).size).toBe(seats.length);
  });

  it("never stores the raw token in the message thread, and still sends a link that works", async () => {
    await run({
      applicationIds: [seats[0]!.fixture.applicationId],
      questionnaireTemplateId: questionnaireId,
      sendReminders: false,
    });

    const token = tokensIn(sentEmails()[0]!.html)[0] as string;
    expect(token).toBeTruthy();

    const { data: rows } = await session.supabase
      .from("messages")
      .select("id, body, subject")
      .eq("application_id", seats[0]!.fixture.applicationId);

    expect(rows?.length).toBeGreaterThan(0);
    for (const row of rows ?? []) {
      expect(row.body).not.toContain(token);
      expect(row.body).not.toContain("/q/");
    }

    const { data: resolved } = await session.supabase.rpc("public_questionnaire_by_token", {
      p_token: token,
    });
    expect(resolved?.length).toBe(1);
  });

  it("tells the recruiter an invitation was sent and when it stops working", async () => {
    await run({
      applicationIds: [seats[0]!.fixture.applicationId],
      questionnaireTemplateId: questionnaireId,
      sendReminders: false,
    });

    const { data: rows } = await session.supabase
      .from("messages")
      .select("id, body, subject")
      .eq("application_id", seats[0]!.fixture.applicationId);

    expect(rows?.[0]?.body).toContain(
      "A single-use questionnaire link was emailed to the candidate",
    );
    expect(rows?.[0]?.body).toContain("expires on");
  });
});

describe("bulk send questionnaire reports each candidate separately", () => {
  afterEach(clearSends);

  it("sends the ones it can and names the one it cannot", async () => {
    const missingId = crypto.randomUUID();

    const { status, body } = await run({
      applicationIds: [seats[0]!.fixture.applicationId, missingId],
      questionnaireTemplateId: questionnaireId,
      sendReminders: false,
    });

    expect(status).toBe(200);
    expect(body.sent).toEqual([seats[0]!.fixture.applicationId]);
    expect(body.failures).toEqual([{ applicationId: missingId, reason: "Candidate not found" }]);
    expect(sentEmails()).toHaveLength(1);
  });

  it("treats a repeated id as one candidate rather than sending twice", async () => {
    const { body } = await run({
      applicationIds: [seats[0]!.fixture.applicationId, seats[0]!.fixture.applicationId],
      questionnaireTemplateId: questionnaireId,
      sendReminders: false,
    });

    expect(body.sent).toHaveLength(1);
    expect(sentEmails()).toHaveLength(1);
  });
});

describe("bulk send questionnaire schedules reminders the way a stage send does", () => {
  afterEach(clearSends);

  it("queues the configured reminder run against the stage the candidate was in", async () => {
    await run({
      applicationIds: [seats[0]!.fixture.applicationId],
      questionnaireTemplateId: questionnaireId,
      sendReminders: true,
    });

    const reminders = await remindersFor(seats[0]!.fixture.applicationId);

    expect(reminders).toHaveLength(DEFAULT_REMINDER.maxCount);
    expect(reminders.every((row) => row.status === "pending")).toBe(true);
    expect(reminders.every((row) => row.origin_stage_id === seats[0]!.stageId)).toBe(true);
  });

  it("records the schedule on the response, so a due reminder is judged against it", async () => {
    await run({
      applicationIds: [seats[0]!.fixture.applicationId],
      questionnaireTemplateId: questionnaireId,
      sendReminders: true,
    });

    const rows = await responsesFor(seats[0]!.fixture.applicationId);

    expect(rows[0]?.origin_stage_id).toBe(seats[0]!.stageId);
    expect(rows[0]?.reminder_config).toMatchObject({
      enabled: true,
      max_count: DEFAULT_REMINDER.maxCount,
    });
  });

  it("queues nothing when the sender chose not to chase", async () => {
    await run({
      applicationIds: [seats[0]!.fixture.applicationId],
      questionnaireTemplateId: questionnaireId,
      sendReminders: false,
    });

    expect(await remindersFor(seats[0]!.fixture.applicationId)).toEqual([]);
  });

  it("still sends, but queues nothing, for a candidate who is in no stage", async () => {
    await session.supabase
      .from("applications")
      .update({ current_stage_id: null })
      .eq("id", seats[1]!.fixture.applicationId);

    const { body } = await run({
      applicationIds: [seats[1]!.fixture.applicationId],
      questionnaireTemplateId: questionnaireId,
      sendReminders: true,
    });

    expect(body.sent).toEqual([seats[1]!.fixture.applicationId]);
    expect(await remindersFor(seats[1]!.fixture.applicationId)).toEqual([]);

    await session.supabase
      .from("applications")
      .update({ current_stage_id: seats[1]!.stageId })
      .eq("id", seats[1]!.fixture.applicationId);
  });
});

describe("a second bulk send to the same candidate", () => {
  afterEach(clearSends);

  it("re-uses the pending questionnaire and issues a fresh link instead of a second one", async () => {
    const selection = {
      applicationIds: [seats[0]!.fixture.applicationId],
      questionnaireTemplateId: questionnaireId,
      sendReminders: false,
    };

    await run(selection);
    const first = await responsesFor(seats[0]!.fixture.applicationId);
    const firstToken = tokensIn(sentEmails()[0]!.html)[0] as string;

    const { body } = await run(selection);
    const second = await responsesFor(seats[0]!.fixture.applicationId);
    const secondToken = tokensIn(sentEmails()[0]!.html)[0] as string;

    expect(body.sent).toEqual([seats[0]!.fixture.applicationId]);
    expect(second).toHaveLength(1);
    expect(second[0]?.id).toBe(first[0]?.id);
    expect(secondToken).not.toBe(firstToken);
  });

  it("kills the older link, exactly as a reminder does", async () => {
    const selection = {
      applicationIds: [seats[0]!.fixture.applicationId],
      questionnaireTemplateId: questionnaireId,
      sendReminders: false,
    };

    await run(selection);
    const firstToken = tokensIn(sentEmails()[0]!.html)[0] as string;

    await run(selection);
    const secondToken = tokensIn(sentEmails()[0]!.html)[0] as string;

    const stale = await session.supabase.rpc("public_questionnaire_token_state", {
      p_token: firstToken,
    });
    const live = await session.supabase.rpc("public_questionnaire_token_state", {
      p_token: secondToken,
    });

    expect(stale.data).toBe("unknown");
    expect(live.data).toBe("open");
  });

  it("does not queue a second reminder run for the same questionnaire", async () => {
    const selection = {
      applicationIds: [seats[0]!.fixture.applicationId],
      questionnaireTemplateId: questionnaireId,
      sendReminders: true,
    };

    await run(selection);
    await run(selection);

    expect(await remindersFor(seats[0]!.fixture.applicationId)).toHaveLength(
      DEFAULT_REMINDER.maxCount,
    );
  });

  it("refuses to re-ask a candidate who has already answered, and says why", async () => {
    const selection = {
      applicationIds: [seats[0]!.fixture.applicationId],
      questionnaireTemplateId: questionnaireId,
      sendReminders: false,
    };

    await run(selection);
    const [response] = await responsesFor(seats[0]!.fixture.applicationId);
    await session.supabase
      .from("questionnaire_responses")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", response!.id);

    const { status, body } = await run(selection);

    expect(status).toBe(200);
    expect(body.sent).toEqual([]);
    expect(body.failures?.[0]?.reason).toContain("already completed this questionnaire");
    expect(sentEmails()).toHaveLength(0);
  });
});

describe("position-wide email keeps recipients apart", () => {
  it("sends every candidate on the position their own message and shows them nobody else", async () => {
    resetTransport();
    const response = await bulkEmail(
      jsonRequest(EMAIL_ENDPOINT, "POST", {
        applicationIds: seats.map((seat) => seat.fixture.applicationId),
        messageTemplateId,
      }),
    );
    const body = (await response.json()) as BulkCandidateSendResult;

    expect(response.status).toBe(200);
    expect(body.sent).toHaveLength(seats.length);

    const emails = sentEmails();
    expect(emails).toHaveLength(seats.length);
    expect(new Set(emails.map((email) => email.to)).size).toBe(seats.length);

    for (const email of emails) {
      expect(email.cc).toEqual([]);
      expect(email.bcc).toEqual([]);

      const seat = seats.find((candidate) => candidate.fixture.email === email.to);
      expect(seat).toBeDefined();

      for (const other of seats.filter((candidate) => candidate !== seat)) {
        expect(email.html).not.toContain(other.fixture.email);
        expect(email.html).not.toContain(other.firstName);
      }
    }
  });
});

describe("the invite uses the questionnaire's own wording when it has some (0057)", () => {
  afterEach(async () => {
    await clearSends();
    await session.supabase
      .from("questionnaire_templates")
      .update({ invite_email_mode: "default", invite_subject: null, invite_body: null })
      .eq("id", questionnaireId);
  });

  it("sends the custom subject and email, with the candidate's link", async () => {
    const { error } = await session.supabase
      .from("questionnaire_templates")
      .update({
        invite_email_mode: "custom",
        invite_subject: "L3 custom invite for {{questionnaire.name}}",
        invite_body: "Hello {{candidate.first_name}}, here it is: {{questionnaire.link}}",
      })
      .eq("id", questionnaireId);
    if (error) throw new Error(`set custom invite: ${error.message}`);

    const seat = seats[0]!;
    const { status } = await run({
      applicationIds: [seat.fixture.applicationId],
      questionnaireTemplateId: questionnaireId,
      sendReminders: false,
    });
    expect(status).toBe(200);

    const [email] = sentEmails();
    expect(email?.subject).toMatch(/^L3 custom invite for /);
    expect(email?.html).toContain(`Hello ${seat.firstName}, here it is:`);
    expect(tokensIn(email?.html ?? "")).toHaveLength(1);

    // Earlier tests have already emailed this candidate; the thread copy of
    // this send is the newest message.
    const { data: rows } = await session.supabase
      .from("messages")
      .select("body")
      .eq("application_id", seat.fixture.applicationId)
      .order("created_at", { ascending: false })
      .limit(1);
    expect(rows?.[0]?.body).toContain("here it is:");
    expect(rows?.[0]?.body).not.toContain("/q/");
  });

  it("adds the link at the end when the custom email leaves it out", async () => {
    const { error } = await session.supabase
      .from("questionnaire_templates")
      .update({
        invite_email_mode: "custom",
        invite_subject: "L3 no-link invite",
        invite_body: "Hello {{candidate.first_name}}, please fill this in.",
      })
      .eq("id", questionnaireId);
    if (error) throw new Error(`set custom invite: ${error.message}`);

    await run({
      applicationIds: [seats[0]!.fixture.applicationId],
      questionnaireTemplateId: questionnaireId,
      sendReminders: false,
    });

    const [email] = sentEmails();
    expect(email?.subject).toBe("L3 no-link invite");
    expect(tokensIn(email?.html ?? "")).toHaveLength(1);
  });
});

describe("sending one questionnaire on the profile again", () => {
  afterEach(clearSends);

  async function resend(responseId: string) {
    resetTransport();
    const response = await resendQuestionnaire(
      jsonRequest(
        `http://localhost:3000/api/questionnaire-responses/${responseId}/resend`,
        "POST",
        {},
      ),
      routeParams({ id: responseId }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it("resends a pending one with a fresh link, kills the old link, and keeps one card", async () => {
    const seat = seats[0]!;
    await run({
      applicationIds: [seat.fixture.applicationId],
      questionnaireTemplateId: questionnaireId,
      sendReminders: false,
    });
    const [oldToken] = tokensIn(sentEmails()[0]?.html ?? "");
    const [response] = await responsesFor(seat.fixture.applicationId);

    const { status, body } = await resend(response!.id);

    expect(status).toBe(200);
    expect(body.mode).toBe("resent");
    expect(body.questionnaireResponseId).toBe(response!.id);
    const after = await responsesFor(seat.fixture.applicationId);
    expect(after).toHaveLength(1);
    // The card shows when the latest invite went out.
    expect(new Date(after[0]!.sent_at!).getTime()).toBeGreaterThan(
      new Date(response!.sent_at!).getTime(),
    );

    const [newToken] = tokensIn(sentEmails()[0]?.html ?? "");
    expect(newToken).toBeDefined();
    expect(newToken).not.toBe(oldToken);

    const { data: oldResolved } = await session.supabase.rpc("public_questionnaire_by_token", {
      p_token: oldToken!,
    });
    expect(oldResolved ?? []).toHaveLength(0);
    const { data: newResolved } = await session.supabase.rpc("public_questionnaire_by_token", {
      p_token: newToken!,
    });
    expect(newResolved).toHaveLength(1);
  });

  it("asks again after a completed one: a new card, the old answers kept", async () => {
    const seat = seats[0]!;
    await run({
      applicationIds: [seat.fixture.applicationId],
      questionnaireTemplateId: questionnaireId,
      sendReminders: false,
    });
    const [first] = await responsesFor(seat.fixture.applicationId);
    await session.supabase
      .from("questionnaire_responses")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", first!.id);

    const { status, body } = await resend(first!.id);

    expect(status).toBe(200);
    expect(body.mode).toBe("asked_again");
    expect(body.questionnaireResponseId).not.toBe(first!.id);
    expect(sentEmails()).toHaveLength(1);

    const responses = await responsesFor(seat.fixture.applicationId);
    expect(responses).toHaveLength(2);
    expect(responses.find((row) => row.id === first!.id)?.status).toBe("completed");
    expect(responses.find((row) => row.id !== first!.id)?.status).toBe("pending");
  });

  it("404s a questionnaire that does not exist", async () => {
    const { status } = await resend(crypto.randomUUID());
    expect(status).toBe(404);
  });
});
