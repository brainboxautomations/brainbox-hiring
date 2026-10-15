// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const KEYS = [
  "RESEND_API_KEY",
  "EMAIL_RELAY_ADDRESS",
  "COMPANY_NAME",
  "COMPANY_WEBSITE_URL",
  "COMPANY_LOGO_URL",
  "COMPANY_CAREERS_URL",
] as const;

const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

async function load() {
  vi.resetModules();
  return import("@/configurations/env-configuration");
}

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("companyEnv", () => {
  it("has no built-in company: every value is blank when unset", async () => {
    setEnv({});
    const { companyEnv } = await load();

    expect(companyEnv()).toEqual({
      COMPANY_NAME: "",
      COMPANY_WEBSITE_URL: "",
      COMPANY_LOGO_URL: "",
      COMPANY_CAREERS_URL: "",
    });
  });

  it("does not need the mail credentials", async () => {
    setEnv({ COMPANY_NAME: "  Acme Inc.  " });
    const { companyEnv } = await load();

    expect(companyEnv().COMPANY_NAME).toBe("Acme Inc.");
  });

  it("keeps http and https URLs", async () => {
    setEnv({
      COMPANY_WEBSITE_URL: "https://www.example.com",
      COMPANY_LOGO_URL: "https://cdn.example.com/logo.svg",
      COMPANY_CAREERS_URL: "http://jobs.example.com/careers",
    });
    const { companyEnv } = await load();

    expect(companyEnv()).toMatchObject({
      COMPANY_WEBSITE_URL: "https://www.example.com",
      COMPANY_LOGO_URL: "https://cdn.example.com/logo.svg",
      COMPANY_CAREERS_URL: "http://jobs.example.com/careers",
    });
  });

  it("refuses a URL that is not http or https", async () => {
    setEnv({ COMPANY_WEBSITE_URL: "javascript:alert(1)" });
    const { companyEnv } = await load();

    expect(() => companyEnv()).toThrow(/COMPANY_WEBSITE_URL/);
  });

  it("takes the logo as an absolute http(s) URL", async () => {
    setEnv({ COMPANY_LOGO_URL: "https://cdn.example.com/logo.png" });
    const { companyEnv } = await load();

    expect(companyEnv().COMPANY_LOGO_URL).toBe("https://cdn.example.com/logo.png");
  });

  it("takes the logo as a path served by the app", async () => {
    setEnv({ COMPANY_LOGO_URL: " /logo.png " });
    const { companyEnv } = await load();

    expect(companyEnv().COMPANY_LOGO_URL).toBe("/logo.png");
  });

  it.each([
    ["a protocol-relative URL", "//evil.com/x.png"],
    ["a backslash path browsers read as another host", "/\\evil.com/x.png"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a bare file name", "logo.png"],
    ["a lone slash", "/"],
  ])("refuses %s as the logo", async (_, value) => {
    setEnv({ COMPANY_LOGO_URL: value });
    const { companyEnv } = await load();

    expect(() => companyEnv()).toThrow(
      /COMPANY_LOGO_URL must be an http\(s\) URL or a path starting with \//,
    );
  });
});

describe("serverEnv", () => {
  it("has no built-in relay address", async () => {
    setEnv({ RESEND_API_KEY: "test-resend-key" });
    const { serverEnv } = await load();

    expect(serverEnv().EMAIL_RELAY_ADDRESS).toBe("");
  });

  it("refuses a relay address that is not an email address", async () => {
    setEnv({ RESEND_API_KEY: "test-resend-key", EMAIL_RELAY_ADDRESS: "talent" });
    const { serverEnv } = await load();

    expect(() => serverEnv()).toThrow(/EMAIL_RELAY_ADDRESS/);
  });
});
