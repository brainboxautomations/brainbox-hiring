import type { SupabaseClient } from "@supabase/supabase-js";

import { mapSlackSettings } from "@/app/api/_mappers";
import type { Database } from "@/types/database.types";
import type { SlackSettings } from "@/types/api";

const SLACK_CONFIG_SELECT = "channel_id, channel_name, enabled";

export async function readSlackSettings(
  supabase: SupabaseClient<Database>,
): Promise<{ slack: SlackSettings } | { error: string }> {
  const config = await supabase
    .from("slack_config")
    .select(SLACK_CONFIG_SELECT)
    .eq("id", true)
    .single();

  if (config.error || !config.data) {
    return { error: config.error?.message ?? "The Slack settings row is missing" };
  }

  const tokenState = await supabase.rpc("slack_bot_token_state");
  if (tokenState.error) return { error: tokenState.error.message };

  return { slack: mapSlackSettings(config.data, tokenState.data?.[0] ?? null) };
}
