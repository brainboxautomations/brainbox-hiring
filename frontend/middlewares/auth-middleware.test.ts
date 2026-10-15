import { describe, expect, it } from "vitest";

import { isUnauthenticatedApiPath } from "@/middlewares/auth-middleware";

describe("isUnauthenticatedApiPath", () => {
  it("lets the inbound mail webhook through, because the relay carries no session", () => {
    expect(isUnauthenticatedApiPath("/api/webhooks/resend/inbound")).toBe(true);
  });

  it("lets the queue worker through, because pg_cron carries no session either", () => {
    expect(isUnauthenticatedApiPath("/api/workers/scheduled-actions")).toBe(true);
  });

  it("gates every other API route as normal", () => {
    expect(isUnauthenticatedApiPath("/api/messages")).toBe(false);
    expect(isUnauthenticatedApiPath("/api/threads")).toBe(false);
    expect(isUnauthenticatedApiPath("/api/positions")).toBe(false);
    expect(isUnauthenticatedApiPath("/api/stage-actions")).toBe(false);
  });

  it("cannot be tricked by a lookalike path", () => {
    expect(isUnauthenticatedApiPath("/api/webhooksfake/steal")).toBe(false);
    expect(isUnauthenticatedApiPath("/apix/webhooks/resend/inbound")).toBe(false);
    expect(isUnauthenticatedApiPath("/webhooks/resend/inbound")).toBe(false);
    expect(isUnauthenticatedApiPath("/api/workersfake/run")).toBe(false);
  });
});
