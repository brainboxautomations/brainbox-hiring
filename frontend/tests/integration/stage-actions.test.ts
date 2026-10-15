import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const { cookieJar } = await import("./_cookie-jar");
  return { cookies: async () => cookieJar };
});

import { GET as listActions, POST as createAction } from "@/app/api/stage-actions/route";
import {
  DELETE as deleteAction,
  GET as getAction,
  PATCH as updateAction,
} from "@/app/api/stage-actions/[id]/route";
import { PATCH as updateCandidate } from "@/app/api/applications/[id]/route";
import { DEFAULT_EMAIL_DELAY_MINUTES } from "@/schemas/stage-action-schema";
import type { StageAction } from "@/types/api";
import {
  currentCookies,
  getRequest,
  jsonRequest,
  restoreSession,
  routeParams,
  seedCandidate,
  signInTestUser,
  signOutForRequest,
  type Fixture,
  type L3Session,
} from "./_harness";
import {
  onlyQueuedAction,
  queuedActionsFor,
  seedPipelineForPosition,
  type PipelineFixture,
} from "./_stage-automation-fixture";

const ENDPOINT = "http://localhost:3000/api/stage-actions";
const CANDIDATES = "http://localhost:3000/api/applications";

let session: L3Session;
let sessionCookies: { name: string; value: string }[];
const fixtures: Fixture[] = [];
const pipelines: PipelineFixture[] = [];

type World = { fixture: Fixture; pipeline: PipelineFixture };

async function newWorld(): Promise<World> {
  const fixture = await seedCandidate(session.supabase);
  fixtures.push(fixture);
  const pipeline = await seedPipelineForPosition(session.supabase, fixture.positionId);
  pipelines.push(pipeline);
  return { fixture, pipeline };
}

async function create(input: Record<string, unknown>) {
  const response = await createAction(jsonRequest(ENDPOINT, "POST", input));
  return {
    status: response.status,
    body: (await response.json()) as { action?: StageAction; error?: string },
  };
}

async function moveTo(applicationId: string, stageId: string | null) {
  const response = await updateCandidate(
    jsonRequest(`${CANDIDATES}/${applicationId}`, "PATCH", { stageId }),
    routeParams({ id: applicationId }),
  );
  return response.status;
}

beforeAll(async () => {
  session = await signInTestUser();
  sessionCookies = currentCookies();
});

afterEach(() => {
  restoreSession(sessionCookies);
});

afterAll(async () => {
  restoreSession(sessionCookies);
  for (const pipeline of pipelines) await pipeline.cleanup();
  for (const fixture of fixtures) await fixture.cleanup();
});

describe("stage actions are auth-gated", () => {
  it("401s the list without a session", async () => {
    signOutForRequest();
    const response = await listActions(getRequest(`${ENDPOINT}?positionStageId=x`));
    expect(response.status).toBe(401);
  });

  it("401s a create without a session", async () => {
    signOutForRequest();
    const response = await createAction(jsonRequest(ENDPOINT, "POST", {}));
    expect(response.status).toBe(401);
  });

  it("401s a delete without a session", async () => {
    signOutForRequest();
    const id = crypto.randomUUID();
    const response = await deleteAction(getRequest(`${ENDPOINT}/${id}`), routeParams({ id }));
    expect(response.status).toBe(401);
  });
});

describe("stage action CRUD", () => {
  it("requires a positionStageId to list", async () => {
    const response = await listActions(getRequest(ENDPOINT));
    expect(response.status).toBe(422);
  });

  it("404s a create against a stage that does not exist", async () => {
    const { status } = await create({
      positionStageId: crypto.randomUUID(),
      type: "send_email",
      messageTemplateId: crypto.randomUUID(),
    });
    expect(status).toBe(404);
  });

  it("creates an email action on the default delay", async () => {
    const { pipeline } = await newWorld();

    const { status, body } = await create({
      positionStageId: pipeline.stageTwoId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
    });

    expect(status).toBe(201);
    const action = body.action as StageAction;
    expect(action.type).toBe("send_email");
    expect(action.delayMinutes).toBe(DEFAULT_EMAIL_DELAY_MINUTES);
    expect(action.enabled).toBe(true);
    expect(action.messageTemplateId).toBe(pipeline.templateId);
    expect(action.targetPositionStageId).toBeNull();
  });

  it("holds several independent actions on one stage, ordered by sortOrder", async () => {
    const { pipeline } = await newWorld();

    await create({
      positionStageId: pipeline.stageOneId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
      delayMinutes: 90,
      sortOrder: 2,
    });
    await create({
      positionStageId: pipeline.stageOneId,
      type: "move_to_stage",
      targetPositionStageId: pipeline.stageTwoId,
      delayMinutes: 30,
      sortOrder: 1,
    });

    const response = await listActions(
      getRequest(`${ENDPOINT}?positionStageId=${pipeline.stageOneId}`),
    );
    const { actions } = (await response.json()) as { actions: StageAction[] };
    const [first, second] = actions;

    expect(actions).toHaveLength(2);
    expect(first?.type).toBe("move_to_stage");
    expect(first?.delayMinutes).toBe(30);
    expect(second?.delayMinutes).toBe(90);
  });

  it("refuses a move to a stage on a different position", async () => {
    const first = await newWorld();
    const second = await newWorld();

    const { status, body } = await create({
      positionStageId: first.pipeline.stageOneId,
      type: "move_to_stage",
      targetPositionStageId: second.pipeline.stageTwoId,
      delayMinutes: 0,
    });

    expect(status).toBe(422);
    expect(body.error).toContain("different position");
  });

  it("refuses a negative delay", async () => {
    const { pipeline } = await newWorld();

    const { status } = await create({
      positionStageId: pipeline.stageOneId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
      delayMinutes: -1,
    });

    expect(status).toBe(422);
  });

  it("reads one back, updates it, and deletes it", async () => {
    const { pipeline } = await newWorld();

    const { body } = await create({
      positionStageId: pipeline.stageOneId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
      delayMinutes: 15,
    });
    const action = body.action as StageAction;

    const read = await getAction(
      getRequest(`${ENDPOINT}/${action.id}`),
      routeParams({ id: action.id }),
    );
    expect(read.status).toBe(200);

    const patched = await updateAction(
      jsonRequest(`${ENDPOINT}/${action.id}`, "PATCH", { enabled: false, delayMinutes: 45 }),
      routeParams({ id: action.id }),
    );
    expect(patched.status).toBe(200);
    const updated = (await patched.json()) as { action: StageAction };
    expect(updated.action.enabled).toBe(false);
    expect(updated.action.delayMinutes).toBe(45);

    const removed = await deleteAction(
      getRequest(`${ENDPOINT}/${action.id}`),
      routeParams({ id: action.id }),
    );
    expect(removed.status).toBe(200);

    const gone = await getAction(
      getRequest(`${ENDPOINT}/${action.id}`),
      routeParams({ id: action.id }),
    );
    expect(gone.status).toBe(404);
  });

  it("refuses a patch that sets a field the action's type does not carry", async () => {
    const { pipeline } = await newWorld();

    const { body } = await create({
      positionStageId: pipeline.stageOneId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
    });
    const action = body.action as StageAction;

    const response = await updateAction(
      jsonRequest(`${ENDPOINT}/${action.id}`, "PATCH", {
        targetPositionStageId: pipeline.stageTwoId,
      }),
      routeParams({ id: action.id }),
    );

    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toContain("does not carry");
  });

  it("404s a patch and a get against an id that does not exist", async () => {
    const missing = crypto.randomUUID();

    expect(
      (
        await updateAction(
          jsonRequest(`${ENDPOINT}/${missing}`, "PATCH", { enabled: false }),
          routeParams({ id: missing }),
        )
      ).status,
    ).toBe(404);

    expect(
      (await getAction(getRequest(`${ENDPOINT}/${missing}`), routeParams({ id: missing }))).status,
    ).toBe(404);
  });
});

describe("the producer runs on every stage change, not in the UI", () => {
  it("queues a stage's enabled actions when a candidate is moved into it", async () => {
    const { fixture, pipeline } = await newWorld();

    await create({
      positionStageId: pipeline.stageTwoId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
      delayMinutes: 60,
    });
    await create({
      positionStageId: pipeline.stageTwoId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
      delayMinutes: 0,
      enabled: false,
    });

    expect(await moveTo(fixture.applicationId, pipeline.stageTwoId)).toBe(200);

    const queued = onlyQueuedAction(
      await queuedActionsFor(session.supabase, fixture.applicationId),
    );
    expect(queued.status).toBe("pending");
    expect(queued.origin_stage_id).toBe(pipeline.stageTwoId);

    const dueInMinutes = (new Date(queued.scheduled_for).getTime() - Date.now()) / 60_000;
    expect(dueInMinutes).toBeGreaterThan(55);
    expect(dueInMinutes).toBeLessThan(61);
  });

  it("cancels the pending work when the candidate is moved out again", async () => {
    const { fixture, pipeline } = await newWorld();

    await create({
      positionStageId: pipeline.stageTwoId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
      delayMinutes: 60,
    });

    await moveTo(fixture.applicationId, pipeline.stageTwoId);
    await moveTo(fixture.applicationId, pipeline.stageThreeId);

    const queued = onlyQueuedAction(
      await queuedActionsFor(session.supabase, fixture.applicationId),
    );
    expect(queued.status).toBe("cancelled");
  });

  it("re-fires an action that never ran when the candidate comes back to the stage", async () => {
    const { fixture, pipeline } = await newWorld();

    await create({
      positionStageId: pipeline.stageTwoId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
      delayMinutes: 60,
    });

    await moveTo(fixture.applicationId, pipeline.stageTwoId);
    await moveTo(fixture.applicationId, pipeline.stageThreeId);
    await moveTo(fixture.applicationId, pipeline.stageTwoId);

    // The first run was cancelled by the move out before it could send, so
    // coming back queues it again; the cancelled row stays as history.
    const rows = await queuedActionsFor(session.supabase, fixture.applicationId);
    expect(rows.map((row) => row.status).sort()).toEqual(["cancelled", "pending"]);
  });

  it("queues nothing for a stage that has no actions", async () => {
    const { fixture, pipeline } = await newWorld();

    await moveTo(fixture.applicationId, pipeline.stageOneId);

    expect(await queuedActionsFor(session.supabase, fixture.applicationId)).toHaveLength(0);
  });

  it("cancels pending work when the stage action itself is deleted", async () => {
    const { fixture, pipeline } = await newWorld();

    const { body } = await create({
      positionStageId: pipeline.stageTwoId,
      type: "send_email",
      messageTemplateId: pipeline.templateId,
      delayMinutes: 60,
    });
    const action = body.action as StageAction;

    await moveTo(fixture.applicationId, pipeline.stageTwoId);
    expect(
      onlyQueuedAction(await queuedActionsFor(session.supabase, fixture.applicationId)).status,
    ).toBe("pending");

    await deleteAction(getRequest(`${ENDPOINT}/${action.id}`), routeParams({ id: action.id }));

    expect(
      onlyQueuedAction(await queuedActionsFor(session.supabase, fixture.applicationId)).status,
    ).toBe("cancelled");
  });
});
