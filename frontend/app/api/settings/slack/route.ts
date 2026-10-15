import { NextResponse, type NextRequest } from "next/server";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapSlackSettings } from "@/app/api/_mappers";
import { readSlackSettings } from "@/app/api/settings/slack/_read";
import { slackConfigSchema } from "@/schemas/settings-schema";

export async function GET() {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const result = await readSlackSettings(ctx.supabase);
  if ("error" in result) return apiError(result.error, 500);

  return NextResponse.json({ slack: result.slack });
}

export async function PUT(request: NextRequest) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body");
  }

  const parsed = slackConfigSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid Slack settings");
  }

  const current = await readSlackSettings(supabase);
  if ("error" in current) return apiError(current.error, 500);

  if (parsed.data.enabled && !current.slack.tokenConfigured) {
    return apiError("Add a bot token before turning notifications on");
  }

  try {
    const { data, error } = await supabase
      .from("slack_config")
      .update({
        channel_id: parsed.data.channelId,
        channel_name: parsed.data.channelName,
        enabled: parsed.data.enabled,
      })
      .eq("id", true)
      .select("channel_id, channel_name, enabled")
      .single();

    if (error || !data) return apiError(error?.message ?? "Could not save the Slack settings", 500);

    return NextResponse.json({
      slack: mapSlackSettings(data, {
        configured: current.slack.tokenConfigured,
        token_set_at: current.slack.tokenSetAt,
      }),
    });
  } catch (error) {
    return apiUnexpected(error);
  }
}
