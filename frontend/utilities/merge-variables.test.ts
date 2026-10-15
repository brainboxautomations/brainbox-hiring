import { describe, expect, it } from "vitest";

import {
  EMPTY_MERGE_CONTEXT,
  MERGE_VARIABLE_CATALOG,
  buildMergeContext,
  escapeHtml,
  formatMergeLocation,
  formatMergeSalaryRange,
  mergeTokenFor,
  resolveMergeVariables,
  unresolvableMergeTokens,
  type MergeContext,
} from "@/utilities/merge-variables";

const FULL_CONTEXT: MergeContext = buildMergeContext({
  candidate: {
    firstName: "Amara",
    lastName: "Okafor",
    email: "amara.okafor@example.com",
    phone: "+44 20 7946 0821",
    customAttributes: { notice_period: "4 weeks", years_experience: "6 years" },
  },
  position: {
    title: "Senior Frontend Engineer",
    department: "Engineering",
    locations: [{ country: "United Kingdom", detail: "London" }],
    remoteFlag: true,
    salaryFrom: 85000,
    salaryTo: 110000,
    salaryPeriod: "year",
    salaryCurrency: "PKR",
  },
  company: { name: "Acme Inc.", careersUrl: "https://jobs.example.com/careers" },
  senderName: "Rowan Mills",
});

describe("no raw token ever reaches a candidate", () => {
  const cases: [string, string][] = [
    ["{{candidate.first_name}}", "there"],
    ["{{ candidate.first_name }}", "there"],
    ["{{CANDIDATE.FIRST_NAME}}", "there"],
    ["{{candidate.middle_name}}", ""],
    ["{{unknown_group.field}}", ""],
    ["{{candidate}}", ""],
    ["{{}}", ""],
    ["{{   }}", ""],
    ["{{candidate.}}", ""],
    ["{{.first_name}}", ""],
    ["{{custom.anything_at_all}}", ""],
    ["{{ position.title }}", ""],
  ];

  it.each(cases)("%s leaves nothing behind when the value is missing", (template, expected) => {
    const output = resolveMergeVariables(template, EMPTY_MERGE_CONTEXT);
    expect(output).toBe(expected);
    expect(output).not.toContain("{{");
    expect(output).not.toContain("}}");
  });

  it("strips every token from a realistic email with an empty context", () => {
    const body =
      "Hi {{candidate.first_name}},\n\n" +
      "Thanks for applying to {{position.title}} at {{company.name}} ({{position.location}}).\n" +
      "We pay {{position.salary_range}}. Reach us at {{company.careers_url}}.\n\n" +
      "Best,\n{{sender.name}}";

    const output = resolveMergeVariables(body, EMPTY_MERGE_CONTEXT);
    expect(output).not.toMatch(/\{\{|\}\}/);
    expect(output).toContain("Hi there,");
  });

  it("does not re-resolve a token that appears inside a resolved value", () => {
    const context = buildMergeContext({
      candidate: { firstName: "{{company.name}}", lastName: "Doe" },
      company: { name: "Acme Inc." },
    });
    expect(resolveMergeVariables("{{candidate.first_name}}", context)).toBe("{{company.name}}");
  });

  it("consumes only the innermost braces of a doubled token", () => {
    const output = resolveMergeVariables("{{{{candidate.first_name}}}}", FULL_CONTEXT);
    expect(output).toBe("{{Amara}}");
  });

  it("leaves an unterminated token alone rather than swallowing the rest of the body", () => {
    expect(resolveMergeVariables("Hi {{candidate.first_name", FULL_CONTEXT)).toBe(
      "Hi {{candidate.first_name",
    );
  });

  it("treats a whitespace-only stored value as missing", () => {
    const context = buildMergeContext({ candidate: { firstName: "   " } });
    expect(resolveMergeVariables("{{candidate.first_name}}", context)).toBe("there");
  });
});

describe("fallbacks", () => {
  it("uses the catalog fallback so a greeting still reads naturally", () => {
    expect(resolveMergeVariables("Hi {{candidate.first_name}},", EMPTY_MERGE_CONTEXT)).toBe(
      "Hi there,",
    );
    expect(resolveMergeVariables("Hi {{candidate.full_name}},", EMPTY_MERGE_CONTEXT)).toBe(
      "Hi there,",
    );
  });

  it("resolves to empty where no catalog fallback is defined", () => {
    expect(resolveMergeVariables("[{{position.title}}]", EMPTY_MERGE_CONTEXT)).toBe("[]");
    expect(resolveMergeVariables("[{{candidate.phone}}]", EMPTY_MERGE_CONTEXT)).toBe("[]");
  });

  it("prefers an inline fallback over the catalog fallback", () => {
    expect(
      resolveMergeVariables("Hi {{candidate.first_name|candidate}},", EMPTY_MERGE_CONTEXT),
    ).toBe("Hi candidate,");
  });

  it("honours an empty inline fallback as a deliberate blank", () => {
    expect(resolveMergeVariables("Hi{{candidate.first_name|}}!", EMPTY_MERGE_CONTEXT)).toBe("Hi!");
  });

  it("uses an inline fallback for an unknown field rather than printing the token", () => {
    expect(resolveMergeVariables("{{candidate.nickname|friend}}", FULL_CONTEXT)).toBe("friend");
  });

  it("ignores the fallback when a real value exists", () => {
    expect(resolveMergeVariables("{{candidate.first_name|there}}", FULL_CONTEXT)).toBe("Amara");
  });
});

describe("resolution against a populated context", () => {
  it("fills every catalogued variable", () => {
    expect(resolveMergeVariables("{{candidate.first_name}}", FULL_CONTEXT)).toBe("Amara");
    expect(resolveMergeVariables("{{candidate.last_name}}", FULL_CONTEXT)).toBe("Okafor");
    expect(resolveMergeVariables("{{candidate.full_name}}", FULL_CONTEXT)).toBe("Amara Okafor");
    expect(resolveMergeVariables("{{candidate.email}}", FULL_CONTEXT)).toBe(
      "amara.okafor@example.com",
    );
    expect(resolveMergeVariables("{{candidate.phone}}", FULL_CONTEXT)).toBe("+44 20 7946 0821");
    expect(resolveMergeVariables("{{position.title}}", FULL_CONTEXT)).toBe(
      "Senior Frontend Engineer",
    );
    expect(resolveMergeVariables("{{position.department}}", FULL_CONTEXT)).toBe("Engineering");
    expect(resolveMergeVariables("{{company.name}}", FULL_CONTEXT)).toBe("Acme Inc.");
    expect(resolveMergeVariables("{{company.careers_url}}", FULL_CONTEXT)).toBe(
      "https://jobs.example.com/careers",
    );
    expect(resolveMergeVariables("{{sender.name}}", FULL_CONTEXT)).toBe("Rowan Mills");
  });

  it("resolves custom attributes from the person, case-insensitively", () => {
    expect(resolveMergeVariables("{{custom.notice_period}}", FULL_CONTEXT)).toBe("4 weeks");
    expect(resolveMergeVariables("{{Custom.Years_Experience}}", FULL_CONTEXT)).toBe("6 years");
  });

  it("replaces every occurrence, not only the first", () => {
    expect(resolveMergeVariables("{{sender.name}} and {{sender.name}}", FULL_CONTEXT)).toBe(
      "Rowan Mills and Rowan Mills",
    );
  });

  it("returns an empty string for a missing template", () => {
    expect(resolveMergeVariables(null, FULL_CONTEXT)).toBe("");
    expect(resolveMergeVariables(undefined, FULL_CONTEXT)).toBe("");
  });
});

describe("html escaping", () => {
  it("escapes the five html-significant characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("context building", () => {
  it("derives full_name from the parts and tolerates a missing surname", () => {
    const context = buildMergeContext({ candidate: { firstName: "Amara", lastName: null } });
    expect(resolveMergeVariables("{{candidate.full_name}}", context)).toBe("Amara");
  });

  it("formats a location list and appends Remote once", () => {
    expect(
      formatMergeLocation({
        locations: [
          { country: "United Kingdom", detail: "London" },
          { country: "Germany", detail: "" },
        ],
        remoteFlag: true,
      }),
    ).toBe("London, United Kingdom · Germany · Remote");
  });

  it("returns an empty location when the position has none", () => {
    expect(formatMergeLocation({ locations: [], remoteFlag: false })).toBe("");
    expect(formatMergeLocation({})).toBe("");
  });

  it("formats salary ranges, partial ranges and no salary at all", () => {
    const base = { salaryCurrency: "PKR", salaryPeriod: "year" };
    expect(formatMergeSalaryRange({ ...base, salaryFrom: 85000, salaryTo: 110000 })).toBe(
      "Rs 85,000–Rs 110,000 per year",
    );
    expect(formatMergeSalaryRange({ ...base, salaryFrom: 85000, salaryTo: 85000 })).toBe(
      "Rs 85,000 per year",
    );
    expect(formatMergeSalaryRange({ ...base, salaryFrom: 85000 })).toBe("From Rs 85,000 per year");
    expect(formatMergeSalaryRange({ ...base, salaryTo: 110000 })).toBe("Up to Rs 110,000 per year");

    // A position saved in another currency before PKR-only still names it,
    // rather than showing a bare number an email reader could misread.
    expect(formatMergeSalaryRange({ salaryFrom: 3000, salaryCurrency: "USD" })).toBe(
      "From 3,000 USD",
    );
    expect(formatMergeSalaryRange({ salaryFrom: 9000, salaryCurrency: "PLN" })).toBe(
      "From 9,000 PLN",
    );
    expect(formatMergeSalaryRange({})).toBe("");
  });

  it("produces a blank salary_range rather than a token when nothing is set", () => {
    const context = buildMergeContext({ position: { title: "Analyst" } });
    expect(resolveMergeVariables("Salary: {{position.salary_range}}.", context)).toBe("Salary: .");
  });
});

describe("catalog", () => {
  it("matches the documented catalog exactly", () => {
    const flattened = MERGE_VARIABLE_CATALOG.flatMap((group) =>
      group.fields.map((f) => `${group.group}.${f.field}`),
    );
    expect(flattened).toEqual([
      "candidate.first_name",
      "candidate.last_name",
      "candidate.full_name",
      "candidate.email",
      "candidate.phone",
      "position.title",
      "position.location",
      "position.department",
      "position.salary_range",
      "company.name",
      "company.careers_url",
      "sender.name",
    ]);
  });

  it("builds an insertable token for each catalogued field", () => {
    expect(mergeTokenFor("candidate", "first_name")).toBe("{{candidate.first_name}}");
    expect(mergeTokenFor("custom", "notice_period")).toBe("{{custom.notice_period}}");
  });

  it("resolves every catalogued token against a full context", () => {
    for (const group of MERGE_VARIABLE_CATALOG) {
      for (const field of group.fields) {
        const token = mergeTokenFor(group.group, field.field);
        expect(resolveMergeVariables(token, FULL_CONTEXT)).not.toBe("");
      }
    }
  });
});

describe("token inspection for the compose warning", () => {
  it("reports which tokens will come out blank", () => {
    expect(
      unresolvableMergeTokens(
        "{{position.title}} {{candidate.phone}} {{custom.nope}}",
        FULL_CONTEXT,
      ),
    ).toEqual(["custom.nope"]);
  });

  it("does not report a token that has an inline fallback", () => {
    expect(unresolvableMergeTokens("{{custom.nope|n/a}}", FULL_CONTEXT)).toEqual([]);
  });

  it("reports a malformed token so compose can warn about it", () => {
    expect(unresolvableMergeTokens("{{oops}}", FULL_CONTEXT)).toEqual(["oops"]);
  });

  // The composer knows the candidate, but company and sender are filled in on
  // the server, so judging them there warned about values that always arrive.
  it("judges only the groups asked for, still flagging malformed tokens", () => {
    const composerContext = buildMergeContext({
      candidate: { firstName: "Usman", lastName: "Tariq", email: "u@example.com", phone: null },
      position: { title: "Operations Coordinator" },
      company: {},
      senderName: null,
    });
    const template =
      "{{company.name}} {{sender.name}} {{position.location}} {{candidate.phone}} {{custom.notice}} {{oops}}";

    expect(unresolvableMergeTokens(template, composerContext, ["candidate", "custom"])).toEqual([
      "candidate.phone",
      "custom.notice",
      "oops",
    ]);
  });
});
