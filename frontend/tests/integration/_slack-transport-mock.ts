import type { SlackMessage, SlackPostResult } from "@/configurations/slack-transport";

export class FakeSlackPostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlackPostError";
  }
}

export type SlackPostRecord = {
  token: string;
  message: SlackMessage;
};

type Behaviour =
  | { kind: "accept" }
  | { kind: "reject"; message: string }
  | { kind: "http-error"; status: number }
  | { kind: "never-answer" };

const state: {
  posted: SlackPostRecord[];
  behaviour: Behaviour;
} = {
  posted: [],
  behaviour: { kind: "accept" },
};

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

export const fakeSlackTransport = {
  async postMessage(
    token: string,
    message: SlackMessage,
    signal: AbortSignal,
  ): Promise<SlackPostResult> {
    if (state.behaviour.kind === "reject") {
      throw new FakeSlackPostError(state.behaviour.message);
    }

    if (state.behaviour.kind === "http-error") {
      throw new FakeSlackPostError(`Slack answered ${state.behaviour.status}`);
    }

    if (state.behaviour.kind === "never-answer") {
      return waitForAbort(signal);
    }

    state.posted.push({ token, message });
    return { messageTs: `${Date.now() / 1000}` };
  },
};

export function slackPosts(): SlackPostRecord[] {
  return state.posted;
}

export function lastSlackPost(): SlackPostRecord | undefined {
  return state.posted[state.posted.length - 1];
}

export function resetSlackTransport(): void {
  state.posted = [];
  state.behaviour = { kind: "accept" };
}

export function makeSlackReject(message: string): void {
  state.behaviour = { kind: "reject", message };
}

export function makeSlackAnswerWithStatus(status: number): void {
  state.behaviour = { kind: "http-error", status };
}

export function makeSlackNeverAnswer(): void {
  state.behaviour = { kind: "never-answer" };
}
