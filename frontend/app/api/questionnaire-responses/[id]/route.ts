import { NextResponse, type NextRequest } from "next/server";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { questionnaireReminderUpdateSchema } from "@/schemas/questionnaire-schema";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body");
  }

  const parsed = questionnaireReminderUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid reminder update", 422);
  }

  try {
    const { data, error } = await supabase
      .from("questionnaire_responses")
      .update({
        reminders_stopped_at: parsed.data.remindersStopped ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .select("id, reminders_stopped_at")
      .maybeSingle();

    if (error) return apiError(error.message, 500);
    if (!data) return apiError("Questionnaire response not found", 404);

    return NextResponse.json({ remindersStoppedAt: data.reminders_stopped_at });
  } catch (error) {
    return apiUnexpected(error);
  }
}
