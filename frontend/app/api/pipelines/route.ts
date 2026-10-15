import { NextResponse, type NextRequest } from "next/server";

import { pipelineInputSchema } from "@/schemas/pipeline-schema";
import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapPipeline } from "@/app/api/_mappers";

export async function GET() {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const { data, error } = await supabase
    .from("pipelines")
    .select(
      "id, name, is_template, created_at, pipeline_template_stages(id, name, sort_order)",
    )
    .order("created_at", { ascending: true });

  if (error) return apiError(error.message, 500);

  const { data: usageRows, error: usageError } = await supabase
    .from("positions")
    .select("assigned_pipeline_id");
  if (usageError) return apiError(usageError.message, 500);

  const usage = new Map<string, number>();
  for (const row of usageRows ?? []) {
    const id = row.assigned_pipeline_id;
    if (id) usage.set(id, (usage.get(id) ?? 0) + 1);
  }

  const pipelines = (data ?? []).map((row) => mapPipeline(row, usage.get(row.id) ?? 0));
  return NextResponse.json({ pipelines });
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

  const parsed = pipelineInputSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid pipeline", 422);
  }

  try {
    const { data: pipeline, error: insertError } = await supabase
      .from("pipelines")
      .insert({ name: parsed.data.name })
      .select("id, name, is_template, created_at")
      .single();
    if (insertError || !pipeline) return apiError(insertError?.message ?? "Insert failed", 500);

    const stageRows = parsed.data.stages.map((s, index) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      sort_order: index,
    }));
    const { data: stages, error: stageError } = await supabase
      .from("pipeline_template_stages")
      .insert(stageRows)
      .select("id, name, sort_order");
    if (stageError) return apiError(stageError.message, 500);

    return NextResponse.json(
      { pipeline: mapPipeline({ ...pipeline, pipeline_template_stages: stages }, 0) },
      { status: 201 },
    );
  } catch (error) {
    return apiUnexpected(error);
  }
}
