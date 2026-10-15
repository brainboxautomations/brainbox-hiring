/**
 * Reads how long a video file actually is, by letting the browser decode just
 * its metadata.
 *
 * A question's `videoMaxDurationSeconds` was previously shown to the candidate
 * as helper text and enforced only when they recorded in-browser, where the
 * recorder stops itself at the cap. An uploaded file was never measured, so a
 * five-minute clip could be accepted against a one-minute limit — or, if it
 * happened to be large, rejected by the unrelated 50 MB size check with a
 * message about bytes that never mentioned the rule it actually broke.
 */
export type VideoDurationResult =
  | { ok: true; seconds: number }
  | { ok: false; reason: "unreadable" };

/** Give up rather than hang: some containers never fire `loadedmetadata`. */
const METADATA_TIMEOUT_MS = 10_000;

export function readVideoDuration(file: File): Promise<VideoDurationResult> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;

    const finish = (result: VideoDurationResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ ok: false, reason: "unreadable" }),
      METADATA_TIMEOUT_MS,
    );

    video.onloadedmetadata = () => {
      const { duration } = video;
      // A stream whose length the browser cannot determine reports Infinity or
      // NaN. Treat that as unreadable rather than as "zero seconds", so an
      // unmeasurable file is never silently accepted as within the limit.
      if (!Number.isFinite(duration) || duration <= 0) {
        finish({ ok: false, reason: "unreadable" });
        return;
      }
      finish({ ok: true, seconds: duration });
    };

    video.onerror = () => finish({ ok: false, reason: "unreadable" });

    video.preload = "metadata";
    video.src = objectUrl;
  });
}

/** "1 minute", "30 seconds", "1 min 30 sec" — for limits and for what was uploaded. */
export function formatDuration(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;

  if (minutes === 0) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  if (seconds === 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${minutes} min ${seconds} sec`;
}

/**
 * Allows a small overshoot. Browsers report slightly different durations for
 * the same file depending on the container, and a recorder asked to stop at 60
 * seconds routinely lands a few tenths over — rejecting those would fail
 * candidates who did exactly what they were told.
 */
export const DURATION_TOLERANCE_SECONDS = 1.5;

export function exceedsMaxDuration(seconds: number, maxSeconds: number): boolean {
  return seconds > maxSeconds + DURATION_TOLERANCE_SECONDS;
}
