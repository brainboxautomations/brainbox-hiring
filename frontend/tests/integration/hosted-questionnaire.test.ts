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

import { NextRequest } from "next/server";

import { POST as createAction } from "@/app/api/stage-actions/route";
import { PATCH as updateCandidate } from "@/app/api/applications/[id]/route";
import { GET as getProfile } from "@/app/api/applications/[id]/profile/route";
import { POST as submitQuestionnaire } from "@/app/api/questionnaire-submissions/route";
import { runDueScheduledActions } from "@/app/api/workers/scheduled-actions/_run";
import type { CandidateProfile, StageAction } from "@/types/api";
import {
  currentCookies,
  getRequest,
  jsonRequest,
  restoreSession,
  routeParams,
  seedCandidate,
  signInTestUser,
  type Fixture,
  type L3Session,
} from "./_harness";
import { lastSentEmail, resetTransport, sentEmails } from "./_email-transport-mock";
import { setServiceClient } from "./_service-client";
import { serviceRoleClient } from "./_service-role-client";
import {
  queuedActionsFor,
  seedPipelineForPosition,
  seedRoutingQuestionnaire,
  type PipelineFixture,
  type RoutingFixture,
} from "./_stage-automation-fixture";

const ACTIONS = "http://localhost:3000/api/stage-actions";
const CANDIDATES = "http://localhost:3000/api/applications";
const SUBMISSIONS = "http://localhost:3000/api/questionnaire-submissions";

const CLOCK_SKEW_ALLOWANCE_MS = 10_000;

let session: L3Session;
let sessionCookies: { name: string; value: string }[];
const fixtures: Fixture[] = [];
const pipelines: PipelineFixture[] = [];
const routings: RoutingFixture[] = [];

async function runWorker(): Promise<void> {
  await runDueScheduledActions(session.supabase, {
    now: new Date(Date.now() + CLOCK_SKEW_ALLOWANCE_MS),
  });
}

async function createStageAction(input: Record<string, unknown>): Promise<StageAction> {
  const response = await createAction(jsonRequest(ACTIONS, "POST", input));
  const body = (await response.json()) as { action?: StageAction; error?: string };
  if (!body.action) throw new Error(`create stage action: ${body.error}`);
  return body.action;
}

function submissionRequest(payload: unknown, files: Array<[string, File]> = []): NextRequest {
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  for (const [key, file] of files) form.append(key, file);
  return new NextRequest(SUBMISSIONS, { method: "POST", body: form });
}

async function submit(
  payload: unknown,
  files: Array<[string, File]> = [],
): Promise<{ status: number; body: { completed?: boolean; error?: string } }> {
  const response = await submitQuestionnaire(submissionRequest(payload, files));
  return { status: response.status, body: await response.json() };
}

function tokenFromLastEmail(): string {
  const html = lastSentEmail()?.html ?? "";
  const match = html.match(/https:\/\/jobs\.example\.com\/q\/([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error(`No questionnaire link in the sent email:\n${html}`);
  return match[1];
}

type SentWorld = {
  fixture: Fixture;
  pipeline: PipelineFixture;
  routing: RoutingFixture;
  token: string;
  responseId: string;
};

async function sendQuestionnaireToCandidate(): Promise<SentWorld> {
  const fixture = await seedCandidate(session.supabase);
  fixtures.push(fixture);
  const pipeline = await seedPipelineForPosition(session.supabase, fixture.positionId);
  pipelines.push(pipeline);
  const routing = await seedRoutingQuestionnaire(session.supabase, fixture.positionId);
  routings.push(routing);

  await createStageAction({
    positionStageId: pipeline.stageTwoId,
    type: "send_questionnaire",
    questionnaireTemplateId: routing.questionnaireId,
    delayMinutes: 0,
    reminderConfig: {
      enabled: true,
      intervalMinutes: [2880],
      maxCount: 2,
      messageTemplateId: null,
    },
  });

  await updateCandidate(
    jsonRequest(`${CANDIDATES}/${fixture.applicationId}`, "PATCH", {
      stageId: pipeline.stageTwoId,
    }),
    routeParams({ id: fixture.applicationId }),
  );

  await runWorker();

  const token = tokenFromLastEmail();

  const { data: response } = await session.supabase
    .from("questionnaire_responses")
    .select("id")
    .eq("application_id", fixture.applicationId)
    .single();

  return { fixture, pipeline, routing, token, responseId: response!.id };
}

beforeAll(async () => {
  session = await signInTestUser();
  sessionCookies = currentCookies();
  setServiceClient(serviceRoleClient());
});

beforeEach(() => {
  restoreSession(sessionCookies);
  resetTransport();
});

afterAll(async () => {
  for (const routing of routings) await routing.cleanup();
  for (const pipeline of pipelines) await pipeline.cleanup();
  for (const fixture of fixtures) await fixture.cleanup();
});

afterEach(() => {
  restoreSession(sessionCookies);
});

describe("send, resolve, submit, complete", () => {
  it("emails a link a candidate can open, answer and submit", async () => {
    const world = await sendQuestionnaireToCandidate();

    const { data: resolved } = await session.supabase
      .rpc("public_questionnaire_by_token", { p_token: world.token })
      .maybeSingle();

    expect(resolved?.questionnaire_name).toContain("L3 routing questionnaire");
    expect(resolved?.position_title).toBe("Senior Frontend Engineer");
    expect(resolved?.position_id).toBe(world.fixture.positionId);

    const { data: questions } = await session.supabase.rpc(
      "public_questionnaire_questions_by_token",
      { p_token: world.token },
    );

    expect(questions).toHaveLength(1);
    expect(questions![0]!.id).toBe(world.routing.questionId);
    expect(Object.keys(questions![0]!)).not.toContain("answer_routing");

    const result = await submit({
      token: world.token,
      textAnswers: [{ questionId: world.routing.questionId, value: "yes" }],
    });

    expect(result.status).toBe(200);
    expect(result.body.completed).toBe(true);

    const { data: response } = await session.supabase
      .from("questionnaire_responses")
      .select("status, completed_at, context")
      .eq("id", world.responseId)
      .single();

    expect(response?.status).toBe("completed");
    expect(response?.completed_at).not.toBeNull();
    expect(response?.context).toBe("stage_sent");

    const { data: answers } = await session.supabase
      .from("answers")
      .select("question_id, value")
      .eq("questionnaire_response_id", world.responseId);

    expect(answers).toHaveLength(1);
    expect(answers![0]!.value).toBe("yes");
  });

  it("QST-8: the profile shows the stage-sent questionnaire as complete", async () => {
    const world = await sendQuestionnaireToCandidate();

    const beforeResponse = await getProfile(
      getRequest(`${CANDIDATES}/${world.fixture.applicationId}/profile`),
      routeParams({ id: world.fixture.applicationId }),
    );
    const before = (await beforeResponse.json()) as { profile: CandidateProfile };
    const pending = before.profile.questionnaires.find((q) => q.id === world.responseId);

    expect(pending?.status).toBe("pending");
    expect(pending?.context).toBe("stage_sent");
    expect(pending?.sentAt).not.toBeNull();
    expect(pending?.linkExpiresAt).not.toBeNull();

    await submit({
      token: world.token,
      textAnswers: [{ questionId: world.routing.questionId, value: "yes" }],
    });

    const afterResponse = await getProfile(
      getRequest(`${CANDIDATES}/${world.fixture.applicationId}/profile`),
      routeParams({ id: world.fixture.applicationId }),
    );
    const after = (await afterResponse.json()) as { profile: CandidateProfile };
    const complete = after.profile.questionnaires.find((q) => q.id === world.responseId);

    expect(complete?.status).toBe("completed");
    expect(complete?.completedAt).not.toBeNull();
    expect(complete?.answers).toHaveLength(1);
  });
});

describe("a bad, expired or already-used token is refused", () => {
  it("refuses a token nobody issued", async () => {
    const world = await sendQuestionnaireToCandidate();

    const result = await submit({
      token: "Zm9yZ2VkLXRva2VuLXRoYXQtaXMtNDMtY2hhcnMtbG9uZy1hYWFh",
      textAnswers: [{ questionId: world.routing.questionId, value: "no" }],
    });

    expect(result.status).toBe(410);

    const { data: answers } = await session.supabase
      .from("answers")
      .select("id")
      .eq("questionnaire_response_id", world.responseId);

    expect(answers ?? []).toHaveLength(0);
  });

  it("refuses the response id itself — a row id is not a credential", async () => {
    const world = await sendQuestionnaireToCandidate();

    const result = await submit({
      token: world.responseId,
      textAnswers: [{ questionId: world.routing.questionId, value: "no" }],
    });

    expect(result.status).toBe(410);
  });

  it("refuses an expired token", async () => {
    const world = await sendQuestionnaireToCandidate();

    await session.supabase
      .from("questionnaire_responses")
      .update({ access_token_expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", world.responseId);

    const result = await submit({
      token: world.token,
      textAnswers: [{ questionId: world.routing.questionId, value: "no" }],
    });

    expect(result.status).toBe(410);

    const { data: state } = await session.supabase.rpc("public_questionnaire_token_state", {
      p_token: world.token,
    });
    expect(state).toBe("expired");
  });

  it("refuses a second submission on a link that has already been used", async () => {
    const world = await sendQuestionnaireToCandidate();

    const first = await submit({
      token: world.token,
      textAnswers: [{ questionId: world.routing.questionId, value: "yes" }],
    });
    expect(first.status).toBe(200);

    const second = await submit({
      token: world.token,
      textAnswers: [{ questionId: world.routing.questionId, value: "no" }],
    });
    expect(second.status).toBe(410);

    const { data: answers } = await session.supabase
      .from("answers")
      .select("value")
      .eq("questionnaire_response_id", world.responseId);

    expect(answers).toHaveLength(1);
    expect(answers![0]!.value).toBe("yes");
  });

  it("refuses an answer to a question that is not on this questionnaire", async () => {
    const world = await sendQuestionnaireToCandidate();
    const other = await seedRoutingQuestionnaire(session.supabase, world.fixture.positionId);
    routings.push(other);

    const result = await submit({
      token: world.token,
      textAnswers: [
        { questionId: world.routing.questionId, value: "yes" },
        { questionId: other.questionId, value: "smuggled" },
      ],
    });

    expect(result.status).toBe(200);

    const { data: answers } = await session.supabase
      .from("answers")
      .select("question_id")
      .eq("questionnaire_response_id", world.responseId);

    expect(answers).toHaveLength(1);
    expect(answers![0]!.question_id).toBe(world.routing.questionId);
  });
});

describe("completion drives the reminder and routing engine", () => {
  it("stops the reminder run and routes on the answer", async () => {
    const world = await sendQuestionnaireToCandidate();

    const beforeSubmit = await queuedActionsFor(session.supabase, world.fixture.applicationId);
    expect(
      beforeSubmit.filter((row) => row.kind === "reminder" && row.status === "pending"),
    ).not.toHaveLength(0);

    await submit({
      token: world.token,
      textAnswers: [{ questionId: world.routing.questionId, value: "no" }],
    });

    const afterSubmit = await queuedActionsFor(session.supabase, world.fixture.applicationId);

    expect(
      afterSubmit.filter((row) => row.kind === "reminder" && row.status === "pending"),
    ).toHaveLength(0);
    expect(
      afterSubmit.filter((row) => row.kind === "reminder" && row.status === "cancelled").length,
    ).toBeGreaterThan(0);
    expect(afterSubmit.filter((row) => row.kind === "answer_routing")).toHaveLength(1);

    resetTransport();
    await runWorker();

    const { data: application } = await session.supabase
      .from("applications")
      .select("current_stage_id")
      .eq("id", world.fixture.applicationId)
      .single();

    expect(application?.current_stage_id).toBe(world.routing.routedStageId);
    expect(sentEmails()).toHaveLength(0);
  });
});
