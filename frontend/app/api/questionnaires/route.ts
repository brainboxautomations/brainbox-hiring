import { NextResponse, type NextRequest } from "next/server";

import { questionnaireInputSchema } from "@/schemas/questionnaire-schema";
import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapQuestionnaireTemplate } from "@/app/api/_mappers";
import {
  QUESTION_SELECT,
  TEMPLATE_ROW_SELECT,
  TEMPLATE_SELECT,
  toEmailChoiceColumns,
  toQuestionRow,
} from "@/app/api/questionnaires/_shared";

export async function GET() {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const { data, error } = await supabase
    .from("questionnaire_templates")
    .select(TEMPLATE_SELECT)
    .order("updated_at", { ascending: false });

  if (error) return apiError(error.message, 500);

  const rows = data ?? [];
  const questionnaires = rows.map(mapQuestionnaireTemplate);
  return NextResponse.json({ questionnaires });
}

export async function POST(request: NextRequest) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body");
  }

  const parsed = questionnaireInputSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid questionnaire", 422);
  }

  try {
    const { data: template, error: insertError } = await supabase
      .from("questionnaire_templates")
      .insert({
        name: parsed.data.name,
        on_completion_template_stage_id: parsed.data.onCompletionTemplateStageId ?? null,
        ...toEmailChoiceColumns(parsed.data),
      })
      .select(TEMPLATE_ROW_SELECT)
      .single();
    if (insertError || !template) return apiError(insertError?.message ?? "Insert failed", 500);

    const questionRows = parsed.data.questions.map((question, index) =>
      toQuestionRow(question, template.id, index),
    );

    const { data: questions, error: qError } = await supabase
      .from("questions")
      .insert(questionRows)
      .select(QUESTION_SELECT);
    if (qError) return apiError(qError.message, 500);

    return NextResponse.json(
      { questionnaire: mapQuestionnaireTemplate({ ...template, questions }) },
      { status: 201 },
    );
  } catch (error) {
    return apiUnexpected(error);
  }
}
