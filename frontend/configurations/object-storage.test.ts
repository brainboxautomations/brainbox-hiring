// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.R2_ACCOUNT_ID = "testaccount";
  process.env.R2_ACCESS_KEY_ID = "test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret-key";
  process.env.R2_BUCKET = "openhr-test";
});

const storage = () => import("@/configurations/object-storage");

describe("objectKey", () => {
  it("puts each old bucket's paths under a folder of the same name", async () => {
    const { objectKey } = await storage();
    expect(objectKey("resumes", "applications/p/x-cv.pdf")).toBe("resumes/applications/p/x-cv.pdf");
    expect(objectKey("message-attachments", "inbound/e/a.png")).toBe(
      "message-attachments/inbound/e/a.png",
    );
  });

  it("refuses a path that could reach outside its folder", async () => {
    const { objectKey } = await storage();
    expect(() => objectKey("resumes", "../videos/x.mp4")).toThrow();
    expect(() => objectKey("resumes", "/applications/x.pdf")).toThrow();
    expect(() => objectKey("resumes", "")).toThrow();
  });
});

describe("signUpload", () => {
  // R2 has no per-folder size or type limits, so the signature is the limit:
  // a PUT with a different Content-Length or Content-Type must not verify.
  it("signs the exact size and type into the upload URL", async () => {
    const { signUpload, UPLOAD_URL_TTL_SECONDS } = await storage();
    const url = new URL(
      await signUpload("resumes", "applications/p/x-cv.pdf", {
        contentType: "application/pdf",
        size: 1234,
      }),
    );

    expect(url.host).toBe("openhr-test.testaccount.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/resumes/applications/p/x-cv.pdf");
    const signed = url.searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [];
    expect(signed).toEqual(expect.arrayContaining(["content-length", "content-type", "host"]));
    expect(url.searchParams.get("X-Amz-Expires")).toBe(String(UPLOAD_URL_TTL_SECONDS));
  });
});

describe("signDownload", () => {
  it("gives a one-hour link to the file", async () => {
    const { signDownload } = await storage();
    const url = new URL(await signDownload("videos", "applications/p/x-intro.webm"));
    expect(url.pathname).toBe("/videos/applications/p/x-intro.webm");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
  });
});
