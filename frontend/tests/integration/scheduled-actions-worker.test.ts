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
import { POST as runWorker, WORKER_SECRET_HEADER } from "@/app/api/workers/scheduled-actions/route";
import { runDueScheduledActions } from "@/app/api/workers/scheduled-actions/_run";
import type { ScheduledActionRunSummary, StageAction } from "@/types/api";
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
import {
  completeQuestionnaireFor,
  onlyQueuedAction,
  queuedActionsFor,
  seedPipelineForPosition,
  seedRoutingQuestionnaire,
  sendQuestionnaireFor,
  type PipelineFixture,
  type RoutingFixture,
} from "./_stage-automation-fixture";

const ACTIONS = "http://localhost:3000/api/stage-actions";
const CANDIDATES = "http://localhost:3000/api/applications";
const WORKER = "http://localhost:3000/api/workers/scheduled-actions";
const SECRET = "l3-placeholder-automation-worker-secret";

let session: L3Session;
let sessionCookies: { name: string; value: string }[];
const fixtures: Fixture[] = [];
const pipelines: PipelineFixture[] = [];
const routings: RoutingFixture[] = [];

type World = { fixture: Fixture; pipeline: PipelineFixture };

async function newWorld(overrides: Parameters<typeof seedCandidate>[1] = {}): Promise<World> {
  const fixture = await seedCandidate(session.supabase, overrides);
  fixtures.push(fixture);
  const pipeline = await seedPipelineForPosition(session.supabase, fixture.positionId);
  pipelines.push(pipeline);
  return { fixture, pipeline };
}

async function createStageAction(input: Record<string, unknown>): Promise<StageAction> {
  const response = await createAction(jsonRequest(ACTIONS, "POST", input));
  const body = (await response.json()) as { action?: StageAction; error?: string };
  if (!body.action) throw new Error(`create stage action: ${body.error}`);
  return body.action;
}

async function moveTo(applicationId: string, stageId: string) {
  return (
    await updateCandidate(
      jsonRequest(`${CANDIDATES}/${applicationId}`, "PATCH", { stageId }),
      routeParams({ id: applicationId }),
    )
  ).status;
}

function workerRequest(secret: string | null): NextRequest {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (secret !== null) headers.set(WORKER_SECRET_HEADER, secret);
  return new NextRequest(WORKER, { method: "POST", headers, body: "{}" });
}

async function runViaRoute(): Promise<{ status: number; summary: ScheduledActionRunSummary }> {
  const response = await runWorker(workerRequest(SECRET));
  return { status: response.status, summary: (await response.json()) as ScheduledActionRunSummary };
}

const CLOCK_SKEW_ALLOWANCE_MS = 10_000;

async function run(): Promise<{ status: number; summary: ScheduledActionRunSummary }> {
  const summary = await runDueScheduledActions(session.supabase, {
    now: new Date(Date.now() + CLOCK_SKEW_ALLOWANCE_MS),
  });
  return { status: 200, summary };
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
  for (const routing of routings) await routing.cleanup();
  for (const pipeline of pipelines) await pipeline.cleanup();
  for (const fixture of fixtures) await fixture.cleanup();
});

describe("the worker endpoint authenticates on a shared secret, not a session", () => {
  it("401s with no secret at all", async () => {
    expect((await runWorker(workerRequest(null))).status).toBe(401);
  });

  it("401s on the wrong secret", async () => {
    expect((await runWorker(workerRequest("not-the-secret"))).status).toBe(401);
  });

  it("accepts the configured secret", async () => {
    expect((await runViaRoute()).status).toBe(200);
  });
});

describe("a due action fires exactly once", () => {
  it("sends the stage's email and settles the queue row", async () => {
    const { fixture, pipeline } = await newWorld({ emailSenderName: "Acme Talent" });

    await createStageAction({
      positionStageId: pipeline.stageTwoId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
      delayMinutes: 0,
    });
    await moveTo(fixture.applicationId, pipeline.stageTwoId);

    const { status, summary } = await run();
    expect(status).toBe(200);
    expect(summary.sent).toBeGreaterThanOrEqual(1);

    const queued = onlyQueuedAction(
      await queuedActionsFor(session.supabase, fixture.applicationId),
    );
    expect(queued.status).toBe("sent");
    expect(queued.message_id).not.toBeNull();
    expect(queued.failure_reason).toBeNull();

    const email = lastSentEmail();
    expect(email?.to).toBe(fixture.email);
    expect(email?.subject).toContain("Senior Frontend Engineer");
    expect(email?.senderDisplayName).toBe("Acme Talent");
  });

  it("does not send the same action a second time when the worker runs again", async () => {
    const { fixture, pipeline } = await newWorld();

    await createStageAction({
      positionStageId: pipeline.stageTwoId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
      delayMinutes: 0,
    });
    await moveTo(fixture.applicationId, pipeline.stageTwoId);

    await run();
    const before = sentEmails().length;

    await run();
    await run();

    expect(sentEmails()).toHaveLength(before);
    const queued = await queuedActionsFor(session.supabase, fixture.applicationId);
    expect(queued.filter((row) => row.status === "sent")).toHaveLength(1);
  });

  it("leaves an action alone until its delay has elapsed", async () => {
    const { fixture, pipeline } = await newWorld();

    await createStageAction({
      positionStageId: pipeline.stageTwoId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
      delayMinutes: 60,
    });
    await moveTo(fixture.applicationId, pipeline.stageTwoId);

    await run();

    const queued = onlyQueuedAction(
      await queuedActionsFor(session.supabase, fixture.applicationId),
    );
    expect(queued.status).toBe("pending");
    expect(sentEmails()).toHaveLength(0);
  });

  it("claims due rows in one pass when the batch is bounded", async () => {
    const { fixture, pipeline } = await newWorld();

    await createStageAction({
      positionStageId: pipeline.stageTwoId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
      delayMinutes: 0,
    });
    await moveTo(fixture.applicationId, pipeline.stageTwoId);

    const summary = await runDueScheduledActions(session.supabase, {
      now: new Date(Date.now() + CLOCK_SKEW_ALLOWANCE_MS),
      batchSize: 100,
    });

    expect(summary.claimed).toBeGreaterThanOrEqual(1);
    expect(summary.claimed).toBe(summary.sent + summary.skipped + summary.failed);
  });
});

describe("the candidate's current stage decides, at execution time", () => {
  it("sends nothing once the candidate has been moved out", async () => {
    const { fixture, pipeline } = await newWorld();

    await createStageAction({
      positionStageId: pipeline.stageTwoId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
      delayMinutes: 0,
    });
    await moveTo(fixture.applicationId, pipeline.stageTwoId);
    await moveTo(fixture.applicationId, pipeline.stageThreeId);

    await run();

    expect(sentEmails()).toHaveLength(0);
    const queued = onlyQueuedAction(
      await queuedActionsFor(session.supabase, fixture.applicationId),
    );
    expect(queued.status).toBe("cancelled");
  });

  it("skips a row that survived the move, rather than trusting the schedule", async () => {
    const { fixture, pipeline } = await newWorld();

    const action = await createStageAction({
      positionStageId: pipeline.stageOneId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
      delayMinutes: 0,
    });

    await moveTo(fixture.applicationId, pipeline.stageTwoId);

    const { error } = await session.supabase.from("scheduled_actions").insert({
      application_id: fixture.applicationId,
      stage_action_id: action.id,
      origin_stage_id: pipeline.stageOneId,
      scheduled_for: new Date().toISOString(),
    });
    expect(error).toBeNull();

    await run();

    expect(sentEmails()).toHaveLength(0);
    const queued = await queuedActionsFor(session.supabase, fixture.applicationId);
    const stale = queued.find((row) => row.origin_stage_id === pipeline.stageOneId);
    expect(stale?.status).toBe("skipped");
    expect(stale?.failure_reason).toBe(
      "The candidate is no longer in the stage that scheduled this action",
    );
  });

  it("does not email a candidate who has been archived", async () => {
    const { fixture, pipeline } = await newWorld();

    await createStageAction({
      positionStageId: pipeline.stageTwoId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
      delayMinutes: 0,
    });
    await moveTo(fixture.applicationId, pipeline.stageTwoId);

    await updateCandidate(
      jsonRequest(`${CANDIDATES}/${fixture.applicationId}`, "PATCH", { status: "archived" }),
      routeParams({ id: fixture.applicationId }),
    );

    await run();

    expect(sentEmails()).toHaveLength(0);
    const queued = onlyQueuedAction(
      await queuedActionsFor(session.supabase, fixture.applicationId),
    );
    expect(queued.status).toBe("skipped");
    expect(queued.failure_reason).toBe("The candidate has been archived");
  });
});

describe("a move_to_stage action moves the candidate and cascades", () => {
  it("moves the candidate, which in turn fires the destination stage", async () => {
    const { fixture, pipeline } = await newWorld();

    await createStageAction({
      positionStageId: pipeline.stageTwoId,
      type: "move_to_stage",
      targetPositionStageId: pipeline.stageThreeId,
      delayMinutes: 0,
    });
    await createStageAction({
      positionStageId: pipeline.stageThreeId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
      delayMinutes: 90,
    });

    await moveTo(fixture.applicationId, pipeline.stageTwoId);

    const { summary } = await run();
    expect(summary.sent).toBeGreaterThanOrEqual(1);

    const { data: application } = await session.supabase
      .from("applications")
      .select("current_stage_id")
      .eq("id", fixture.applicationId)
      .single();

    expect(application?.current_stage_id).toBe(pipeline.stageThreeId);

    const queued = await queuedActionsFor(session.supabase, fixture.applicationId);
    const fromStageThree = onlyQueuedAction(
      queued.filter((row) => row.origin_stage_id === pipeline.stageThreeId),
    );
    expect(fromStageThree.status).toBe("pending");
  });
});

describe("failure is durable and inspectable", () => {
  it("records the relay's rejection on the queue row", async () => {
    const { fixture, pipeline } = await newWorld();

    await createStageAction({
      positionStageId: pipeline.stageTwoId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
      delayMinutes: 0,
    });
    await moveTo(fixture.applicationId, pipeline.stageTwoId);

    makeTransportFail("the relay is unreachable");

    const { summary } = await run();
    expect(summary.failed).toBeGreaterThanOrEqual(1);

    const queued = onlyQueuedAction(
      await queuedActionsFor(session.supabase, fixture.applicationId),
    );
    expect(queued.status).toBe("failed");
    expect(queued.failure_reason).toContain("the relay is unreachable");
    expect(queued.message_id).not.toBeNull();
  });

  it("sends a send_questionnaire action with a real hosted link", async () => {
    const { fixture, pipeline } = await newWorld();

    const { data: questionnaire } = await session.supabase
      .from("questionnaire_templates")
      .insert({ name: `L3 automation questionnaire ${crypto.randomUUID()}` })
      .select("id")
      .single();

    await createStageAction({
      positionStageId: pipeline.stageTwoId,
      type: "send_questionnaire",
      questionnaireTemplateId: questionnaire!.id,
      delayMinutes: 0,
    });
    await moveTo(fixture.applicationId, pipeline.stageTwoId);

    await run();

    const queued = onlyQueuedAction(
      await queuedActionsFor(session.supabase, fixture.applicationId),
    );
    expect(queued.status).toBe("sent");
    expect(queued.failure_reason).toBeNull();

    const email = lastSentEmail();
    expect(email?.html).toContain("https://jobs.example.com/q/");

    const { data: responses } = await session.supabase
      .from("questionnaire_responses")
      .select("id, status, sent_at, access_token_hash, access_token_expires_at")
      .eq("application_id", fixture.applicationId);

    expect(responses ?? []).toHaveLength(1);
    const response = responses![0]!;
    expect(response.status).toBe("pending");
    expect(response.access_token_hash).toMatch(/^[0-9a-f]{64}$/);

    expect(email?.html).not.toContain(response.access_token_hash!);

    await session.supabase.from("questionnaire_templates").delete().eq("id", questionnaire!.id);
  });
});

describe("completing a questionnaire routes the candidate through the same queue", () => {
  it("moves the candidate to the stage the answer names, and that stage then fires", async () => {
    const { fixture, pipeline } = await newWorld();
    const routing = await seedRoutingQuestionnaire(session.supabase, fixture.positionId);
    routings.push(routing);

    await createStageAction({
      positionStageId: routing.routedStageId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
      delayMinutes: 120,
    });

    await moveTo(fixture.applicationId, pipeline.stageOneId);
    await completeQuestionnaireFor(session.supabase, {
      applicationId: fixture.applicationId,
      questionnaireId: routing.questionnaireId,
      questionId: routing.questionId,
      optionValue: "no",
    });

    await run();

    const { data: application } = await session.supabase
      .from("applications")
      .select("current_stage_id")
      .eq("id", fixture.applicationId)
      .single();
    expect(application?.current_stage_id).toBe(routing.routedStageId);

    const queued = await queuedActionsFor(session.supabase, fixture.applicationId);
    const routingRow = queued.find((row) => row.kind === "answer_routing");
    expect(routingRow?.status).toBe("sent");

    const cascade = queued.find((row) => row.origin_stage_id === routing.routedStageId);
    expect(cascade?.status).toBe("pending");
  });

  it("an answer rule beats the questionnaire's on-completion rule", async () => {
    const { fixture, pipeline } = await newWorld();
    const routing = await seedRoutingQuestionnaire(session.supabase, fixture.positionId);
    routings.push(routing);

    const { data: onCompletionStage } = await session.supabase
      .from("pipeline_template_stages")
      .insert({
        pipeline_id: (
          await session.supabase
            .from("positions")
            .select("assigned_pipeline_id")
            .eq("id", fixture.positionId)
            .single()
        ).data!.assigned_pipeline_id!,
        name: "On completion",
        sort_order: 8,
      })
      .select("id")
      .single();

    await session.supabase.from("position_stages").insert({
      position_id: fixture.positionId,
      source_template_stage_id: onCompletionStage!.id,
      name: "On completion",
      sort_order: 8,
    });

    await session.supabase
      .from("questionnaire_templates")
      .update({ on_completion_template_stage_id: onCompletionStage!.id })
      .eq("id", routing.questionnaireId);

    await moveTo(fixture.applicationId, pipeline.stageOneId);
    await completeQuestionnaireFor(session.supabase, {
      applicationId: fixture.applicationId,
      questionnaireId: routing.questionnaireId,
      questionId: routing.questionId,
      optionValue: "no",
    });

    await run();

    const { data: application } = await session.supabase
      .from("applications")
      .select("current_stage_id")
      .eq("id", fixture.applicationId)
      .single();

    expect(application?.current_stage_id).toBe(routing.routedStageId);
  });

  it("leaves the candidate where they are when the target no longer resolves", async () => {
    const { fixture, pipeline } = await newWorld();
    const routing = await seedRoutingQuestionnaire(session.supabase, fixture.positionId);
    routings.push(routing);

    await moveTo(fixture.applicationId, pipeline.stageOneId);
    await routing.severTemplateStage();

    await completeQuestionnaireFor(session.supabase, {
      applicationId: fixture.applicationId,
      questionnaireId: routing.questionnaireId,
      questionId: routing.questionId,
      optionValue: "no",
    });

    await run();

    const { data: application } = await session.supabase
      .from("applications")
      .select("current_stage_id")
      .eq("id", fixture.applicationId)
      .single();
    expect(application?.current_stage_id).toBe(pipeline.stageOneId);

    const routingRow = (await queuedActionsFor(session.supabase, fixture.applicationId)).find(
      (row) => row.kind === "answer_routing",
    );
    expect(routingRow?.status).toBe("skipped");
    expect(routingRow?.failure_reason).toBe(
      "The stage this answer routes to is not on this position, so the candidate was left where they are",
    );
  });

  it("routes nobody when the candidate's answer carries no rule", async () => {
    const { fixture, pipeline } = await newWorld();
    const routing = await seedRoutingQuestionnaire(session.supabase, fixture.positionId);
    routings.push(routing);

    await moveTo(fixture.applicationId, pipeline.stageOneId);
    await completeQuestionnaireFor(session.supabase, {
      applicationId: fixture.applicationId,
      questionnaireId: routing.questionnaireId,
      questionId: routing.questionId,
      optionValue: "yes",
    });

    await run();

    const { data: application } = await session.supabase
      .from("applications")
      .select("current_stage_id")
      .eq("id", fixture.applicationId)
      .single();
    expect(application?.current_stage_id).toBe(pipeline.stageOneId);

    const routingRow = (await queuedActionsFor(session.supabase, fixture.applicationId)).find(
      (row) => row.kind === "answer_routing",
    );
    expect(routingRow?.status).toBe("skipped");
    expect(routingRow?.failure_reason).toBe("No routing rule matched this questionnaire's answers");
  });
});

describe("a due reminder re-checks its stop conditions in the worker", () => {
  async function reminderWorld() {
    const { fixture, pipeline } = await newWorld();
    const routing = await seedRoutingQuestionnaire(session.supabase, fixture.positionId);
    routings.push(routing);

    await moveTo(fixture.applicationId, pipeline.stageOneId);

    const action = await createStageAction({
      positionStageId: pipeline.stageOneId,
      type: "send_questionnaire",
      questionnaireTemplateId: routing.questionnaireId,
      delayMinutes: 0,
      reminderConfig: {
        enabled: true,
        intervalMinutes: [2880],
        maxCount: 3,
        messageTemplateId: null,
      },
    });

    const responseId = await sendQuestionnaireFor(session.supabase, {
      applicationId: fixture.applicationId,
      questionnaireId: routing.questionnaireId,
      stageActionId: action.id,
    });

    const { error } = await session.supabase.rpc("schedule_questionnaire_reminders", {
      p_questionnaire_response_id: responseId,
      p_schedule: [
        { reminder_number: 1, scheduled_for: new Date(Date.now() - 60_000).toISOString() },
      ],
      p_now: new Date().toISOString(),
    });
    expect(error).toBeNull();

    return { fixture, pipeline, routing, responseId };
  }

  it("reaches the send only after every stop condition has passed", async () => {
    const { fixture, responseId } = await reminderWorld();

    await run();

    const reminder = (await queuedActionsFor(session.supabase, fixture.applicationId)).find(
      (row) => row.kind === "reminder",
    );

    expect(reminder?.status).toBe("sent");

    expect(lastSentEmail()?.html).toContain("https://jobs.example.com/q/");

    const { data: response } = await session.supabase
      .from("questionnaire_responses")
      .select("access_token_hash")
      .eq("id", responseId)
      .single();

    expect(response?.access_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a completed questionnaire cancels the reminder before a worker can take it", async () => {
    const { fixture, responseId } = await reminderWorld();

    await session.supabase
      .from("questionnaire_responses")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", responseId);

    await run();

    const reminder = (await queuedActionsFor(session.supabase, fixture.applicationId)).find(
      (row) => row.kind === "reminder",
    );

    expect(reminder?.status).toBe("cancelled");
    expect(sentEmails()).toHaveLength(0);
  });

  it("a manual stop cancels the reminder too", async () => {
    const { fixture, responseId } = await reminderWorld();

    await session.supabase
      .from("questionnaire_responses")
      .update({ reminders_stopped_at: new Date().toISOString() })
      .eq("id", responseId);

    await run();

    const reminder = (await queuedActionsFor(session.supabase, fixture.applicationId)).find(
      (row) => row.kind === "reminder",
    );

    expect(reminder?.status).toBe("cancelled");
  });

  it("moving the candidate on cancels the reminder", async () => {
    const { fixture, pipeline } = await reminderWorld();

    await moveTo(fixture.applicationId, pipeline.stageTwoId);
    await run();

    const reminder = (await queuedActionsFor(session.supabase, fixture.applicationId)).find(
      (row) => row.kind === "reminder",
    );

    expect(reminder?.status).toBe("cancelled");
  });
});
