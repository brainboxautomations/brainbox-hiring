import { describe, expect, it } from "vitest";

import { GENERATED_PASSWORD_LENGTH, generatePassword } from "@/utilities/generate-password";
import { createTeamMemberSchema } from "@/schemas/team-member-schema";

describe("generatePassword", () => {
  it("has the expected length", () => {
    expect(generatePassword()).toHaveLength(GENERATED_PASSWORD_LENGTH);
    expect(generatePassword(24)).toHaveLength(24);
  });

  it("always mixes lowercase, capitals, digits and symbols", () => {
    for (let run = 0; run < 200; run += 1) {
      const password = generatePassword();
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!@#$%&*?]/);
    }
  });

  // Passwords are read off the screen and passed on by hand.
  it("never uses characters that are easy to misread", () => {
    for (let run = 0; run < 200; run += 1) {
      expect(generatePassword()).not.toMatch(/[0O1lI]/);
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generatePassword()));
    expect(seen.size).toBe(200);
  });

  it("is always accepted as a team member password", () => {
    const parsed = createTeamMemberSchema.safeParse({
      fullName: "Nadia Rahman",
      email: "nadia@example.com",
      password: generatePassword(),
    });
    expect(parsed.success).toBe(true);
  });
});

describe("createTeamMemberSchema", () => {
  const valid = { fullName: "Nadia Rahman", email: "Nadia@Example.com", password: "long-enough" };

  it("accepts a custom password and normalises the email", () => {
    const parsed = createTeamMemberSchema.parse(valid);
    expect(parsed.email).toBe("nadia@example.com");
  });

  it("rejects a short password, saying how long it must be", () => {
    const parsed = createTeamMemberSchema.safeParse({ ...valid, password: "short" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(/at least 8/);
  });

  it("requires a name and a real email", () => {
    expect(createTeamMemberSchema.safeParse({ ...valid, fullName: "  " }).success).toBe(false);
    expect(createTeamMemberSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(
      false,
    );
  });
});
