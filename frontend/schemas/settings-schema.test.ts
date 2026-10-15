import { describe, expect, it } from "vitest";

import { emailTimingSchema, slackConfigSchema, slackTokenSchema } from "@/schemas/settings-schema";

function config(overrides: Record<string, unknown> = {}) {
  return { channelId: "C0123ABCD", channelName: "candidate-inbox", enabled: true, ...overrides };
}

describe("slackConfigSchema", () => {
  it("accepts a real-looking channel id", () => {
    expect(slackConfigSchema.safeParse(config()).success).toBe(true);
  });

  it("accepts a private group id, because SLK-2 only rules out direct messages", () => {
    expect(slackConfigSchema.safeParse(config({ channelId: "G0123ABCD" })).success).toBe(true);
  });

  it("rejects a channel name pasted into the channel id field", () => {
    const result = slackConfigSchema.safeParse(config({ channelId: "#candidate-inbox" }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toContain("C0123ABCD");
  });

  it("rejects a lower-case id, which Slack never issues", () => {
    expect(slackConfigSchema.safeParse(config({ channelId: "c0123abcd" })).success).toBe(false);
  });

  it("allows clearing the channel while notifications are off", () => {
    const result = slackConfigSchema.safeParse(config({ channelId: null, enabled: false }));
    expect(result.success).toBe(true);
  });

  it("refuses to turn notifications on with nowhere to post", () => {
    const result = slackConfigSchema.safeParse(config({ channelId: null, enabled: true }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["channelId"]);
  });

  it("trims a pasted id rather than failing on stray whitespace", () => {
    const result = slackConfigSchema.safeParse(config({ channelId: "  C0123ABCD  " }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.channelId).toBe("C0123ABCD");
  });
});

describe("slackTokenSchema", () => {
  it("accepts a bot token", () => {
    expect(slackTokenSchema.safeParse({ token: "xoxb-1-2-abc" }).success).toBe(true);
  });

  it("accepts an empty string, which is how the screen removes the token", () => {
    expect(slackTokenSchema.safeParse({ token: "" }).success).toBe(true);
  });

  it("rejects a user token, which cannot post as the app", () => {
    const result = slackTokenSchema.safeParse({ token: "xoxp-1-2-abc" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toContain("xoxb-");
  });

  it("rejects an app-level token", () => {
    expect(slackTokenSchema.safeParse({ token: "xapp-1-A0-0-abc" }).success).toBe(false);
  });
});

describe("emailTimingSchema", () => {
  it("accepts whole minutes from 0 to a day", () => {
    expect(
      emailTimingSchema.safeParse({ automationSafetyDelayMinutes: 0, sendUndoMinutes: 1440 })
        .success,
    ).toBe(true);
  });

  it("refuses negative, fractional or over-a-day values", () => {
    expect(
      emailTimingSchema.safeParse({ automationSafetyDelayMinutes: -1, sendUndoMinutes: 30 })
        .success,
    ).toBe(false);
    expect(
      emailTimingSchema.safeParse({ automationSafetyDelayMinutes: 2.5, sendUndoMinutes: 30 })
        .success,
    ).toBe(false);
    expect(
      emailTimingSchema.safeParse({ automationSafetyDelayMinutes: 20, sendUndoMinutes: 1441 })
        .success,
    ).toBe(false);
  });
});
