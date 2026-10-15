import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapStageAction, toReminderConfigRow } from "@/app/api/_mappers";
import { stageActionInputSchema } from "@/schemas/stage-action-schema";
import type { Database, TablesInsert } from "@/types/database.types";

export const STAGE_ACTION_SELECT =
  "id, position_stage_id, type, enabled, delay_minutes, sort_order, message_template_id, questionnaire_template_id, target_position_stage_id, reminder_config, created_at";

export async function stagePositionId(
  supabase: SupabaseClient<Database>,
  positionStageId: string,
): Promise<{ positionId: string } | { error: string; status: number }> {
  const { data, error } = await supabase
    .from("position_stages")
    .select("id, position_id")
    .eq("id", positionStageId)
    .maybeSingle();

  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Stage not found", status: 404 };

  return { positionId: data.position_id };
}

export async function GET(request: NextRequest) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const positionStageId = request.nextUrl.searchParams.get("positionStageId");
  if (!positionStageId) return apiError("Pass positionStageId", 422);

  const { data, error } = await supabase
    .from("stage_actions")
    .select(STAGE_ACTION_SELECT)
    .eq("position_stage_id", positionStageId)
    .order("sort_order")
    .order("created_at");

  if (error) return apiError(error.message, 500);

  return NextResponse.json({ actions: (data ?? []).map(mapStageAction) });
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

  const parsed = stageActionInputSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid stage action", 422);
  }
  const input = parsed.data;

  try {
    const stage = await stagePositionId(supabase, input.positionStageId);
    if ("error" in stage) return apiError(stage.error, stage.status);

    const row: TablesInsert<"stage_actions"> = {
      position_stage_id: input.positionStageId,
      type: input.type,
      enabled: input.enabled,
      delay_minutes: input.delayMinutes,
      sort_order: input.sortOrder,
    };

    if (input.type === "send_email") {
      row.message_template_id = input.messageTemplateId;
    }

    if (input.type === "send_questionnaire") {
      row.questionnaire_template_id = input.questionnaireTemplateId;
      row.reminder_config = toReminderConfigRow(input.reminderConfig ?? null);
    }

    if (input.type === "move_to_stage") {
      const target = await stagePositionId(supabase, input.targetPositionStageId);
      if ("error" in target) return apiError("Target stage not found", 422);
      if (target.positionId !== stage.positionId) {
        return apiError("The target stage belongs to a different position", 422);
      }
      row.target_position_stage_id = input.targetPositionStageId;
    }

    const { data, error } = await supabase
      .from("stage_actions")
      .insert(row)
      .select(STAGE_ACTION_SELECT)
      .single();

    if (error || !data) return apiError(error?.message ?? "Insert failed", 500);

    return NextResponse.json({ action: mapStageAction(data) }, { status: 201 });
  } catch (error) {
    return apiUnexpected(error);
  }
}
