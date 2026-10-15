import type { SlackBlock } from "@/utilities/slack-message";

export type SlackMessage = {
  channelId: string;
  /** Always sent: Slack shows it in notifications, and wherever blocks cannot render. */
  text: string;
  blocks?: SlackBlock[];
};

export type SlackPostResult = {
  messageTs: string;
};

export type SlackTransport = {
  postMessage(token: string, message: SlackMessage, signal: AbortSignal): Promise<SlackPostResult>;
};

export class SlackPostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlackPostError";
  }
}

const POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

type PostMessageResponse = {
  ok?: unknown;
  ts?: unknown;
  error?: unknown;
};

function readErrorCode(body: PostMessageResponse): string {
  return typeof body.error === "string" && body.error.length > 0 ? body.error : "unknown_error";
}

function readTimestamp(body: PostMessageResponse): string | null {
  return typeof body.ts === "string" && body.ts.length > 0 ? body.ts : null;
}

async function readBody(response: Response): Promise<PostMessageResponse> {
  try {
    return (await response.json()) as PostMessageResponse;
  } catch {
    return {};
  }
}

function createSlackWebApiTransport(): SlackTransport {
  return {
    async postMessage(token, message, signal) {
      const response = await fetch(POST_MESSAGE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          channel: message.channelId,
          text: message.text,
          ...(message.blocks ? { blocks: message.blocks } : {}),
          // The only link is back into Brainbox, which needs a sign-in; its
          // preview card was the login page's title, pure noise in a channel.
          unfurl_links: false,
          unfurl_media: false,
        }),
        signal,
      });

      const body = await readBody(response);

      if (!response.ok) {
        throw new SlackPostError(`Slack answered ${response.status} ${response.statusText}`.trim());
      }

      if (body.ok !== true) {
        throw new SlackPostError(`Slack refused the message: ${readErrorCode(body)}`);
      }

      const messageTs = readTimestamp(body);
      if (!messageTs) {
        throw new SlackPostError("Slack accepted the message but returned no timestamp");
      }

      return { messageTs };
    },
  };
}

let transport: SlackTransport | null = null;

export function getSlackTransport(): SlackTransport {
  if (!transport) transport = createSlackWebApiTransport();
  return transport;
}
