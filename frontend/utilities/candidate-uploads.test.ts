import { describe, expect, it } from "vitest";

import {
  MAX_RESUME_BYTES,
  MAX_VIDEO_BYTES,
  candidateUploadError,
  uploadContentType,
} from "@/utilities/candidate-uploads";

describe("candidateUploadError", () => {
  it("accepts a resume within the limit", () => {
    expect(
      candidateUploadError("resumes", { contentType: "application/pdf", size: MAX_RESUME_BYTES }),
    ).toBeNull();
  });

  it("refuses a resume over the limit", () => {
    expect(
      candidateUploadError("resumes", {
        contentType: "application/pdf",
        size: MAX_RESUME_BYTES + 1,
      }),
    ).toMatch(/too large/);
  });

  // Questionnaire file answers share the resumes folder and can be anything.
  it("accepts any type of file answer", () => {
    expect(candidateUploadError("resumes", { contentType: "image/png", size: 10 })).toBeNull();
  });

  it("accepts a video within the limit", () => {
    expect(
      candidateUploadError("videos", { contentType: "video/webm", size: MAX_VIDEO_BYTES }),
    ).toBeNull();
  });

  it("refuses a video over the limit, or anything that is not a video", () => {
    expect(
      candidateUploadError("videos", { contentType: "video/mp4", size: MAX_VIDEO_BYTES + 1 }),
    ).toMatch(/too large/);
    expect(candidateUploadError("videos", { contentType: "application/pdf", size: 10 })).toMatch(
      /video/,
    );
  });
});

describe("uploadContentType", () => {
  it("keeps the type the browser reported", () => {
    expect(uploadContentType("application/pdf")).toBe("application/pdf");
  });

  it("falls back when the browser reports none", () => {
    expect(uploadContentType("  ")).toBe("application/octet-stream");
  });
});
