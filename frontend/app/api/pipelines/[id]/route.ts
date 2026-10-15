import { NextResponse, type NextRequest } from "next/server";

import { pipelineInputSchema } from "@/schemas/pipeline-schema";
import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapPipeline } from "@/app/api/_mappers";
import { planStageReconcile } from "@/utilities/pipeline-stage-reconcile";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;

  const { data, error } = await supabase
    .from("pipelines")
    .select("id, name, is_template, created_at, pipeline_template_stages(id, name, sort_order)")
    .eq("id", id)
    .maybeSingle();

  if (error) return apiError(error.message, 500);
  if (!data) return apiError("Pipeline not found", 404);

  const { count } = await supabase
    .from("positions")
    .select("id", { count: "exact", head: true })
    .eq("assigned_pipeline_id", id);

  return NextResponse.json({ pipeline: mapPipeline(data, count ?? 0) });
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

  const parsed = pipelineInputSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid pipeline", 422);
  }

  try {
    const { error: nameError } = await supabase
      .from("pipelines")
      .update({ name: parsed.data.name })
      .eq("id", id);
    if (nameError) return apiError(nameError.message, 500);

    // Reconcile rather than replace — see `planStageReconcile` for why a stage
    // that survives the edit must keep its id.
    const { data: existing, error: existingError } = await supabase
      .from("pipeline_template_stages")
      .select("id")
      .eq("pipeline_id", id);
    if (existingError) return apiError(existingError.message, 500);

    const plan = planStageReconcile(
      (existing ?? []).map((s) => s.id),
      parsed.data.stages,
    );

    if (plan.deleteIds.length > 0) {
      const { error: delError } = await supabase
        .from("pipeline_template_stages")
        .delete()
        .in("id", plan.deleteIds);
      if (delError) return apiError(delError.message, 500);
    }

    for (const stage of plan.update) {
      const { error: updateError } = await supabase
        .from("pipeline_template_stages")
        .update({ name: stage.name, sort_order: stage.sortOrder })
        .eq("id", stage.id);
      if (updateError) return apiError(updateError.message, 500);
    }

    if (plan.insert.length > 0) {
      const { error: insertError } = await supabase.from("pipeline_template_stages").insert(
        plan.insert.map((stage) => ({
          pipeline_id: id,
          name: stage.name,
          sort_order: stage.sortOrder,
        })),
      );
      if (insertError) return apiError(insertError.message, 500);
    }

    const { data: stages, error: stageError } = await supabase
      .from("pipeline_template_stages")
      .select("id, name, sort_order")
      .eq("pipeline_id", id);
    if (stageError) return apiError(stageError.message, 500);

    const { data: pipeline, error: readError } = await supabase
      .from("pipelines")
      .select("id, name, is_template, created_at")
      .eq("id", id)
      .single();
    if (readError || !pipeline) return apiError(readError?.message ?? "Not found", 404);

    const { count } = await supabase
      .from("positions")
      .select("id", { count: "exact", head: true })
      .eq("assigned_pipeline_id", id);

    return NextResponse.json({
      pipeline: mapPipeline({ ...pipeline, pipeline_template_stages: stages }, count ?? 0),
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

  const { error } = await supabase.from("pipelines").delete().eq("id", id);
  if (error) return apiError(error.message, 500);

  return NextResponse.json({ ok: true });
}
