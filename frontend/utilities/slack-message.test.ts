import { describe, expect, it } from "vitest";

import {
  SLACK_BODY_PREVIEW_LIMIT,
  describeTimeInStage,
  escapeSlackText,
  inboundEmailSlackMessage,
  previewBody,
  replyPreview,
  type InboundEmailNotification,
} from "@/utilities/slack-message";

function notification(overrides: Partial<InboundEmailNotification> = {}): InboundEmailNotification {
  return {
    candidateName: "Amara Okafor",
    candidateEmail: "amara@example.com",
    positionTitle: "Senior Frontend Engineer",
    subject: "Re: Your interview",
    body: "Thursday afternoon works well for me.",
    candidateUrl: "https://app.example.com/candidates/abc",
    ...overrides,
  };
}

describe("escapeSlackText", () => {
  it("escapes the three characters Slack treats as markup", () => {
    expect(escapeSlackText("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });

  it("escapes the ampersand first, so an escaped angle bracket is not double-escaped", () => {
    expect(escapeSlackText("<b>")).toBe("&lt;b&gt;");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeSlackText("Thursday works")).toBe("Thursday works");
  });
});

describe("previewBody", () => {
  it("collapses newlines and runs of whitespace into single spaces", () => {
    expect(previewBody("Hello\n\n   there\tfriend")).toBe("Hello there friend");
  });

  it("returns an empty string for a body that is missing", () => {
    expect(previewBody(null)).toBe("");
  });

  it("keeps a body that is exactly at the limit whole", () => {
    const body = "x".repeat(SLACK_BODY_PREVIEW_LIMIT);
    expect(previewBody(body)).toBe(body);
    expect(previewBody(body)).not.toContain("…");
  });

  it("truncates a longer body and marks it as truncated", () => {
    const preview = previewBody("y".repeat(SLACK_BODY_PREVIEW_LIMIT + 50));
    expect(preview).toHaveLength(SLACK_BODY_PREVIEW_LIMIT + 1);
    expect(preview.endsWith("…")).toBe(true);
  });
});

// Every block's text, in order, so assertions read like the rendered post.
function blockTexts(n: InboundEmailNotification): string[] {
  return inboundEmailSlackMessage(n).blocks.map((block) => {
    const text = block.text as { text?: string } | undefined;
    if (text?.text) return text.text;
    const elements = block.elements as { text: string }[] | undefined;
    return (elements ?? []).map((element) => element.text).join(" ");
  });
}

const GMAIL_REPLY = [
  "Thursday afternoon works well for me.",
  "",
  "Thanks,",
  "Amara",
  "",
  "On Fri, 25 Sept 2026, 10:48 am Acme Talent, <",
  "talent@hiring.example.com> wrote:",
  "",
  "> Hi Amara, are you free this week?",
  ">",
].join("\n");

describe("replyPreview", () => {
  // Posting the whole reply put our own earlier email back into the channel
  // under every notification, run together on one line.
  it("keeps only what the candidate wrote, cutting Gmail's quoted thread", () => {
    expect(replyPreview(GMAIL_REPLY)).toBe(
      "Thursday afternoon works well for me.\n\nThanks,\nAmara",
    );
  });

  it("truncates a long reply and marks it", () => {
    const preview = replyPreview("x".repeat(SLACK_BODY_PREVIEW_LIMIT + 10));
    expect(preview).toHaveLength(SLACK_BODY_PREVIEW_LIMIT + 1);
    expect(preview.endsWith("…")).toBe(true);
  });
});

describe("describeTimeInStage", () => {
  const now = new Date("2026-09-25T12:00:00Z");

  it("counts minutes, then hours, then whole days", () => {
    expect(describeTimeInStage("2026-09-25T11:59:30Z", now)).toBe("0 minutes");
    expect(describeTimeInStage("2026-09-25T11:59:00Z", now)).toBe("1 minute");
    expect(describeTimeInStage("2026-09-25T09:10:00Z", now)).toBe("2 hours");
    expect(describeTimeInStage("2026-09-24T11:00:00Z", now)).toBe("1 day");
    expect(describeTimeInStage("2026-09-15T12:00:00Z", now)).toBe("10 days");
  });

  it("never goes negative when clocks disagree, and ignores bad input", () => {
    expect(describeTimeInStage("2026-09-25T12:05:00Z", now)).toBe("0 minutes");
    expect(describeTimeInStage("not a date", now)).toBeNull();
  });
});

describe("inboundEmailSlackMessage", () => {
  it("leads with who replied and for which role", () => {
    expect(blockTexts(notification())[0]).toBe(
      ":envelope_with_arrow: *Amara Okafor* replied · Senior Frontend Engineer",
    );
  });

  it("omits the role when the sender has no application", () => {
    expect(blockTexts(notification({ positionTitle: null }))[0]).toBe(
      ":envelope_with_arrow: *Amara Okafor* replied",
    );
  });

  it("says which stage they are in and for how long, under the heading", () => {
    const now = new Date("2026-09-25T12:00:00Z");
    const { blocks } = inboundEmailSlackMessage(
      notification({ stageName: "Interview", stageEnteredAt: "2026-09-23T09:00:00Z" }),
      now,
    );
    expect((blocks[0]!.text as { text: string }).text).toBe(
      ":envelope_with_arrow: *Amara Okafor* replied · Senior Frontend Engineer\nInterview · 2 days in stage",
    );
  });

  it("shows the stage alone when its start time is unknown", () => {
    expect(blockTexts(notification({ stageName: "Screening", stageEnteredAt: null }))[0]).toBe(
      ":envelope_with_arrow: *Amara Okafor* replied · Senior Frontend Engineer\nScreening",
    );
  });

  it("escapes the stage name, since admins can name stages anything", () => {
    expect(blockTexts(notification({ stageName: "<Final>" }))[0]).toContain("&lt;Final&gt;");
  });

  it("quotes only the new reply, line by line, without the earlier thread", () => {
    const quote = blockTexts(notification({ body: GMAIL_REPLY }))[1]!;
    expect(quote).toBe("> Thursday afternoon works well for me.\n>\n> Thanks,\n> Amara");
    expect(quote).not.toContain("wrote:");
    expect(quote).not.toContain("are you free");
  });

  it("puts the address and subject underneath, then the link", () => {
    const texts = blockTexts(notification());
    expect(texts[2]).toBe("amara@example.com  ·  Re: Your interview");
    expect(texts[3]).toBe("<https://app.example.com/candidates/abc|Open in BrainBox →>");
  });

  it("drops the reply, subject and link when there is nothing to put in them", () => {
    const texts = blockTexts(notification({ subject: null, body: null, candidateUrl: null }));
    expect(texts).toEqual([
      ":envelope_with_arrow: *Amara Okafor* replied · Senior Frontend Engineer",
      "amara@example.com",
    ]);
  });

  it("gives notifications a short one-line summary of the new reply only", () => {
    const { text } = inboundEmailSlackMessage(notification({ body: GMAIL_REPLY }));
    expect(text).toBe(
      "Amara Okafor replied (Senior Frontend Engineer): Thursday afternoon works well for me. Thanks, Amara",
    );
  });

  it("escapes candidate-supplied text so a reply cannot forge Slack markup", () => {
    const n = notification({
      candidateName: "<script>",
      subject: "a & b",
      body: "see <https://evil.example|this>",
    });
    const all = [...blockTexts(n), inboundEmailSlackMessage(n).text].join("\n");

    expect(all).toContain("&lt;script&gt;");
    expect(all).toContain("a &amp; b");
    expect(all).toContain("&lt;https://evil.example|this&gt;");
    expect(all).not.toContain("<https://evil.example|this>");
  });

  it("still renders our own link unescaped, because we control it", () => {
    expect(blockTexts(notification({ body: null })).join("\n")).toContain(
      "<https://app.example.com/candidates/abc|Open in BrainBox →>",
    );
  });
});
