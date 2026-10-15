import { describe, expect, it } from "vitest";

import {
  extractAddress,
  extractDisplayName,
  headerValue,
  htmlToPlainText,
  inboundBodyText,
  messagePreview,
  normalizeMessageId,
  normalizeSubject,
  parseMessageIds,
  replySubject,
  threadReferenceIds,
} from "@/utilities/email-headers";

describe("headerValue", () => {
  it("finds a header whatever case the relay used", () => {
    expect(headerValue({ "In-Reply-To": "<a@b.com>" }, "in-reply-to")).toBe("<a@b.com>");
    expect(headerValue({ "in-reply-to": "<a@b.com>" }, "In-Reply-To")).toBe("<a@b.com>");
    expect(headerValue({ "IN-REPLY-TO": "<a@b.com>" }, "in-reply-to")).toBe("<a@b.com>");
  });

  it("treats a blank header as absent", () => {
    expect(headerValue({ "in-reply-to": "   " }, "in-reply-to")).toBeNull();
  });

  it("survives null headers, which is what the relay sends when there are none", () => {
    expect(headerValue(null, "in-reply-to")).toBeNull();
    expect(headerValue(undefined, "references")).toBeNull();
  });
});

describe("normalizeMessageId", () => {
  it("strips the angle brackets a header always carries", () => {
    expect(normalizeMessageId("<0106019f@ap-northeast-1.amazonses.com>")).toBe(
      "0106019f@ap-northeast-1.amazonses.com",
    );
  });

  it("lower-cases so a differently-cased quote still joins", () => {
    expect(normalizeMessageId("<ABC123@Example.COM>")).toBe("abc123@example.com");
  });

  it("rejects anything that is not a message id", () => {
    expect(normalizeMessageId("")).toBeNull();
    expect(normalizeMessageId("   ")).toBeNull();
    expect(normalizeMessageId(null)).toBeNull();
    expect(normalizeMessageId("no-at-sign")).toBeNull();
    expect(normalizeMessageId("<two ids@a.com>")).toBeNull();
    expect(normalizeMessageId(`<${"x".repeat(600)}@a.com>`)).toBeNull();
  });
});

describe("parseMessageIds", () => {
  it("splits a References chain into its ids, in order", () => {
    expect(parseMessageIds("<one@a.com> <two@a.com>\t<three@a.com>")).toEqual([
      "one@a.com",
      "two@a.com",
      "three@a.com",
    ]);
  });

  it("accepts bare ids from a client that omits the brackets", () => {
    expect(parseMessageIds("one@a.com, two@a.com")).toEqual(["one@a.com", "two@a.com"]);
  });

  it("drops duplicates and junk rather than passing them to the query", () => {
    expect(parseMessageIds("<one@a.com> <ONE@A.com> garbage <two@a.com>")).toEqual([
      "one@a.com",
      "two@a.com",
    ]);
  });

  it("caps a hostile References chain", () => {
    const chain = Array.from({ length: 200 }, (_, i) => `<id${i}@a.com>`).join(" ");
    expect(parseMessageIds(chain)).toHaveLength(32);
  });

  it("returns nothing for an absent header", () => {
    expect(parseMessageIds(null)).toEqual([]);
    expect(parseMessageIds("")).toEqual([]);
  });
});

describe("threadReferenceIds", () => {
  it("puts In-Reply-To first — it names the direct parent", () => {
    const ids = threadReferenceIds({
      "In-Reply-To": "<parent@a.com>",
      References: "<root@a.com> <middle@a.com> <parent@a.com>",
    });
    expect(ids[0]).toBe("parent@a.com");
  });

  it("walks References from nearest ancestor outwards", () => {
    const ids = threadReferenceIds({
      References: "<root@a.com> <middle@a.com> <parent@a.com>",
    });
    expect(ids).toEqual(["parent@a.com", "middle@a.com", "root@a.com"]);
  });

  it("is empty when the reply carries no threading headers at all", () => {
    expect(threadReferenceIds({ Subject: "Re: hello" })).toEqual([]);
    expect(threadReferenceIds(null)).toEqual([]);
  });
});

describe("normalizeSubject", () => {
  it("matches a reply to the message it answers", () => {
    expect(normalizeSubject("Re: Your interview at Acme")).toBe("your interview at acme");
    expect(normalizeSubject("Your interview at Acme")).toBe("your interview at acme");
  });

  it("strips a whole stack of forwarding prefixes", () => {
    expect(normalizeSubject("Re: Fwd: RE: Aw: Offer")).toBe("offer");
    expect(normalizeSubject("Re[2]: Offer")).toBe("offer");
  });

  it("collapses whitespace so a wrapped header still matches", () => {
    expect(normalizeSubject("Re:  Your   interview \n at Acme")).toBe("your interview at acme");
  });

  it("gives a subject-less message a stable key rather than an empty one", () => {
    expect(normalizeSubject(null)).toBe("(no subject)");
    expect(normalizeSubject("   ")).toBe("(no subject)");
    expect(normalizeSubject("Re:")).toBe("(no subject)");
  });
});

describe("replySubject", () => {
  it("prefixes once and only once", () => {
    expect(replySubject("Offer")).toBe("Re: Offer");
    expect(replySubject("Re: Offer")).toBe("Re: Offer");
    expect(replySubject("RE: Offer")).toBe("RE: Offer");
  });
});

describe("extractAddress", () => {
  it("pulls the address out of a display-name form", () => {
    expect(extractAddress('"Amara Okafor" <Amara.Okafor@Example.com>')).toBe(
      "Amara.Okafor@example.com",
    );
  });

  it("accepts a bare address", () => {
    expect(extractAddress("amara@example.com")).toBe("amara@example.com");
  });

  it("returns null rather than a half-parsed address", () => {
    expect(extractAddress("not an address")).toBeNull();
    expect(extractAddress("<>")).toBeNull();
    expect(extractAddress(null)).toBeNull();
  });
});

describe("extractDisplayName", () => {
  it("reads the name and drops its quotes", () => {
    expect(extractDisplayName('"Amara Okafor" <amara@example.com>')).toBe("Amara Okafor");
    expect(extractDisplayName("Amara Okafor <amara@example.com>")).toBe("Amara Okafor");
  });

  it("is empty for a bare address", () => {
    expect(extractDisplayName("amara@example.com")).toBe("");
  });
});

describe("htmlToPlainText", () => {
  it("keeps the words and loses the markup", () => {
    expect(htmlToPlainText("<p>Hello <b>Amara</b></p><p>Second</p>")).toBe("Hello Amara\nSecond");
  });

  it("turns breaks into newlines", () => {
    expect(htmlToPlainText("one<br>two<br/>three")).toBe("one\ntwo\nthree");
  });

  it("never lets script or style content reach the reader", () => {
    const text = htmlToPlainText("<style>p{color:red}</style><script>alert(1)</script><p>hi</p>");
    expect(text).toBe("hi");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color");
  });

  it("decodes entities so a candidate's ampersand reads correctly", () => {
    expect(htmlToPlainText("<p>R&amp;D &lt;team&gt; &#39;now&#39; &nbsp;here</p>")).toBe(
      "R&D <team> 'now' here",
    );
  });

  it("is empty for empty input", () => {
    expect(htmlToPlainText(null)).toBe("");
    expect(htmlToPlainText("")).toBe("");
  });
});

describe("inboundBodyText", () => {
  it("prefers the plain-text part the sender's client supplied", () => {
    expect(inboundBodyText({ text: "plain wins", html: "<p>html loses</p>" })).toBe("plain wins");
  });

  it("falls back to the HTML part when there is no text part", () => {
    expect(inboundBodyText({ text: null, html: "<p>only html</p>" })).toBe("only html");
  });

  it("returns an empty string when the message has no body at all", () => {
    expect(inboundBodyText({ text: null, html: null })).toBe("");
  });
});

describe("messagePreview", () => {
  it("collapses a reply to a single line of new text", () => {
    expect(messagePreview("Hi there\n\nSee below\n\n> quoted")).toBe("Hi there See below");
  });

  it("truncates with an ellipsis rather than overflowing the list row", () => {
    const preview = messagePreview("x".repeat(400), 20);
    expect(preview).toHaveLength(20);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("is empty for an empty body", () => {
    expect(messagePreview(null)).toBe("");
  });
});
