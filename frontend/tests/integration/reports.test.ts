import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const { cookieJar } = await import("./_cookie-jar");
  return { cookies: async () => cookieJar };
});

import { GET as getReport } from "@/app/api/reports/route";
import type { MonthlyReport } from "@/types/api";
import {
  currentCookies,
  getRequest,
  restoreSession,
  signInTestUser,
  signOutForRequest,
  type L3Session,
} from "./_harness";

const ENDPOINT = "http://localhost:3000/api/reports";

const BUSY_MONTH = "2097-04";
const QUIET_MONTH = "2097-06";
const PREVIOUS_MONTH = "2097-03";

const ALPHA_TITLE = "L3 Reporting Alpha";
const BETA_TITLE = "L3 Reporting Beta";

let session: L3Session;
let sessionCookies: { name: string; value: string }[];

const seededPeople: string[] = [];
const seededPositions: string[] = [];
const seededPipelines: string[] = [];

type Stages = {
  applied: string;
  interview: string;
  hired: string;
  rejected: string;
};

let alphaId = "";
let betaId = "";
let alphaStages: Stages;
let betaApplied = "";
let betaRejected = "";

async function fetchReport(month?: string) {
  const url = month ? `${ENDPOINT}?month=${month}` : ENDPOINT;
  const response = await getReport(getRequest(url));
  const body = (await response.json()) as { report?: MonthlyReport; error?: string };
  return { status: response.status, body };
}

async function seedPosition(title: string, pipelineId: string): Promise<string> {
  const { data, error } = await session.supabase
    .from("positions")
    .insert({
      title,
      slug: `l3-reporting-${crypto.randomUUID()}`,
      status: "open",
      assigned_pipeline_id: pipelineId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seed position: ${error?.message}`);
  seededPositions.push(data.id);
  return data.id;
}

async function seedStage(positionId: string, name: string, sortOrder: number): Promise<string> {
  const { data, error } = await session.supabase
    .from("position_stages")
    .insert({ position_id: positionId, name, sort_order: sortOrder })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seed stage: ${error?.message}`);
  return data.id;
}

async function seedApplication(
  positionId: string,
  stageId: string | null,
  appliedAt: string,
  status: "active" | "archived" = "active",
): Promise<void> {
  const { data: person, error: personError } = await session.supabase
    .from("people")
    .insert({
      first_name: "L3",
      last_name: "Reporting",
      email: `l3-reporting-${crypto.randomUUID()}@example.com`,
    })
    .select("id")
    .single();
  if (personError || !person) throw new Error(`seed person: ${personError?.message}`);
  seededPeople.push(person.id);

  const { error } = await session.supabase.from("applications").insert({
    person_id: person.id,
    position_id: positionId,
    current_stage_id: stageId,
    applied_at: appliedAt,
    status,
  });
  if (error) throw new Error(`seed application: ${error.message}`);
}

async function sweepStaleFixtures() {
  await session.supabase.from("people").delete().like("email", "l3-reporting-%@example.com");
  await session.supabase.from("positions").delete().like("slug", "l3-reporting-%");
}

beforeAll(async () => {
  session = await signInTestUser();
  sessionCookies = currentCookies();

  await sweepStaleFixtures();

  const { data: pipeline, error: pipelineError } = await session.supabase
    .from("pipelines")
    .insert({ name: `L3 reporting pipeline ${crypto.randomUUID()}`, is_template: true })
    .select("id")
    .single();
  if (pipelineError || !pipeline) throw new Error(`seed pipeline: ${pipelineError?.message}`);
  seededPipelines.push(pipeline.id);

  alphaId = await seedPosition(ALPHA_TITLE, pipeline.id);
  betaId = await seedPosition(BETA_TITLE, pipeline.id);

  alphaStages = {
    applied: await seedStage(alphaId, "Applied", 1),
    interview: await seedStage(alphaId, "Interview", 2),
    hired: await seedStage(alphaId, "Hired", 3),
    rejected: await seedStage(alphaId, "Rejected", 4),
  };
  betaApplied = await seedStage(betaId, "Applied", 1);
  betaRejected = await seedStage(betaId, "Rejected", 2);

  await seedApplication(alphaId, alphaStages.applied, "2097-04-01T00:00:00Z");
  await seedApplication(alphaId, alphaStages.applied, "2097-04-07T23:59:59Z");
  await seedApplication(alphaId, alphaStages.interview, "2097-04-08T09:00:00Z");
  await seedApplication(alphaId, alphaStages.hired, "2097-04-15T09:00:00Z");
  await seedApplication(alphaId, alphaStages.rejected, "2097-04-22T09:00:00Z");
  await seedApplication(alphaId, alphaStages.applied, "2097-04-30T23:59:59Z", "archived");
  await seedApplication(alphaId, null, "2097-04-29T09:00:00Z");
  await seedApplication(betaId, betaApplied, "2097-04-05T09:00:00Z");
  await seedApplication(betaId, betaRejected, "2097-04-10T09:00:00Z");

  await seedApplication(alphaId, alphaStages.applied, "2097-03-31T23:59:59Z");
  await seedApplication(alphaId, alphaStages.applied, "2097-05-01T00:00:00Z");
});

afterEach(() => {
  restoreSession(sessionCookies);
});

afterAll(async () => {
  restoreSession(sessionCookies);
  if (seededPeople.length > 0) {
    await session.supabase.from("people").delete().in("id", seededPeople);
  }
  if (seededPositions.length > 0) {
    await session.supabase.from("positions").delete().in("id", seededPositions);
  }
  if (seededPipelines.length > 0) {
    await session.supabase.from("pipelines").delete().in("id", seededPipelines);
  }
});

describe("the report is auth-gated", () => {
  it("401s without a session", async () => {
    signOutForRequest();
    const response = await getReport(getRequest(ENDPOINT));
    expect(response.status).toBe(401);
  });
});

describe("the month query parameter", () => {
  it.each(["2097-13", "2097-00", "2097-4", "April 2097", "2097-04-01", "'; drop table --"])(
    "422s %s rather than guessing what was meant",
    async (month) => {
      const { status } = await fetchReport(encodeURIComponent(month));
      expect(status).toBe(422);
    },
  );

  it("defaults to the current UTC month when none is given", async () => {
    const { status, body } = await fetchReport();
    expect(status).toBe(200);

    const now = new Date();
    const expected = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    expect(body.report?.month).toBe(expected);
  });

  it("echoes back the month it answered for", async () => {
    const { body } = await fetchReport(BUSY_MONTH);
    expect(body.report?.month).toBe(BUSY_MONTH);
  });

  it("always offers the answered month in the dropdown, newest month first", async () => {
    const { body } = await fetchReport(QUIET_MONTH);
    const months = body.report?.availableMonths ?? [];

    expect(months).toContain(QUIET_MONTH);
    expect(months).toContain(BUSY_MONTH);
    expect([...months].sort().reverse()).toEqual(months);
    expect(new Set(months).size).toBe(months.length);
  });
});

describe("the month filter drives every figure", () => {
  it("returns the KPI figures for the seeded month", async () => {
    const { status, body } = await fetchReport(BUSY_MONTH);
    expect(status).toBe(200);

    expect(body.report?.totals).toEqual({ applicationsReceived: 9, archived: 1 });
  });

  it("counts an application on the first instant of the month and excludes the one before it", async () => {
    const busy = await fetchReport(BUSY_MONTH);
    const previous = await fetchReport(PREVIOUS_MONTH);

    expect(busy.body.report?.totals.applicationsReceived).toBe(9);
    expect(previous.body.report?.totals.applicationsReceived).toBe(1);
  });

  it("splits the month into four week buckets that sum to the total", async () => {
    const { body } = await fetchReport(BUSY_MONTH);
    const weeks = body.report?.weeks ?? [];

    expect(weeks.map((week) => week.weekNumber)).toEqual([1, 2, 3, 4]);
    expect(weeks.map((week) => week.applicationsReceived)).toEqual([3, 2, 1, 3]);
    expect(weeks.reduce((sum, week) => sum + week.applicationsReceived, 0)).toBe(
      body.report?.totals.applicationsReceived,
    );
  });

  it("nests each position's own stages under it, in that position's pipeline order", async () => {
    const { body } = await fetchReport(BUSY_MONTH);
    const positions = body.report?.positions ?? [];

    const alpha = positions.find((position) => position.positionId === alphaId);
    expect(alpha?.stages.map((stage) => stage.name)).toEqual([
      "Applied",
      "Interview",
      "Hired",
      "Rejected",
      "No stage",
    ]);
    expect(alpha?.stages.map((stage) => stage.applications)).toEqual([2, 1, 1, 1, 1]);

    const beta = positions.find((position) => position.positionId === betaId);
    expect(beta?.stages.map((stage) => stage.name)).toEqual(["Applied", "Rejected"]);
    expect(beta?.stages.map((stage) => stage.applications)).toEqual([1, 1]);
  });

  it("keeps two positions' identically named stages apart rather than merging them", async () => {
    const { body } = await fetchReport(BUSY_MONTH);
    const positions = body.report?.positions ?? [];

    const alphaApplied = positions
      .find((position) => position.positionId === alphaId)
      ?.stages.find((stage) => stage.name === "Applied");
    const betaApplied = positions
      .find((position) => position.positionId === betaId)
      ?.stages.find((stage) => stage.name === "Applied");

    expect(alphaApplied?.applications).toBe(2);
    expect(betaApplied?.applications).toBe(1);
    expect(alphaApplied?.stageId).not.toBe(betaApplied?.stageId);
  });

  it("marks the unstaged bucket with a null stage id rather than dropping it", async () => {
    const { body } = await fetchReport(BUSY_MONTH);
    const alpha = (body.report?.positions ?? []).find(
      (position) => position.positionId === alphaId,
    );

    const unstaged = alpha?.stages.find((stage) => stage.name === "No stage");
    expect(unstaged?.applications).toBe(1);
    expect(unstaged?.stageId).toBeNull();
  });
});

describe("breakdown by position", () => {
  it("lists the busiest position first, summing to applications received", async () => {
    const { body } = await fetchReport(BUSY_MONTH);
    const positions = body.report?.positions ?? [];

    expect(positions.map((position) => position.title)).toEqual([ALPHA_TITLE, BETA_TITLE]);
    expect(positions.map((position) => position.applicationsReceived)).toEqual([7, 2]);

    const sum = positions.reduce((total, position) => total + position.applicationsReceived, 0);
    expect(sum).toBe(body.report?.totals.applicationsReceived);
  });

  it("counts an archived application in the headline but on no stage bar", async () => {
    const { body } = await fetchReport(BUSY_MONTH);
    const totals = body.report?.totals;
    const positions = body.report?.positions ?? [];

    const staged = positions.reduce(
      (total, position) =>
        total + position.stages.reduce((inner, stage) => inner + stage.applications, 0),
      0,
    );

    expect(staged).toBe(8);
    expect(staged).toBe((totals?.applicationsReceived ?? 0) - (totals?.archived ?? 0));
  });

  it("carries a position id, so a card can be keyed without relying on the title", async () => {
    const { body } = await fetchReport(BUSY_MONTH);
    const ids = (body.report?.positions ?? []).map((position) => position.positionId);
    expect(ids).toContain(alphaId);
    expect(ids).toContain(betaId);
  });
});

describe("a month with nothing in it", () => {
  it("returns zeroes rather than nulls, so no card can render NaN", async () => {
    const { status, body } = await fetchReport(QUIET_MONTH);
    expect(status).toBe(200);
    expect(body.report?.totals).toEqual({ applicationsReceived: 0, archived: 0 });
  });

  it("still returns four zero week bars, so the chart cannot lose a bar", async () => {
    const { body } = await fetchReport(QUIET_MONTH);
    expect(body.report?.weeks).toEqual([
      { weekNumber: 1, applicationsReceived: 0 },
      { weekNumber: 2, applicationsReceived: 0 },
      { weekNumber: 3, applicationsReceived: 0 },
      { weekNumber: 4, applicationsReceived: 0 },
    ]);
  });

  it("returns no position cards at all, which is the screen's empty state", async () => {
    const { body } = await fetchReport(QUIET_MONTH);
    expect(body.report?.positions).toEqual([]);
  });
});
