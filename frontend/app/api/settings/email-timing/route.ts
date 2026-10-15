import { NextResponse, type NextRequest } from "next/server";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { readEmailTiming } from "@/app/api/_email-timing";
import { emailTimingSchema } from "@/schemas/settings-schema";
import type { EmailTimingSettings } from "@/types/api";

export async function GET() {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  try {
    return NextResponse.json({ timing: await readEmailTiming(ctx.supabase) });
  } catch (error) {
    return apiUnexpected(error);
  }
}

export async function PUT(request: NextRequest) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body");
  }

  const parsed = emailTimingSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid email timing", 422);
  }

  try {
    const { error } = await ctx.supabase
      .from("email_timing_settings")
      .update({
        automation_safety_delay_minutes: parsed.data.automationSafetyDelayMinutes,
        send_undo_minutes: parsed.data.sendUndoMinutes,
      })
      .eq("id", true);
    if (error) return apiError(error.message, 500);

    const timing: EmailTimingSettings = parsed.data;
    return NextResponse.json({ timing });
  } catch (error) {
    return apiUnexpected(error);
  }
}
