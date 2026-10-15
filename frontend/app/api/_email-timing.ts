import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";
import type { EmailTimingSettings } from "@/types/api";

/** As migration 0054 seeds them; used if the row cannot be read. */
export const DEFAULT_EMAIL_TIMING: EmailTimingSettings = {
  automationSafetyDelayMinutes: 20,
  sendUndoMinutes: 30,
};

export async function readEmailTiming(
  supabase: SupabaseClient<Database>,
): Promise<EmailTimingSettings> {
  const { data } = await supabase
    .from("email_timing_settings")
    .select("automation_safety_delay_minutes, send_undo_minutes")
    .eq("id", true)
    .maybeSingle();

  if (!data) return DEFAULT_EMAIL_TIMING;
  return {
    automationSafetyDelayMinutes: data.automation_safety_delay_minutes,
    sendUndoMinutes: data.send_undo_minutes,
  };
}

/**
 * When an email a person sends now should actually go out: after the undo
 * window, or null to send at once when the window is off.
 */
export function undoWindowSendTime(timing: EmailTimingSettings, now: Date): string | null {
  if (timing.sendUndoMinutes <= 0) return null;
  return new Date(now.getTime() + timing.sendUndoMinutes * 60_000).toISOString();
}
