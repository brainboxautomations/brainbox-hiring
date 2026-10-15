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
import { planReconcileById } from "@/utilities/reconcile-by-id";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;

  const { data, error } = await supabase
    .from("questionnaire_templates")
    .select(TEMPLATE_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) return apiError(error.message, 500);
  if (!data) return apiError("Questionnaire not found", 404);

  return NextResponse.json({
    questionnaire: mapQuestionnaireTemplate(data),
  });
}

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

  const parsed = questionnaireInputSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid questionnaire", 422);
  }

  try {
    const { error: nameError } = await supabase
      .from("questionnaire_templates")
      .update({
        name: parsed.data.name,
        on_completion_template_stage_id: parsed.data.onCompletionTemplateStageId ?? null,
        ...toEmailChoiceColumns(parsed.data),
      })
      .eq("id", id);
    if (nameError) return apiError(nameError.message, 500);

    // Recorded answers reference questions with `on delete cascade`, so the
    // questions this edit keeps are updated in place. Only the ones the user
    // removed are deleted.
    const { data: existing, error: existingError } = await supabase
      .from("questions")
      .select("id")
      .eq("questionnaire_template_id", id);
    if (existingError) return apiError(existingError.message, 500);

    const plan = planReconcileById(
      (existing ?? []).map((row) => row.id),
      parsed.data.questions,
    );

    for (const { id: questionId, item, sortOrder } of plan.update) {
      const { error: updateError } = await supabase
        .from("questions")
        .update(toQuestionRow(item, id, sortOrder))
        .eq("id", questionId)
        .eq("questionnaire_template_id", id);
      if (updateError) return apiError(updateError.message, 500);
    }

    if (plan.insert.length > 0) {
      const { error: insertError } = await supabase
        .from("questions")
        .insert(plan.insert.map(({ item, sortOrder }) => toQuestionRow(item, id, sortOrder)));
      if (insertError) return apiError(insertError.message, 500);
    }

    if (plan.deleteIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("questions")
        .delete()
        .in("id", plan.deleteIds);
      if (deleteError) return apiError(deleteError.message, 500);
    }

    const { data: questions, error: qError } = await supabase
      .from("questions")
      .select(QUESTION_SELECT)
      .eq("questionnaire_template_id", id)
      .order("sort_order");
    if (qError) return apiError(qError.message, 500);

    const { data: template, error: readError } = await supabase
      .from("questionnaire_templates")
      .select(TEMPLATE_ROW_SELECT)
      .eq("id", id)
      .single();
    if (readError || !template) return apiError(readError?.message ?? "Not found", 404);

    return NextResponse.json({
      questionnaire: mapQuestionnaireTemplate({ ...template, questions }),
    });
  } catch (error) {
    return apiUnexpected(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;

  const { error } = await supabase.from("questionnaire_templates").delete().eq("id", id);
  if (error) return apiError(error.message, 500);

  return NextResponse.json({ ok: true });
}
