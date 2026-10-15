import { describe, expect, it } from "vitest";

import {
  careersDescription,
  careersTitle,
  companyIdentityFrom,
  publicTitleTemplate,
  websiteLabel,
} from "./company-identity";

describe("companyIdentityFrom", () => {
  it("reads the company from its environment variables", () => {
    expect(
      companyIdentityFrom({
        COMPANY_NAME: " Acme Inc. ",
        COMPANY_WEBSITE_URL: "https://www.example.com",
        COMPANY_LOGO_URL: "",
      }),
    ).toEqual({ name: "Acme Inc.", websiteUrl: "https://www.example.com", logoUrl: "" });
  });
});

describe("careers page titles", () => {
  it("name the hiring company", () => {
    expect(careersTitle("Acme Inc.")).toBe("Careers at Acme Inc.");
    expect(publicTitleTemplate("Acme Inc.")).toBe("%s — Acme Inc.");
    expect(careersDescription("Acme Inc.")).toBe("Open roles at Acme Inc.");
  });

  it("stay neutral when no company is configured", () => {
    expect(careersTitle("")).toBe("Careers");
    expect(publicTitleTemplate("")).toBe("%s");
    expect(careersDescription("")).toBe("Open roles");
  });
});

describe("websiteLabel", () => {
  it("shows the host without www", () => {
    expect(websiteLabel("https://www.example.com/about")).toBe("example.com");
    expect(websiteLabel("https://jobs.example.org")).toBe("jobs.example.org");
  });

  it("falls back to the value itself when it is not a URL", () => {
    expect(websiteLabel("example")).toBe("example");
  });
});
