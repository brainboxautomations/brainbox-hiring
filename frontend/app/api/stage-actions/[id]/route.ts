import { NextResponse, type NextRequest } from "next/server";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapStageAction, toReminderConfigRow } from "@/app/api/_mappers";
import { STAGE_ACTION_SELECT, stagePositionId } from "@/app/api/stage-actions/route";
import {
  stageActionUpdateSchema,
  unsupportedFieldForType,
  type StageActionUpdateValues,
} from "@/schemas/stage-action-schema";
import type { TablesUpdate } from "@/types/database.types";

type RouteContext = { params: Promise<{ id: string }> };

function toRowUpdate(update: StageActionUpdateValues): TablesUpdate<"stage_actions"> {
  const row: TablesUpdate<"stage_actions"> = {};

  if (update.enabled !== undefined) row.enabled = update.enabled;
  if (update.delayMinutes !== undefined) row.delay_minutes = update.delayMinutes;
  if (update.sortOrder !== undefined) row.sort_order = update.sortOrder;
  if (update.messageTemplateId !== undefined) row.message_template_id = update.messageTemplateId;
  if (update.questionnaireTemplateId !== undefined) {
    row.questionnaire_template_id = update.questionnaireTemplateId;
  }
  if (update.targetPositionStageId !== undefined) {
    row.target_position_stage_id = update.targetPositionStageId;
  }
  if (update.reminderConfig !== undefined) {
    row.reminder_config = toReminderConfigRow(update.reminderConfig);
  }

  return row;
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;

  const { data, error } = await supabase
    .from("stage_actions")
    .select(STAGE_ACTION_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) return apiError(error.message, 500);
  if (!data) return apiError("Stage action not found", 404);

  return NextResponse.json({ action: mapStageAction(data) });
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

  const parsed = stageActionUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid stage action", 422);
  }
  const update = parsed.data;

  try {
    const { data: current, error: readError } = await supabase
      .from("stage_actions")
      .select("id, type, position_stage_id")
      .eq("id", id)
      .maybeSingle();

    if (readError) return apiError(readError.message, 500);
    if (!current) return apiError("Stage action not found", 404);

    const unsupported = unsupportedFieldForType(current.type, update);
    if (unsupported) {
      return apiError(`A ${current.type} action does not carry a ${unsupported}`, 422);
    }

    if (update.targetPositionStageId !== undefined) {
      const stage = await stagePositionId(supabase, current.position_stage_id);
      if ("error" in stage) return apiError(stage.error, stage.status);

      const target = await stagePositionId(supabase, update.targetPositionStageId);
      if ("error" in target) return apiError("Target stage not found", 422);
      if (target.positionId !== stage.positionId) {
        return apiError("The target stage belongs to a different position", 422);
      }
    }

    const { data, error } = await supabase
      .from("stage_actions")
      .update(toRowUpdate(update))
      .eq("id", id)
      .select(STAGE_ACTION_SELECT)
      .maybeSingle();

    if (error) return apiError(error.message, 500);
    if (!data) return apiError("Stage action not found", 404);

    return NextResponse.json({ action: mapStageAction(data) });
  } catch (error) {
    return apiUnexpected(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;

  const { error } = await supabase.from("stage_actions").delete().eq("id", id);
  if (error) return apiError(error.message, 500);

  return NextResponse.json({ ok: true });
}
