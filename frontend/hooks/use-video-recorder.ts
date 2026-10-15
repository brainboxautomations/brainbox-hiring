"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export type RecorderStatus = "idle" | "requesting" | "ready" | "recording" | "stopped";

export type RecorderErrorKind =
  | "unsupported"
  | "insecure-context"
  | "permission-denied"
  | "no-device"
  | "device-busy"
  | "failed";

export type RecorderError = { kind: RecorderErrorKind; message: string };

export type RecordingResult = {
  blob: Blob;

  mimeType: string;

  extension: string;

  durationSeconds: number;
};

const MIME_PREFERENCES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 24 },
  facingMode: "user",
};

const VIDEO_BITS_PER_SECOND = 1_500_000;
const AUDIO_BITS_PER_SECOND = 96_000;

export function extensionForMimeType(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "video/mp4") return "mp4";
  if (base === "video/quicktime") return "mov";
  if (base === "video/x-matroska") return "mkv";
  return "webm";
}

const subscribeToNothing = () => () => {};
const serverRecordingSupport = () => false;

export function useRecordingSupported(): boolean {
  return useSyncExternalStore(subscribeToNothing, isRecordingSupported, serverRecordingSupport);
}

export function isRecordingSupported(): boolean {
  if (typeof window === "undefined") return false;

  if (!window.isSecureContext) return false;
  if (typeof MediaRecorder === "undefined") return false;
  return typeof navigator.mediaDevices?.getUserMedia === "function";
}

function pickMimeType(): string | undefined {
  for (const candidate of MIME_PREFERENCES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }

  return undefined;
}

function classifyError(error: unknown): RecorderError {
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        kind: "permission-denied",
        message:
          "Camera and microphone access was blocked. Enable it for this site in your browser settings, then try again.",
      };
    case "NotFoundError":
    case "OverconstrainedError":
      return { kind: "no-device", message: "No camera or microphone was found on this device." };
    case "NotReadableError":
    case "AbortError":
      return {
        kind: "device-busy",
        message:
          "Your camera is already in use by another app. Close it (Zoom, Meet, Teams…) and try again.",
      };
    default:
      return { kind: "failed", message: "Could not start recording. Please try again." };
  }
}

type UseVideoRecorderOptions = {
  maxDurationSeconds?: number | null;
};

export function useVideoRecorder({ maxDurationSeconds }: UseVideoRecorderOptions = {}) {
  const supported = useRecordingSupported();
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<RecorderError | null>(null);
  const [result, setResult] = useState<RecordingResult | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  const clearTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    clearTick();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }, [clearTick]);

  const start = useCallback(async () => {
    if (!isRecordingSupported()) {
      setError(
        window.isSecureContext
          ? {
              kind: "unsupported",
              message: "This browser can't record video. Upload a file or paste a link instead.",
            }
          : {
              kind: "insecure-context",
              message:
                "Recording needs a secure (https) connection. Upload a file or paste a link instead.",
            },
      );
      return;
    }

    setError(null);
    setResult(null);
    setStatus("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: VIDEO_CONSTRAINTS,
        audio: true,
      });
    } catch (err) {
      setStatus("idle");
      setError(classifyError(err));
      return;
    }

    streamRef.current = stream;

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
    } catch {
      try {
        recorder = new MediaRecorder(stream);
      } catch (err) {
        stopStream();
        setStatus("idle");
        setError(classifyError(err));
        return;
      }
    }

    recorderRef.current = recorder;
    chunksRef.current = [];
    elapsedRef.current = 0;
    setElapsed(0);

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      clearTick();

      const actual = recorder.mimeType || mimeType || "video/webm";
      const blob = new Blob(chunksRef.current, { type: actual });
      chunksRef.current = [];
      stopStream();
      setResult({
        blob,
        mimeType: actual,
        extension: extensionForMimeType(actual),
        durationSeconds: elapsedRef.current,
      });
      setStatus("stopped");
    };

    recorder.onerror = () => {
      clearTick();
      stopStream();
      setStatus("idle");
      setError({ kind: "failed", message: "Recording stopped unexpectedly. Please try again." });
    };

    recorder.start(1000);
    setStatus("recording");

    tickRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
      if (maxDurationSeconds && elapsedRef.current >= maxDurationSeconds) {
        stop();
      }
    }, 1000);
  }, [clearTick, maxDurationSeconds, stop, stopStream]);

  const reset = useCallback(() => {
    clearTick();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    elapsedRef.current = 0;
    stopStream();
    setElapsed(0);
    setResult(null);
    setError(null);
    setStatus("idle");
  }, [clearTick, stopStream]);

  useEffect(() => {
    return () => {
      clearTick();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [clearTick]);

  return { supported, status, elapsed, error, result, streamRef, start, stop, reset };
}
