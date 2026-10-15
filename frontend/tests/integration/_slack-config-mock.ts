import type {
  SlackDeliveryConfig,
  SlackDeliveryConfigResult,
} from "@/configurations/slack-delivery-config";

export const FAKE_CHANNEL_ID = "CL3SLACKTEST";
export const FAKE_BOT_TOKEN = "xoxb-l3-0000000000-1111111111-notarealslacktoken";

const CONFIGURED: SlackDeliveryConfig = {
  enabled: true,
  channelId: FAKE_CHANNEL_ID,
  botToken: FAKE_BOT_TOKEN,
};

const state: { result: SlackDeliveryConfigResult } = {
  result: { kind: "config", config: CONFIGURED },
};

export async function fakeReadSlackDeliveryConfig(): Promise<SlackDeliveryConfigResult> {
  return state.result;
}

export function resetSlackDeliveryConfig(): void {
  state.result = { kind: "config", config: CONFIGURED };
}

export function makeSlackSwitchedOff(): void {
  state.result = { kind: "config", config: { ...CONFIGURED, enabled: false } };
}

export function makeSlackConfigUnreadable(error: string): void {
  state.result = { kind: "error", error };
}
