import { describe, expect, it } from "vitest";

import { MAX_VIDEO_LINK_LENGTH, parseVideoLink } from "@/utilities/video-link";

describe("parseVideoLink — rejects anything not an https allowlisted provider", () => {
  it.each([
    ["a non-provider host", "https://evil.example.com/video/123"],
    ["a lookalike host", "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ"],
    ["http (mixed content)", "http://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html;base64,PHNjcmlwdD4="],
    ["a bare string", "not a url"],
    ["an empty string", ""],
    ["whitespace only", "   "],
  ])("rejects %s", (_label, input) => {
    expect(parseVideoLink(input)).toBeNull();
  });

  it("rejects a provider host with no extractable video id", () => {
    expect(parseVideoLink("https://www.youtube.com/")).toBeNull();
    expect(parseVideoLink("https://vimeo.com/channels/staffpicks")).toBeNull();
    expect(parseVideoLink("https://www.loom.com/share/nope")).toBeNull();
  });

  it("rejects a URL longer than MAX_VIDEO_LINK_LENGTH", () => {
    const long = `https://www.youtube.com/watch?v=dQw4w9WgXcQ&pad=${"x".repeat(MAX_VIDEO_LINK_LENGTH)}`;
    expect(parseVideoLink(long)).toBeNull();
  });
});

describe("parseVideoLink — YouTube", () => {
  it.each([
    ["watch URL", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["short URL", "https://youtu.be/dQw4w9WgXcQ"],
    ["embed URL", "https://www.youtube.com/embed/dQw4w9WgXcQ"],
    ["shorts URL", "https://www.youtube.com/shorts/dQw4w9WgXcQ"],
    ["mobile URL", "https://m.youtube.com/watch?v=dQw4w9WgXcQ"],
  ])("extracts the id from a %s", (_label, input) => {
    const parsed = parseVideoLink(input);
    expect(parsed).toMatchObject({
      provider: "youtube",
      watchUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });

    expect(parsed?.embedUrl).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });

  it("carries a plain-seconds start offset into both URLs", () => {
    const parsed = parseVideoLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90");
    expect(parsed?.watchUrl).toContain("t=90");
    expect(parsed?.embedUrl).toContain("start=90");
  });

  it("parses a compound 1m30s start offset to 90 seconds", () => {
    const parsed = parseVideoLink("https://youtu.be/dQw4w9WgXcQ?t=1m30s");
    expect(parsed?.embedUrl).toContain("start=90");
  });

  it("ignores a zero or unparseable start offset", () => {
    expect(parseVideoLink("https://youtu.be/dQw4w9WgXcQ?t=0")?.embedUrl).not.toContain("start");
    expect(parseVideoLink("https://youtu.be/dQw4w9WgXcQ?t=abc")?.embedUrl).not.toContain("start");
  });
});

describe("parseVideoLink — Vimeo", () => {
  it("parses a plain video URL", () => {
    expect(parseVideoLink("https://vimeo.com/123456789")).toEqual({
      provider: "vimeo",
      watchUrl: "https://vimeo.com/123456789",
      embedUrl: "https://player.vimeo.com/video/123456789",
    });
  });

  it("preserves the unlisted hash given as a path segment", () => {
    const parsed = parseVideoLink("https://vimeo.com/123456789/abc123def4");
    expect(parsed?.watchUrl).toBe("https://vimeo.com/123456789/abc123def4");
    expect(parsed?.embedUrl).toContain("h=abc123def4");
  });

  it("preserves the unlisted hash given as ?h=", () => {
    const parsed = parseVideoLink("https://vimeo.com/123456789?h=abc123def4");
    expect(parsed?.embedUrl).toContain("h=abc123def4");
  });

  it("finds the id in a channel path", () => {
    expect(parseVideoLink("https://vimeo.com/channels/staffpicks/123456789")?.watchUrl).toBe(
      "https://vimeo.com/123456789",
    );
  });
});

describe("parseVideoLink — Loom", () => {
  it("normalises a share URL to share + embed pair", () => {
    const id = "a".repeat(32);
    expect(parseVideoLink(`https://www.loom.com/share/${id}`)).toEqual({
      provider: "loom",
      watchUrl: `https://www.loom.com/share/${id}`,
      embedUrl: `https://www.loom.com/embed/${id}`,
    });
  });

  it("accepts an embed URL and still yields the canonical share URL", () => {
    const id = "b".repeat(32);
    expect(parseVideoLink(`https://loom.com/embed/${id}`)?.watchUrl).toBe(
      `https://www.loom.com/share/${id}`,
    );
  });

  it("drops query strings rather than passing them through to the iframe", () => {
    const id = "c".repeat(32);
    const parsed = parseVideoLink(`https://www.loom.com/share/${id}?sid=tracking&t=10`);
    expect(parsed?.embedUrl).toBe(`https://www.loom.com/embed/${id}`);
  });
});

describe("parseVideoLink — Google Drive", () => {
  it("parses the /file/d/<id>/view form", () => {
    expect(parseVideoLink("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view")).toEqual({
      provider: "drive",
      watchUrl: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view",
      embedUrl: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/preview",
    });
  });

  it("parses the ?id= form", () => {
    expect(parseVideoLink("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp")?.watchUrl).toBe(
      "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view",
    );
  });

  it("rejects a too-short id", () => {
    expect(parseVideoLink("https://drive.google.com/open?id=short")).toBeNull();
  });
});
