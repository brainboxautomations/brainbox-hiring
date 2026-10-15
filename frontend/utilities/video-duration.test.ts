import { describe, expect, it } from "vitest";

import {
  DURATION_TOLERANCE_SECONDS,
  exceedsMaxDuration,
  formatDuration,
} from "@/utilities/video-duration";

describe("exceedsMaxDuration", () => {
  // The bug this guards: a question's max duration was helper text only. An
  // uploaded video was never measured, so a 5-minute clip passed a 1-minute
  // limit — or was rejected by the unrelated 50 MB size check with a message
  // about bytes that never mentioned duration.
  it("rejects a video well over the limit", () => {
    expect(exceedsMaxDuration(300, 60)).toBe(true);
  });

  it("accepts a video inside the limit", () => {
    expect(exceedsMaxDuration(45, 60)).toBe(false);
  });

  it("accepts one exactly at the limit", () => {
    expect(exceedsMaxDuration(60, 60)).toBe(false);
  });

  // A recorder told to stop at 60s routinely lands a few tenths over, and
  // browsers disagree slightly on the same file's duration. Failing candidates
  // who did exactly what they were told would be worse than letting a second
  // through.
  it("tolerates a small overshoot from the recorder", () => {
    expect(exceedsMaxDuration(60.4, 60)).toBe(false);
    expect(exceedsMaxDuration(60 + DURATION_TOLERANCE_SECONDS, 60)).toBe(false);
  });

  it("still rejects once the overshoot is past tolerance", () => {
    expect(exceedsMaxDuration(60 + DURATION_TOLERANCE_SECONDS + 0.1, 60)).toBe(true);
  });
});

describe("formatDuration", () => {
  // The upload hint read `Math.round(seconds / 60)` + " min", so a 30-second
  // limit was shown to the candidate as "max 1 min" — twice the real rule.
  it("describes a sub-minute limit in seconds", () => {
    expect(formatDuration(30)).toBe("30 seconds");
    expect(formatDuration(1)).toBe("1 second");
  });

  it("describes whole minutes without stray seconds", () => {
    expect(formatDuration(60)).toBe("1 minute");
    expect(formatDuration(120)).toBe("2 minutes");
  });

  it("describes a mixed duration", () => {
    expect(formatDuration(90)).toBe("1 min 30 sec");
  });

  it("rounds fractional durations rather than printing decimals", () => {
    expect(formatDuration(59.6)).toBe("1 minute");
    expect(formatDuration(30.2)).toBe("30 seconds");
  });
});
