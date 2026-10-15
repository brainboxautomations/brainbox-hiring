import { describe, expect, it } from "vitest";

import { isSafeDocumentLink, resumePreviewKind } from "@/utilities/resume-preview";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("resumePreviewKind", () => {
  it("previews PDFs and images in a frame", () => {
    expect(resumePreviewKind("application/pdf", "cv.pdf")).toBe("pdf");
    expect(resumePreviewKind("image/png", "cv.png")).toBe("image");
  });

  it("converts a Word .docx in the page", () => {
    expect(resumePreviewKind(DOCX_MIME, "cv.docx")).toBe("docx");
  });

  // Older uploads were stored without a MIME type.
  it("falls back to the file extension when the MIME type is missing", () => {
    expect(resumePreviewKind(null, "Amara CV.PDF")).toBe("pdf");
    expect(resumePreviewKind(null, "Amara CV.docx")).toBe("docx");
    expect(resumePreviewKind("", "photo.jpeg")).toBe("image");
  });

  it("offers no preview for an old binary .doc or anything unknown", () => {
    expect(resumePreviewKind("application/msword", "cv.doc")).toBe("none");
    expect(resumePreviewKind(null, "cv")).toBe("none");
    expect(resumePreviewKind(null, null)).toBe("none");
  });
});

describe("isSafeDocumentLink", () => {
  it("keeps web, email and in-document links", () => {
    expect(isSafeDocumentLink("https://linkedin.com/in/amara")).toBe(true);
    expect(isSafeDocumentLink("http://example.com")).toBe(true);
    expect(isSafeDocumentLink("mailto:amara@example.com")).toBe(true);
    expect(isSafeDocumentLink("#experience")).toBe(true);
  });

  it("drops script and data links, whatever their casing or padding", () => {
    expect(isSafeDocumentLink("javascript:alert(1)")).toBe(false);
    expect(isSafeDocumentLink("  JavaScript:alert(1)")).toBe(false);
    expect(isSafeDocumentLink("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeDocumentLink("vbscript:msgbox")).toBe(false);
  });

  it("drops relative or malformed links, which would resolve against the app", () => {
    expect(isSafeDocumentLink("/settings/users")).toBe(false);
    expect(isSafeDocumentLink("")).toBe(false);
  });
});
