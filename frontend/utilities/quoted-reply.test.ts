import { describe, expect, it } from "vitest";

import { splitQuotedReply, stripQuotedReply } from "@/utilities/quoted-reply";

describe("stripQuotedReply — Gmail and Apple Mail", () => {
  it("stops at a single-line attribution", () => {
    const body = [
      "Thanks — Thursday works.",
      "",
      "On Mon, 23 Jun 2026, Rowan wrote:",
      "> earlier",
    ].join("\n");

    expect(stripQuotedReply(body)).toBe("Thanks — Thursday works.");
  });

  it("stops at an attribution the client wrapped across two lines", () => {
    const body = [
      "Yes, that time suits.",
      "",
      "On Thu, 6 Aug 2026 at 13:59, Rowan <talent@hiring.example.com>",
      "wrote:",
      "",
      "> the original message",
    ].join("\n");

    expect(stripQuotedReply(body)).toBe("Yes, that time suits.");
  });

  it("stops at a bare quote marker even with no attribution line", () => {
    expect(stripQuotedReply("New text\n> quoted\n> more")).toBe("New text");
  });

  it("keeps every paragraph written above the quote", () => {
    const body = ["First paragraph.", "", "Second paragraph.", "", "> quoted history"].join("\n");

    expect(stripQuotedReply(body)).toBe("First paragraph.\n\nSecond paragraph.");
  });
});

describe("stripQuotedReply — Outlook", () => {
  it("stops at an original-message separator", () => {
    expect(stripQuotedReply("New\n-----Original Message-----\nFrom: someone")).toBe("New");
  });

  it("stops at a forwarded-message separator", () => {
    expect(stripQuotedReply("See below.\n---- Forwarded message ----\nFrom: someone")).toBe(
      "See below.",
    );
  });

  it("stops at 'Begin forwarded message:'", () => {
    expect(stripQuotedReply("FYI\n\nBegin forwarded message:\n\nFrom: someone")).toBe("FYI");
  });

  it("drops the underscore divider that precedes the header block", () => {
    const body = [
      "Happy to help.",
      "",
      "________________________________",
      "From: Talent <talent@hiring.example.com>",
      "Sent: Thursday, 6 August 2026 13:59",
      "To: Rowan",
      "Subject: testing",
    ].join("\n");

    expect(stripQuotedReply(body)).toBe("Happy to help.");
  });
});

describe("stripQuotedReply — Zoho", () => {
  it("stops at the From/To/Date/Subject block a reply carries inline", () => {
    const body = [
      "yep working good i guess",
      "",
      "From: rowan.mills <talent@hiring.example.com>",
      "To: <rowan.mills@example.com>",
      "Date: Thu, 06 Aug 2026 13:59:53 +0500",
      "Subject: testing",
      "",
      "testing kdslfnlsdkfnj sldfkjslfkj sdf",
    ].join("\n");

    expect(stripQuotedReply(body)).toBe("yep working good i guess");
  });

  it("stops at the dashed attribution line", () => {
    const body = [
      "Sounds good.",
      "",
      "---- On Thu, 06 Aug 2026 13:59:53 +0500 Rowan <rowan@example.com> wrote ----",
      "",
      "the original",
    ].join("\n");

    expect(stripQuotedReply(body)).toBe("Sounds good.");
  });
});

describe("stripQuotedReply — fails safe", () => {
  it("returns a body with no quote unchanged", () => {
    const body = "Hello,\n\nI am still interested in the role.\n\nAmara";
    expect(stripQuotedReply(body)).toBe(body);
  });

  it("returns the whole body when the reply is nothing but a quote", () => {
    expect(stripQuotedReply("> only quoted")).toBe("> only quoted");
  });

  it("returns the whole body when a header block is all there is", () => {
    const body = ["From: Talent <talent@example.com>", "To: Rowan", "Subject: testing"].join("\n");
    expect(stripQuotedReply(body)).toBe(body);
  });

  it("does not treat an ordinary sentence ending in 'wrote:' as an attribution", () => {
    const body = "Here is what the hiring manager wrote:\n\nWe would like to meet you.";
    expect(stripQuotedReply(body)).toBe(body);
  });

  it("does not treat a lone From: line as a header block", () => {
    const body = "Please forward this.\n\nFrom: the desk of Amara\n\nThanks";
    expect(stripQuotedReply(body)).toBe(body);
  });

  it("needs two following headers, not one", () => {
    const body = "Details below.\n\nFrom: Sales\nSubject: pricing\n\nStill me writing.";
    expect(stripQuotedReply(body)).toBe(body);
  });

  it("leaves an arrow bullet alone", () => {
    const body = "Next steps:\n-> call on Monday\n-> send the brief";
    expect(stripQuotedReply(body)).toBe(body);
  });

  it("does not strip a signature, which is not a quote", () => {
    const body = "On my way.\n\nSent from my iPhone";
    expect(stripQuotedReply(body)).toBe(body);
  });

  it("is empty for an empty body", () => {
    expect(stripQuotedReply(null)).toBe("");
    expect(stripQuotedReply("")).toBe("");
    expect(stripQuotedReply("   \n  ")).toBe("");
  });
});

describe("splitQuotedReply", () => {
  it("hands back the quoted history so nothing is lost", () => {
    const split = splitQuotedReply("Short answer.\n\n> the long question\n> continued");

    expect(split.visible).toBe("Short answer.");
    expect(split.quoted).toBe("> the long question\n> continued");
  });

  it("reports no quote when it found no confident boundary", () => {
    const split = splitQuotedReply("Just a note.");

    expect(split.visible).toBe("Just a note.");
    expect(split.quoted).toBe("");
  });

  it("reports no quote when the quote is the whole body", () => {
    const split = splitQuotedReply("> everything is quoted");

    expect(split.visible).toBe("> everything is quoted");
    expect(split.quoted).toBe("");
  });

  it("normalizes CRLF line endings before looking for the boundary", () => {
    const split = splitQuotedReply("Reply text\r\n\r\n> quoted\r\n");

    expect(split.visible).toBe("Reply text");
    expect(split.quoted).toBe("> quoted");
  });
});
