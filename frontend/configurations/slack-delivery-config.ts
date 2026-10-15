import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export type SlackDeliveryConfig = {
  enabled: boolean;
  channelId: string | null;
  botToken: string | null;
};

export type SlackDeliveryConfigResult =
  | { kind: "config"; config: SlackDeliveryConfig }
  | { kind: "error"; error: string };

export async function readSlackDeliveryConfig(
  supabase: SupabaseClient<Database>,
): Promise<SlackDeliveryConfigResult> {
  const { data, error } = await supabase.rpc("slack_delivery_config");

  if (error) {
    return { kind: "error", error: `The Slack configuration could not be read: ${error.message}` };
  }

  const row = data?.[0];
  if (!row) return { kind: "error", error: "The Slack configuration row is missing" };

  return {
    kind: "config",
    config: { enabled: row.enabled, channelId: row.channel_id, botToken: row.bot_token },
  };
}
