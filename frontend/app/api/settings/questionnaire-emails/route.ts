import { NextResponse, type NextRequest } from "next/server";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { readQuestionnaireEmailDefaults } from "@/app/api/questionnaires/_emails";
import { questionnaireEmailSettingsSchema } from "@/schemas/questionnaire-schema";
import type { QuestionnaireEmailSettings } from "@/types/api";

export async function GET() {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  try {
    return NextResponse.json({ emails: await readQuestionnaireEmailDefaults(ctx.supabase) });
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

  const parsed = questionnaireEmailSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid questionnaire emails", 422);
  }

  try {
    const { error } = await ctx.supabase.from("questionnaire_email_settings").upsert({
      id: true,
      invite_subject: parsed.data.invite.subject,
      invite_body: parsed.data.invite.body,
      reminder_subject: parsed.data.reminder.subject,
      reminder_body: parsed.data.reminder.body,
    });
    if (error) return apiError(error.message, 500);

    const emails: QuestionnaireEmailSettings = parsed.data;
    return NextResponse.json({ emails });
  } catch (error) {
    return apiUnexpected(error);
  }
}
