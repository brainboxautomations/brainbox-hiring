import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const { cookieJar } = await import("./_cookie-jar");
  return { cookies: async () => cookieJar };
});

import { GET as getSlackSettings } from "@/app/api/settings/slack/route";
import { GET as getTeamMembers } from "@/app/api/settings/users/route";
import { GET as getEmailSettings } from "@/app/api/settings/email/route";
import type { EmailSettings, SlackSettings, TeamMember } from "@/types/api";
import { currentCookies, restoreSession, signInTestUser, signOutForRequest } from "./_harness";

let sessionCookies: { name: string; value: string }[];

async function readJson(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  await signInTestUser();
  sessionCookies = currentCookies();
});

describe("GET /api/settings/slack", () => {
  it("reports the channel and whether a token exists, and never the token itself", async () => {
    restoreSession(sessionCookies);
    const { status, body } = await readJson(await getSlackSettings());

    expect(status).toBe(200);

    const slack = body.slack as SlackSettings;
    expect(typeof slack.enabled).toBe("boolean");
    expect(typeof slack.tokenConfigured).toBe("boolean");
    expect(slack).not.toHaveProperty("botToken");
    expect(slack).not.toHaveProperty("token");
    expect(JSON.stringify(body)).not.toContain("xoxb-");
  });

  it("refuses a signed-out caller", async () => {
    signOutForRequest();
    const { status } = await readJson(await getSlackSettings());
    expect(status).toBe(401);
  });
});

describe("GET /api/settings/users", () => {
  it("lists the real profiles, including the signed-in test user", async () => {
    restoreSession(sessionCookies);
    const { status, body } = await readJson(await getTeamMembers());

    expect(status).toBe(200);

    const users = body.users as TeamMember[];
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((user) => typeof user.email === "string" && user.email.includes("@"))).toBe(
      true,
    );
  });

  it("refuses a signed-out caller", async () => {
    signOutForRequest();
    const { status } = await readJson(await getTeamMembers());
    expect(status).toBe(401);
  });
});

describe("GET /api/settings/email", () => {
  it("reports the relay address the deployment actually sends from", async () => {
    restoreSession(sessionCookies);
    const { status, body } = await readJson(await getEmailSettings());

    expect(status).toBe(200);

    const email = body.email as EmailSettings;
    expect(email.relayAddress).toContain("@");
    expect(email.companyName.length).toBeGreaterThan(0);
    expect(email.careersUrl).toMatch(/^https?:\/\//);
  });

  it("refuses a signed-out caller", async () => {
    signOutForRequest();
    const { status } = await readJson(await getEmailSettings());
    expect(status).toBe(401);
  });
});
