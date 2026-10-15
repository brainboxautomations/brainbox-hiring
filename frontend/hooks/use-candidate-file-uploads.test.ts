import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { storagePath: string } | { error: string };

const upload = vi.hoisted(() =>
  vi.fn<(bucket: string, scope: { positionId: string }, file: File) => Promise<Result>>(),
);

vi.mock("@/utilities/upload-candidate-file", () => ({ uploadCandidateFile: upload }));

const { useCandidateFileUploads } = await import("@/hooks/use-candidate-file-uploads");

const POSITION_ID = "11111111-1111-4111-8111-111111111111";
const SCOPE = { positionId: POSITION_ID };
const PATH = `applications/${POSITION_ID}/22222222-2222-4222-8222-222222222222-cv.pdf`;

function pdf(name: string): File {
  return new File(["%PDF"], name, { type: "application/pdf" });
}

beforeEach(() => upload.mockReset());

describe("useCandidateFileUploads", () => {
  // The server issues the upload and chooses the path; the hook keeps the path
  // it was given so the form can send it with the application.
  it("uploads to the resumes bucket for this form and keeps the path the server chose", async () => {
    upload.mockResolvedValue({ storagePath: PATH });
    const { result } = renderHook(() => useCandidateFileUploads(SCOPE));

    await act(() => result.current.start("resume", pdf("cv.pdf")));

    const [bucket, scope] = upload.mock.calls[0]!;
    expect(bucket).toBe("resumes");
    expect(scope).toEqual(SCOPE);
    expect(result.current.uploads.resume).toEqual({
      status: "ready",
      filename: "cv.pdf",
      storagePath: PATH,
      mimeType: "application/pdf",
    });
  });

  it("reports uploading until the upload finishes", async () => {
    let finish: (result: Result) => void = () => {};
    upload.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useCandidateFileUploads(SCOPE));

    act(() => void result.current.start("resume", pdf("cv.pdf")));

    expect(result.current.uploads.resume?.status).toBe("uploading");
    expect(result.current.anyUploading).toBe(true);

    await act(async () => finish({ storagePath: PATH }));
    expect(result.current.anyUploading).toBe(false);
  });

  it("keeps the failure message next to the field", async () => {
    upload.mockResolvedValue({
      error: "Upload failed: The object exceeded the maximum allowed size",
    });
    const { result } = renderHook(() => useCandidateFileUploads(SCOPE));

    await act(() => result.current.start("resume", pdf("huge.pdf")));

    expect(result.current.uploads.resume).toEqual({
      status: "error",
      filename: "huge.pdf",
      message: "Upload failed: The object exceeded the maximum allowed size",
    });
  });

  // A candidate who picks one file, then another before the first has
  // finished, must end up with the second. Without the guard the slower first
  // upload lands last and overwrites it — the form would then submit the file
  // they replaced.
  it("ignores a slower upload that was replaced by a newer pick", async () => {
    let finishFirst: (result: Result) => void = () => {};
    upload
      .mockReturnValueOnce(new Promise((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce({ storagePath: PATH });
    const { result } = renderHook(() => useCandidateFileUploads(SCOPE));

    act(() => void result.current.start("resume", pdf("old.pdf")));
    await act(() => result.current.start("resume", pdf("new.pdf")));
    await act(async () => finishFirst({ storagePath: PATH }));

    await waitFor(() => expect(result.current.uploads.resume?.filename).toBe("new.pdf"));
  });

  it("forgets the file when it is removed, even mid-upload", async () => {
    let finish: (result: Result) => void = () => {};
    upload.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useCandidateFileUploads(SCOPE));

    act(() => void result.current.start("resume", pdf("cv.pdf")));
    act(() => result.current.clear("resume"));
    await act(async () => finish({ storagePath: PATH }));

    expect(result.current.uploads.resume).toBeUndefined();
  });
});
