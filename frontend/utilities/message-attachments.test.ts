import { describe, expect, it } from "vitest";

import {
  formatFileSize,
  messageAttachmentPath,
  safeAttachmentFilename,
} from "@/utilities/message-attachments";

const USER_ID = "6f04e84c-e27f-430f-a252-ce7aa18c6931";

describe("an uploaded filename cannot escape its folder", () => {
  it("keeps only the leaf of a traversal attempt", () => {
    expect(safeAttachmentFilename("../../../etc/passwd")).toBe("passwd");
    expect(safeAttachmentFilename("..\\..\\windows\\system32\\config")).toBe("config");
  });

  it("strips leading dots so nothing becomes a hidden or relative name", () => {
    expect(safeAttachmentFilename("...hidden.pdf")).toBe("hidden.pdf");
    expect(safeAttachmentFilename("..")).toBe("attachment");
    expect(safeAttachmentFilename(".")).toBe("attachment");
  });

  it("replaces every character that is not safe in an object key", () => {
    expect(safeAttachmentFilename("interview brief (final).pdf")).toBe(
      "interview_brief__final_.pdf",
    );
    expect(safeAttachmentFilename("réponse?x=1&y=2.pdf")).toBe("r_ponse_x_1_y_2.pdf");
  });

  it("never returns an empty name", () => {
    expect(safeAttachmentFilename("")).toBe("attachment");
    expect(safeAttachmentFilename("///")).toBe("attachment");
    expect(safeAttachmentFilename("!!!")).toBe("attachment");
  });

  it("truncates an absurdly long name from the front, keeping the extension", () => {
    const name = safeAttachmentFilename(`${"a".repeat(400)}.pdf`);
    expect(name).toHaveLength(120);
    expect(name.endsWith(".pdf")).toBe(true);
  });

  it("leaves an ordinary filename alone", () => {
    expect(safeAttachmentFilename("interview-brief_v2.pdf")).toBe("interview-brief_v2.pdf");
  });
});

describe("attachment object paths", () => {
  it("scopes every upload under the sending user's folder", () => {
    const path = messageAttachmentPath(USER_ID, "brief.pdf");
    expect(path).toMatch(new RegExp(`^outbound/${USER_ID}/[0-9a-f-]{36}-brief\\.pdf$`));
  });

  it("gives two uploads of the same filename different paths", () => {
    expect(messageAttachmentPath(USER_ID, "brief.pdf")).not.toBe(
      messageAttachmentPath(USER_ID, "brief.pdf"),
    );
  });

  it("sanitises the filename on the way into the path", () => {
    expect(messageAttachmentPath(USER_ID, "../secrets.env")).toContain("-secrets.env");
    expect(messageAttachmentPath(USER_ID, "../secrets.env")).not.toContain("..");
  });
});

describe("file sizes read the way the design shows them", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1 KB"],
    [122880, "120 KB"],
    [2516582, "2.4 MB"],
    [10485760, "10 MB"],
    [1073741824, "1 GB"],
  ])("renders %i bytes as %s", (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });

  it("returns nothing for a nonsense size rather than NaN", () => {
    expect(formatFileSize(Number.NaN)).toBe("");
    expect(formatFileSize(-1)).toBe("");
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe("");
  });
});
