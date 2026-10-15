import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";
import type { SlackTransport } from "@/configurations/slack-transport";
import {
  readSlackDeliveryConfig,
  type SlackDeliveryConfig,
} from "@/configurations/slack-delivery-config";
import { inboundEmailSlackMessage } from "@/utilities/slack-message";

export const SLACK_POST_TIMEOUT_MS = 5_000;

export const SLACK_DISABLED_DETAIL = "Slack notifications are switched off";

const MESSAGE_SELECT =
  "id, subject, body, thread_id, people(first_name, last_name, email), applications(stage_entered_at, positions(title), position_stages(name))";

export type SlackNotificationOutcome =
  | { kind: "delivered"; messageTs: string }
  | { kind: "skipped"; detail: string }
  | { kind: "failed"; detail: string };

type NotifyInput = {
  messageId: string;
  appBaseUrl: string;
};

function errorField(error: unknown, field: "name" | "message"): string {
  if (typeof error === "object" && error !== null && field in error) {
    const value = (error as Record<string, unknown>)[field];
    if (typeof value === "string") return value;
  }
  return "";
}

function describeError(error: unknown): string {
  if (errorField(error, "name") === "TimeoutError") {
    return `Slack did not answer within ${SLACK_POST_TIMEOUT_MS}ms`;
  }
  return errorField(error, "message") || "Slack could not be reached";
}

function fullName(first: string | null, last: string | null): string {
  return [first, last].filter((part) => Boolean(part && part.trim())).join(" ") || "A candidate";
}

function threadUrl(appBaseUrl: string, threadId: string | null): string | null {
  const trimmed = appBaseUrl.trim();
  if (!trimmed || !threadId) return null;

  try {
    return `${new URL(trimmed).origin}/inbox/${threadId}`;
  } catch {
    return null;
  }
}

async function recordOutcome(
  supabase: SupabaseClient<Database>,
  messageId: string,
  channelId: string | null,
  outcome: SlackNotificationOutcome,
): Promise<SlackNotificationOutcome> {
  await supabase.from("slack_notifications").insert({
    message_id: messageId,
    channel_id: channelId,
    status: outcome.kind,
    detail: outcome.kind === "delivered" ? null : outcome.detail,
    slack_message_ts: outcome.kind === "delivered" ? outcome.messageTs : null,
  });

  return outcome;
}

async function postToSlack(
  supabase: SupabaseClient<Database>,
  transport: SlackTransport,
  input: NotifyInput,
  config: SlackDeliveryConfig,
): Promise<SlackNotificationOutcome> {
  const channelId = config.channelId;
  if (!config.enabled || !channelId || !config.botToken) {
    return recordOutcome(supabase, input.messageId, channelId, {
      kind: "skipped",
      detail: SLACK_DISABLED_DETAIL,
    });
  }

  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_SELECT)
    .eq("id", input.messageId)
    .maybeSingle();

  if (error || !data) {
    return recordOutcome(supabase, input.messageId, channelId, {
      kind: "failed",
      detail: `The recorded message could not be read back: ${error?.message ?? "not found"}`,
    });
  }

  const { text, blocks } = inboundEmailSlackMessage({
    candidateName: fullName(data.people?.first_name ?? null, data.people?.last_name ?? null),
    candidateEmail: data.people?.email ?? "",
    positionTitle: data.applications?.positions?.title ?? null,
    stageName: data.applications?.position_stages?.name ?? null,
    stageEnteredAt: data.applications?.stage_entered_at ?? null,
    subject: data.subject,
    body: data.body,
    candidateUrl: threadUrl(input.appBaseUrl, data.thread_id),
  });

  try {
    const { messageTs } = await transport.postMessage(
      config.botToken,
      { channelId, text, blocks },
      AbortSignal.timeout(SLACK_POST_TIMEOUT_MS),
    );

    return recordOutcome(supabase, input.messageId, channelId, { kind: "delivered", messageTs });
  } catch (error) {
    return recordOutcome(supabase, input.messageId, channelId, {
      kind: "failed",
      detail: describeError(error),
    });
  }
}

export async function notifySlackOfInboundEmail(
  supabase: SupabaseClient<Database>,
  transport: SlackTransport,
  input: NotifyInput,
): Promise<SlackNotificationOutcome> {
  try {
    const read = await readSlackDeliveryConfig(supabase);

    if (read.kind === "error") {
      return recordOutcome(supabase, input.messageId, null, {
        kind: "failed",
        detail: read.error,
      });
    }

    return await postToSlack(supabase, transport, input, read.config);
  } catch (error) {
    return { kind: "failed", detail: describeError(error) };
  }
}
