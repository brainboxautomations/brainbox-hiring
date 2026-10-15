import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadCandidateFile } from "@/utilities/upload-candidate-file";

const fetchMock = vi.fn();

function respond(status: number, body: unknown) {
  return new Response(body === null ? null : JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("uploadCandidateFile", () => {
  it("asks for a URL with the file's size and type, then PUTs the file to it", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock
      .mockResolvedValueOnce(
        respond(201, {
          storagePath: "applications/p/x-cv.pdf",
          uploadUrl: "https://r2.example/signed",
          contentType: "application/pdf",
        }),
      )
      .mockResolvedValueOnce(respond(200, null));

    const file = new File(["%PDF"], "cv.pdf", { type: "application/pdf" });
    const result = await uploadCandidateFile("resumes", { positionId: "p" }, file);

    expect(result).toEqual({ storagePath: "applications/p/x-cv.pdf" });

    const [ticketUrl, ticketInit] = fetchMock.mock.calls[0]!;
    expect(ticketUrl).toBe("/api/public-uploads");
    expect(JSON.parse(ticketInit.body)).toMatchObject({
      bucket: "resumes",
      filename: "cv.pdf",
      contentType: "application/pdf",
      size: 4,
      positionId: "p",
    });

    const [putUrl, putInit] = fetchMock.mock.calls[1]!;
    expect(putUrl).toBe("https://r2.example/signed");
    expect(putInit.method).toBe("PUT");
    expect(putInit.headers).toEqual({ "Content-Type": "application/pdf" });
    expect(putInit.body).toBe(file);
  });

  it("shows the server's reason when it refuses the file", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(
      respond(413, { error: "That file is too large (15 MB at most)." }),
    );

    const file = new File(["x"], "huge.pdf", { type: "application/pdf" });
    expect(await uploadCandidateFile("resumes", { positionId: "p" }, file)).toEqual({
      error: "That file is too large (15 MB at most).",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a failed upload to storage", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock
      .mockResolvedValueOnce(
        respond(201, {
          storagePath: "s",
          uploadUrl: "https://r2.example/signed",
          contentType: "x",
        }),
      )
      .mockResolvedValueOnce(respond(403, null));

    const file = new File(["x"], "cv.pdf", { type: "application/pdf" });
    const result = await uploadCandidateFile("resumes", { positionId: "p" }, file);
    expect(result).toEqual({ error: "Upload failed (403). Please try again." });
  });
});
