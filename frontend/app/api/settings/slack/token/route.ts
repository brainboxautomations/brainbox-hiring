import { NextResponse, type NextRequest } from "next/server";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { readSlackSettings } from "@/app/api/settings/slack/_read";
import { SLACK_BOT_TOKEN_MESSAGE, slackTokenSchema } from "@/schemas/settings-schema";

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

  const parsed = slackTokenSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? SLACK_BOT_TOKEN_MESSAGE);
  }

  try {
    const { data, error } = await supabase.rpc("set_slack_bot_token", {
      p_token: parsed.data.token,
    });

    if (error) return apiError(error.message, 500);
    if (data !== true) return apiError(SLACK_BOT_TOKEN_MESSAGE);

    const settings = await readSlackSettings(supabase);
    if ("error" in settings) return apiError(settings.error, 500);

    return NextResponse.json({ slack: settings.slack });
  } catch (error) {
    return apiUnexpected(error);
  }
}
