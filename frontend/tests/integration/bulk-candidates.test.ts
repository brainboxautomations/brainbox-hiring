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

import type { SupabaseClient } from "@supabase/supabase-js";

import { POST as bulkUpdate } from "@/app/api/applications/bulk/route";
import { POST as exportCandidates } from "@/app/api/applications/export/route";
import { POST as bulkEmail } from "@/app/api/applications/bulk-email/route";
import type {
  BulkCandidateEmailResult,
  BulkCandidateUpdateResult,
  CandidateExportRecord,
} from "@/types/api";
import { resetTransport, sentEmails } from "./_email-transport-mock";
import type { Database } from "@/types/database.types";
import {
  currentCookies,
  jsonRequest,
  restoreSession,
  signInTestUser,
  signOutForRequest,
  type L3Session,
} from "./_harness";

const BULK_ENDPOINT = "http://localhost:3000/api/applications/bulk";
const EXPORT_ENDPOINT = "http://localhost:3000/api/applications/export";
const BULK_EMAIL_ENDPOINT = "http://localhost:3000/api/applications/bulk-email";

type SeededPosition = {
  positionId: string;
  pipelineId: string;
  personIds: string[];
  applicationIds: string[];
  stageIds: string[];
  cleanup: () => Promise<void>;
};

async function seedPosition(
  supabase: SupabaseClient<Database>,
  options: { stageNames: string[]; candidateCount: number; formAnswers?: Record<string, string> },
): Promise<SeededPosition> {
  const suffix = crypto.randomUUID();

  const { data: pipeline, error: pipelineError } = await supabase
    .from("pipelines")
    .insert({ name: `L3 bulk pipeline ${suffix}`, is_template: true })
    .select("id")
    .single();
  if (pipelineError || !pipeline) throw new Error(`seed pipeline: ${pipelineError?.message}`);

  const { data: position, error: positionError } = await supabase
    .from("positions")
    .insert({
      title: `L3 Bulk Position ${suffix}`,
      slug: `l3-bulk-${suffix}`,
      department: "Engineering",
      assigned_pipeline_id: pipeline.id,
    })
    .select("id")
    .single();
  if (positionError || !position) throw new Error(`seed position: ${positionError?.message}`);

  const { data: stages, error: stageError } = await supabase
    .from("position_stages")
    .insert(
      options.stageNames.map((name, index) => ({
        position_id: position.id,
        name,
        sort_order: index + 1,
      })),
    )
    .select("id, sort_order");
  if (stageError || !stages) throw new Error(`seed stages: ${stageError?.message}`);

  const orderedStageIds = stages
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((stage) => stage.id);

  const personIds: string[] = [];
  const applicationIds: string[] = [];

  for (let index = 0; index < options.candidateCount; index += 1) {
    const { data: person, error: personError } = await supabase
      .from("people")
      .insert({
        first_name: `Candidate${index}`,
        last_name: "Bulk",
        email: `l3-bulk-${index}-${suffix}@example.com`,
        phone: `+44 20 7946 08${index}0`,
        custom_attributes: {},
      })
      .select("id")
      .single();
    if (personError || !person) throw new Error(`seed person: ${personError?.message}`);
    personIds.push(person.id);

    const { data: application, error: applicationError } = await supabase
      .from("applications")
      .insert({
        person_id: person.id,
        position_id: position.id,
        current_stage_id: orderedStageIds[0]!,
        application_form_answers: options.formAnswers ?? {},
      })
      .select("id")
      .single();
    if (applicationError || !application) {
      throw new Error(`seed application: ${applicationError?.message}`);
    }
    applicationIds.push(application.id);
  }

  return {
    positionId: position.id,
    pipelineId: pipeline.id,
    personIds,
    applicationIds,
    stageIds: orderedStageIds,
    cleanup: async () => {
      await supabase.from("applications").delete().in("id", applicationIds);
      await supabase.from("position_stages").delete().in("id", orderedStageIds);
      await supabase.from("positions").delete().eq("id", position.id);
      await supabase.from("pipelines").delete().eq("id", pipeline.id);
      await supabase.from("people").delete().in("id", personIds);
    },
  };
}

let session: L3Session;
let sessionCookies: { name: string; value: string }[];
let main: SeededPosition;
let other: SeededPosition;

async function runBulk(body: unknown) {
  const response = await bulkUpdate(jsonRequest(BULK_ENDPOINT, "POST", body));
  return {
    status: response.status,
    body: (await response.json()) as Partial<BulkCandidateUpdateResult> & { error?: string },
  };
}

async function runExport(body: unknown) {
  const response = await exportCandidates(jsonRequest(EXPORT_ENDPOINT, "POST", body));
  return {
    status: response.status,
    body: (await response.json()) as {
      records?: CandidateExportRecord[];
      missingIds?: string[];
      error?: string;
    },
  };
}

async function readApplication(applicationId: string) {
  const { data } = await session.supabase
    .from("applications")
    .select("id, current_stage_id, status")
    .eq("id", applicationId)
    .single();
  return data;
}

async function resetApplications() {
  await session.supabase
    .from("applications")
    .update({ current_stage_id: main.stageIds[0]!, status: "active" })
    .in("id", main.applicationIds);
}

beforeAll(async () => {
  session = await signInTestUser();
  sessionCookies = currentCookies();

  main = await seedPosition(session.supabase, {
    stageNames: ["Applied", "Shortlist"],
    candidateCount: 3,
    formAnswers: { phone: "+44 20 7946 0000", cover_letter: "Hello, world" },
  });
  other = await seedPosition(session.supabase, {
    stageNames: ["Screening"],
    candidateCount: 1,
  });
});

afterEach(async () => {
  restoreSession(sessionCookies);
});

afterAll(async () => {
  restoreSession(sessionCookies);
  await main.cleanup();
  await other.cleanup();
});

describe("bulk candidate actions are auth-gated", () => {
  it("401s a bulk update without a session", async () => {
    signOutForRequest();
    const { status } = await runBulk({
      applicationIds: [crypto.randomUUID()],
      patch: { status: "archived" },
    });
    expect(status).toBe(401);
  });

  it("401s an export without a session", async () => {
    signOutForRequest();
    const { status } = await runExport({ applicationIds: [crypto.randomUUID()] });
    expect(status).toBe(401);
  });
});

describe("bulk candidate update validation", () => {
  it("400s invalid JSON", async () => {
    const response = await bulkUpdate(
      new Request(BULK_ENDPOINT, { method: "POST", body: "not json" }) as never,
    );
    expect(response.status).toBe(400);
  });

  it("422s an empty selection", async () => {
    const { status } = await runBulk({ applicationIds: [], patch: { status: "archived" } });
    expect(status).toBe(422);
  });

  it("422s an id that is not a uuid", async () => {
    const { status } = await runBulk({ applicationIds: ["nope"], patch: { status: "archived" } });
    expect(status).toBe(422);
  });

  it("422s a patch that asks for nothing", async () => {
    const { status, body } = await runBulk({
      applicationIds: [main.applicationIds[0]!],
      patch: {},
    });
    expect(status).toBe(422);
    expect(body.error).toContain("Choose a stage");
  });

  it("422s a stage that does not exist at all", async () => {
    const { status, body } = await runBulk({
      applicationIds: [main.applicationIds[0]!],
      patch: { stageId: crypto.randomUUID() },
    });
    expect(status).toBe(422);
    expect(body.error).toBe("That stage does not exist");
  });
});

describe("bulk move to stage", () => {
  afterEach(resetApplications);

  it("moves every selected candidate in one request", async () => {
    const { status, body } = await runBulk({
      applicationIds: main.applicationIds,
      patch: { stageId: main.stageIds[1]! },
    });

    expect(status).toBe(200);
    expect(body.updated).toHaveLength(3);
    expect(body.failures).toEqual([]);

    for (const applicationId of main.applicationIds) {
      expect((await readApplication(applicationId))?.current_stage_id).toBe(main.stageIds[1]!);
    }
  });

  it("returns the moved candidates already carrying their new stage", async () => {
    const { body } = await runBulk({
      applicationIds: [main.applicationIds[0]!],
      patch: { stageId: main.stageIds[1]! },
    });

    expect(body.updated?.[0]?.stageId).toBe(main.stageIds[1]!);
  });

  it("refuses per candidate when the stage belongs to another position", async () => {
    const { status, body } = await runBulk({
      applicationIds: main.applicationIds,
      patch: { stageId: other.stageIds[0]! },
    });

    expect(status).toBe(200);
    expect(body.updated).toEqual([]);
    expect(body.failures).toHaveLength(3);
    expect(body.failures?.[0]?.reason).toBe("That stage belongs to a different position");
    expect((await readApplication(main.applicationIds[0]!))?.current_stage_id).toBe(
      main.stageIds[0]!,
    );
  });

  it("moves the candidates it can and names the ones it cannot (partial failure)", async () => {
    const missingId = crypto.randomUUID();
    const { status, body } = await runBulk({
      applicationIds: [main.applicationIds[0]!, missingId],
      patch: { stageId: main.stageIds[1]! },
    });

    expect(status).toBe(200);
    expect(body.updated).toHaveLength(1);
    expect(body.updated?.[0]?.id).toBe(main.applicationIds[0]!);
    expect(body.failures).toEqual([{ applicationId: missingId, reason: "Candidate not found" }]);
  });

  it("leaves the successful moves applied when part of the batch fails", async () => {
    await runBulk({
      applicationIds: [main.applicationIds[0]!, crypto.randomUUID()],
      patch: { stageId: main.stageIds[1]! },
    });

    expect((await readApplication(main.applicationIds[0]!))?.current_stage_id).toBe(
      main.stageIds[1]!,
    );
  });

  it("treats a repeated id as one candidate rather than acting twice", async () => {
    const { body } = await runBulk({
      applicationIds: [main.applicationIds[0]!, main.applicationIds[0]!],
      patch: { stageId: main.stageIds[1]! },
    });

    expect(body.updated).toHaveLength(1);
    expect(body.failures).toEqual([]);
  });

  it("mixes candidates from two positions and only fails the ineligible one", async () => {
    const { body } = await runBulk({
      applicationIds: [main.applicationIds[0]!, other.applicationIds[0]!],
      patch: { stageId: main.stageIds[1]! },
    });

    expect(body.updated).toHaveLength(1);
    expect(body.updated?.[0]?.id).toBe(main.applicationIds[0]!);
    expect(body.failures?.[0]?.applicationId).toBe(other.applicationIds[0]!);
  });
});

describe("bulk archive", () => {
  afterEach(resetApplications);

  it("archives every selected candidate", async () => {
    const { status, body } = await runBulk({
      applicationIds: main.applicationIds,
      patch: { status: "archived" },
    });

    expect(status).toBe(200);
    expect(body.updated).toHaveLength(3);
    expect(body.updated?.every((candidate) => candidate.archived)).toBe(true);
    expect((await readApplication(main.applicationIds[0]!))?.status).toBe("archived");
  });

  it("archives without touching the stage", async () => {
    await runBulk({ applicationIds: [main.applicationIds[0]!], patch: { status: "archived" } });

    expect((await readApplication(main.applicationIds[0]!))?.current_stage_id).toBe(
      main.stageIds[0]!,
    );
  });

  it("un-archives through the same route", async () => {
    await runBulk({ applicationIds: [main.applicationIds[0]!], patch: { status: "archived" } });
    const { body } = await runBulk({
      applicationIds: [main.applicationIds[0]!],
      patch: { status: "active" },
    });

    expect(body.updated?.[0]?.archived).toBe(false);
  });
});

describe("bulk export", () => {
  it("422s an empty selection", async () => {
    const { status } = await runExport({ applicationIds: [] });
    expect(status).toBe(422);
  });

  it("400s invalid JSON", async () => {
    const response = await exportCandidates(
      new Request(EXPORT_ENDPOINT, { method: "POST", body: "not json" }) as never,
    );
    expect(response.status).toBe(400);
  });

  it("returns one record per selected candidate", async () => {
    const { status, body } = await runExport({ applicationIds: main.applicationIds });

    expect(status).toBe(200);
    expect(body.records).toHaveLength(3);
    expect(body.missingIds).toEqual([]);
  });

  it("carries the contact details, position, stage and answers the design promises", async () => {
    const { body } = await runExport({ applicationIds: [main.applicationIds[0]!] });
    const record = body.records?.[0];

    expect(record?.email).toContain("@example.com");
    expect(record?.phone).toMatch(/^\+44/);
    expect(record?.positionTitle).toContain("L3 Bulk Position");
    expect(record?.stageName).toBe("Applied");
    expect(record?.formAnswers).toEqual({
      phone: "+44 20 7946 0000",
      cover_letter: "Hello, world",
    });
  });

  it("names the ids it could not read instead of quietly shortening the export", async () => {
    const missingId = crypto.randomUUID();
    const { body } = await runExport({
      applicationIds: [main.applicationIds[0]!, missingId],
    });

    expect(body.records).toHaveLength(1);
    expect(body.missingIds).toEqual([missingId]);
  });

  it("does not export a candidate twice for a repeated id", async () => {
    const { body } = await runExport({
      applicationIds: [main.applicationIds[0]!, main.applicationIds[0]!],
    });

    expect(body.records).toHaveLength(1);
    expect(body.missingIds).toEqual([]);
  });
});

describe("bulk send email", () => {
  let templateId: string;

  beforeAll(async () => {
    const { data, error } = await session.supabase
      .from("message_templates")
      .insert({
        name: `L3 bulk template ${crypto.randomUUID()}`,
        subject: "About {{position.title}}",
        body: "Hi {{candidate.first_name}}, a quick update.",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed template: ${error?.message}`);
    templateId = data.id;
  });

  afterAll(async () => {
    await session.supabase.from("message_templates").delete().eq("id", templateId);
  });

  async function runBulkEmail(body: unknown) {
    resetTransport();
    const response = await bulkEmail(jsonRequest(BULK_EMAIL_ENDPOINT, "POST", body));
    return { status: response.status, body: (await response.json()) as BulkCandidateEmailResult };
  }

  it("401s without a session", async () => {
    signOutForRequest();
    const response = await bulkEmail(
      jsonRequest(BULK_EMAIL_ENDPOINT, "POST", {
        applicationIds: [crypto.randomUUID()],
        messageTemplateId: crypto.randomUUID(),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("sends one individual message per candidate, with nobody CC'd", async () => {
    const { status, body } = await runBulkEmail({
      applicationIds: main.applicationIds,
      messageTemplateId: templateId,
    });

    expect(status).toBe(200);
    expect(body.sent).toHaveLength(main.applicationIds.length);
    expect(body.failures).toEqual([]);

    const emails = sentEmails();
    expect(emails).toHaveLength(main.applicationIds.length);
    expect(new Set(emails.map((email) => email.to)).size).toBe(main.applicationIds.length);
    for (const email of emails) {
      expect(email.cc).toEqual([]);
      expect(email.bcc).toEqual([]);
    }
  });

  it("resolves merge variables through the one send path", async () => {
    const { body } = await runBulkEmail({
      applicationIds: [main.applicationIds[0]!],
      messageTemplateId: templateId,
    });

    expect(body.sent).toHaveLength(1);
    const email = sentEmails()[0];
    expect(email?.subject).not.toContain("{{");
    expect(email?.html).not.toContain("{{");
  });

  it("names the candidates it could not reach rather than failing the whole batch", async () => {
    const missingId = crypto.randomUUID();
    const { status, body } = await runBulkEmail({
      applicationIds: [main.applicationIds[0]!, missingId],
      messageTemplateId: templateId,
    });

    expect(status).toBe(200);
    expect(body.sent).toEqual([main.applicationIds[0]!]);
    expect(body.failures).toEqual([{ applicationId: missingId, reason: "Candidate not found" }]);
  });

  it("does not email the same candidate twice for a repeated id", async () => {
    const { body } = await runBulkEmail({
      applicationIds: [main.applicationIds[0]!, main.applicationIds[0]!],
      messageTemplateId: templateId,
    });

    expect(body.sent).toHaveLength(1);
    expect(sentEmails()).toHaveLength(1);
  });

  it("422s a template that does not exist rather than sending anything", async () => {
    const { status } = await runBulkEmail({
      applicationIds: [main.applicationIds[0]!],
      messageTemplateId: crypto.randomUUID(),
    });

    expect(status).toBe(422);
    expect(sentEmails()).toHaveLength(0);
  });

  it("422s an empty selection", async () => {
    const { status } = await runBulkEmail({ applicationIds: [], messageTemplateId: templateId });
    expect(status).toBe(422);
  });
});
