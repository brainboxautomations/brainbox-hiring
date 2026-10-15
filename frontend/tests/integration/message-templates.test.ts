import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const { cookieJar } = await import("./_cookie-jar");
  return { cookies: async () => cookieJar };
});

import { GET as listTemplates, POST as createTemplate } from "@/app/api/message-templates/route";
import {
  DELETE as deleteTemplate,
  GET as getTemplate,
  PATCH as updateTemplate,
} from "@/app/api/message-templates/[id]/route";
import type { MessageTemplate } from "@/types/api";
import {
  currentCookies,
  getRequest,
  jsonRequest,
  restoreSession,
  routeParams,
  signInTestUser,
  signOutForRequest,
  type L3Session,
} from "./_harness";

const ENDPOINT = "http://localhost:3000/api/message-templates";

let session: L3Session;
let sessionCookies: { name: string; value: string }[];
const created: string[] = [];

async function create(input: Record<string, unknown>) {
  const response = await createTemplate(jsonRequest(ENDPOINT, "POST", input));
  const body = (await response.json()) as { template?: MessageTemplate; error?: string };
  if (body.template) created.push(body.template.id);
  return { status: response.status, body };
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
  if (created.length > 0) {
    await session.supabase.from("message_templates").delete().in("id", created);
  }
});

describe("message templates are auth-gated", () => {
  it("401s the list without a session", async () => {
    signOutForRequest();
    expect((await listTemplates()).status).toBe(401);
  });

  it("401s a create without a session", async () => {
    signOutForRequest();
    const response = await createTemplate(jsonRequest(ENDPOINT, "POST", { name: "x" }));
    expect(response.status).toBe(401);
  });

  it("401s a delete without a session", async () => {
    signOutForRequest();
    const response = await deleteTemplate(
      getRequest(`${ENDPOINT}/${crypto.randomUUID()}`),
      routeParams({ id: crypto.randomUUID() }),
    );
    expect(response.status).toBe(401);
  });
});

describe("message template CRUD", () => {
  it("rejects a template with no name", async () => {
    const { status } = await create({ name: "  ", subject: "s", body: "b" });
    expect(status).toBe(422);
  });

  it("rejects invalid JSON", async () => {
    const response = await createTemplate(
      new Request(ENDPOINT, { method: "POST", body: "not json" }) as never,
    );
    expect(response.status).toBe(400);
  });

  it("creates a template and reads it back", async () => {
    const name = `L3 interview invite ${crypto.randomUUID()}`;
    const { status, body } = await create({
      name,
      subject: "You're invited to interview at {{position.title}}",
      body: "Hi {{candidate.first_name}}",
    });

    expect(status).toBe(201);
    const template = body.template as MessageTemplate;
    expect(template.name).toBe(name);
    expect(template.subject).toContain("{{position.title}}");

    const readResponse = await getTemplate(
      getRequest(`${ENDPOINT}/${template.id}`),
      routeParams({ id: template.id }),
    );
    expect(readResponse.status).toBe(200);
    const read = (await readResponse.json()) as { template: MessageTemplate };
    expect(read.template.body).toBe("Hi {{candidate.first_name}}");
  });

  it("stores the merge tokens unresolved, because a template has no candidate yet", async () => {
    const { body } = await create({
      name: `L3 tokens ${crypto.randomUUID()}`,
      subject: "Hi {{candidate.first_name}}",
      body: "{{company.name}}",
    });
    expect((body.template as MessageTemplate).subject).toBe("Hi {{candidate.first_name}}");
  });

  it("defaults a missing subject and body to empty strings", async () => {
    const { status, body } = await create({ name: `L3 bare ${crypto.randomUUID()}` });
    expect(status).toBe(201);
    expect((body.template as MessageTemplate).subject).toBe("");
    expect((body.template as MessageTemplate).body).toBe("");
  });

  it("updates a template and moves it to the top of the list", async () => {
    const { body } = await create({ name: `L3 update ${crypto.randomUUID()}`, subject: "before" });
    const template = body.template as MessageTemplate;

    const response = await updateTemplate(
      jsonRequest(`${ENDPOINT}/${template.id}`, "PATCH", {
        name: template.name,
        subject: "after",
        body: "changed",
      }),
      routeParams({ id: template.id }),
    );

    expect(response.status).toBe(200);
    const updated = (await response.json()) as { template: MessageTemplate };
    expect(updated.template.subject).toBe("after");
    expect(updated.template.body).toBe("changed");
    expect(new Date(updated.template.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(template.updatedAt).getTime(),
    );

    const listResponse = await listTemplates();
    const { templates } = (await listResponse.json()) as { templates: MessageTemplate[] };
    expect(templates[0]?.id).toBe(template.id);
  });

  it("404s a patch against an id that does not exist", async () => {
    const missing = crypto.randomUUID();
    const response = await updateTemplate(
      jsonRequest(`${ENDPOINT}/${missing}`, "PATCH", { name: "x" }),
      routeParams({ id: missing }),
    );
    expect(response.status).toBe(404);
  });

  it("404s a get against an id that does not exist", async () => {
    const missing = crypto.randomUUID();
    const response = await getTemplate(
      getRequest(`${ENDPOINT}/${missing}`),
      routeParams({ id: missing }),
    );
    expect(response.status).toBe(404);
  });

  it("deletes a template", async () => {
    const { body } = await create({ name: `L3 delete ${crypto.randomUUID()}` });
    const template = body.template as MessageTemplate;

    const response = await deleteTemplate(
      getRequest(`${ENDPOINT}/${template.id}`),
      routeParams({ id: template.id }),
    );
    expect(response.status).toBe(200);

    const readResponse = await getTemplate(
      getRequest(`${ENDPOINT}/${template.id}`),
      routeParams({ id: template.id }),
    );
    expect(readResponse.status).toBe(404);
  });
});
