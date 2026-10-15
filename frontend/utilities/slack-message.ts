import { stripQuotedReply } from "@/utilities/quoted-reply";

export type InboundEmailNotification = {
  candidateName: string;
  candidateEmail: string;
  positionTitle: string | null;
  /** Their current stage, and when they entered it (migration 0046). */
  stageName?: string | null;
  stageEnteredAt?: string | null;
  subject: string | null;
  body: string | null;
  candidateUrl: string | null;
};

/** A Slack Block Kit block. Only the handful of shapes built below are used. */
export type SlackBlock = Record<string, unknown>;

export type SlackMessageContent = {
  /** Shown in notifications and anywhere blocks cannot render. */
  text: string;
  blocks: SlackBlock[];
};

export const SLACK_BODY_PREVIEW_LIMIT = 400;

/** The notification line is read on a lock screen; keep it to a glance. */
export const SLACK_FALLBACK_PREVIEW_LIMIT = 150;

export function escapeSlackText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function previewBody(body: string | null, limit = SLACK_BODY_PREVIEW_LIMIT): string {
  const collapsed = (body ?? "").replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit).trimEnd()}…`;
}

/**
 * What the candidate actually wrote this time, with its line breaks.
 *
 * Replies carry the whole earlier thread under an "On …, … wrote:" line, and
 * posting that turned every notification into a wall of our own email quoted
 * back. The quote is cut off here, the same way the Inbox previews do it.
 */
export function replyPreview(body: string | null, limit = SLACK_BODY_PREVIEW_LIMIT): string {
  const visible = stripQuotedReply(body)
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (visible.length <= limit) return visible;
  return `${visible.slice(0, limit).trimEnd()}…`;
}

/**
 * "12 minutes", "3 hours", "2 days": how long someone has been in their stage,
 * rounded down to the largest whole unit, the way the board card counts it.
 */
export function describeTimeInStage(enteredAt: string, now: Date = new Date()): string | null {
  const then = new Date(enteredAt).getTime();
  if (Number.isNaN(then)) return null;

  const minutes = Math.max(0, Math.floor((now.getTime() - then) / 60_000));
  const unit = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

  if (minutes < 60) return unit(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit(hours, "hour");
  return unit(Math.floor(hours / 24), "day");
}

/** "Interview · 2 days in stage", or just the stage when its timing is unknown. */
function stageLine(notification: InboundEmailNotification, now: Date): string | null {
  if (!notification.stageName) return null;
  const stage = escapeSlackText(notification.stageName);
  const elapsed = notification.stageEnteredAt
    ? describeTimeInStage(notification.stageEnteredAt, now)
    : null;
  return elapsed ? `${stage} · ${elapsed} in stage` : stage;
}

function quoteBlockText(text: string): string {
  return text
    .split("\n")
    .map((line) => `>${line ? ` ${line}` : ""}`)
    .join("\n");
}

/**
 * The Slack post for a candidate's email reply.
 *
 * Laid out as a heading line, the reply itself, and the details underneath,
 * rather than one run-on paragraph. Every value from the email is escaped, so
 * a reply cannot forge Slack markup or links. The link to Brainbox is plain
 * rather than a button: link buttons depend on the Slack app's interactivity
 * settings and show a warning when those are not set up, and unfurling is
 * turned off where the message is sent, so it no longer expands into a
 * preview of the sign-in page.
 */
export function inboundEmailSlackMessage(
  notification: InboundEmailNotification,
  now: Date = new Date(),
): SlackMessageContent {
  const name = escapeSlackText(notification.candidateName);
  const position = notification.positionTitle ? escapeSlackText(notification.positionTitle) : null;
  const reply = replyPreview(notification.body);

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        // The stage says where they are in the process, which is what decides
        // how urgent the reply is.
        text: [
          `:envelope_with_arrow: *${name}* replied${position ? ` · ${position}` : ""}`,
          stageLine(notification, now),
        ]
          .filter(Boolean)
          .join("\n"),
      },
    },
  ];

  if (reply) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: quoteBlockText(escapeSlackText(reply)) },
    });
  }

  const details = [
    escapeSlackText(notification.candidateEmail),
    notification.subject ? escapeSlackText(notification.subject) : null,
  ].filter((part): part is string => Boolean(part));
  if (details.length > 0) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: details.join("  ·  ") }] });
  }

  if (notification.candidateUrl) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `<${notification.candidateUrl}|Open in BrainBox →>` },
    });
  }

  const glance = previewBody(stripQuotedReply(notification.body), SLACK_FALLBACK_PREVIEW_LIMIT);
  const text = `${notification.candidateName} replied${
    notification.positionTitle ? ` (${notification.positionTitle})` : ""
  }${glance ? `: ${glance}` : ""}`;

  return { text: escapeSlackText(text), blocks };
}
