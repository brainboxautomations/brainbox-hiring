import { describe, expect, it } from "vitest";

import { undoWindowSendTime } from "@/app/api/_email-timing";

describe("undoWindowSendTime", () => {
  const now = new Date("2026-10-08T10:00:00Z");

  it("holds an email for the undo window", () => {
    expect(undoWindowSendTime({ automationSafetyDelayMinutes: 20, sendUndoMinutes: 30 }, now)).toBe(
      "2026-10-08T10:30:00.000Z",
    );
  });

  it("sends at once when the window is off", () => {
    expect(
      undoWindowSendTime({ automationSafetyDelayMinutes: 20, sendUndoMinutes: 0 }, now),
    ).toBeNull();
  });
});
