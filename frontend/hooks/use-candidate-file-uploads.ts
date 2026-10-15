import { useCallback, useEffect, useRef, useState } from "react";

import { uploadCandidateFile, type UploadScope } from "@/utilities/upload-candidate-file";

export type CandidateFileUpload =
  | { status: "uploading"; filename: string }
  | { status: "ready"; filename: string; storagePath: string; mimeType?: string }
  | { status: "error"; filename: string; message: string };

/**
 * Uploads a candidate's files as soon as they are picked, keyed by field.
 *
 * Files used to travel inside the submit request, which the host rejects above
 * roughly 6 MB, so a large resume failed only at the very end with no usable
 * message. Uploading on pick keeps that request small and surfaces any failure
 * next to the field it belongs to.
 *
 * Picking a new file while the previous one is still uploading must not let the
 * slower, older upload win, so each key remembers its latest attempt and
 * results from earlier ones are dropped.
 */
export function useCandidateFileUploads(scope: UploadScope) {
  const [uploads, setUploads] = useState<Record<string, CandidateFileUpload>>({});
  const attemptsRef = useRef<Record<string, number>>({});
  // Callers pass a fresh scope object each render; reading it through a ref
  // keeps `start` stable without restarting anything when it changes.
  const scopeRef = useRef(scope);
  useEffect(() => {
    scopeRef.current = scope;
  });

  const nextAttempt = (key: string) => {
    const attempt = (attemptsRef.current[key] ?? 0) + 1;
    attemptsRef.current[key] = attempt;
    return attempt;
  };

  const start = useCallback(async (key: string, file: File) => {
    const attempt = nextAttempt(key);
    setUploads((previous) => ({
      ...previous,
      [key]: { status: "uploading", filename: file.name },
    }));

    const result = await uploadCandidateFile("resumes", scopeRef.current, file);
    if (attemptsRef.current[key] !== attempt) return;

    setUploads((previous) => ({
      ...previous,
      [key]:
        "error" in result
          ? { status: "error", filename: file.name, message: result.error }
          : {
              status: "ready",
              filename: file.name,
              storagePath: result.storagePath,
              ...(file.type ? { mimeType: file.type } : {}),
            },
    }));
  }, []);

  /** Records a file refused before upload, such as one over the size limit. */
  const reject = useCallback((key: string, filename: string, message: string) => {
    nextAttempt(key);
    setUploads((previous) => ({ ...previous, [key]: { status: "error", filename, message } }));
  }, []);

  const clear = useCallback((key: string) => {
    nextAttempt(key);
    setUploads((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }, []);

  const anyUploading = Object.values(uploads).some((upload) => upload.status === "uploading");

  return { uploads, start, reject, clear, anyUploading };
}
