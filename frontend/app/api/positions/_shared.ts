import type { SupabaseClient } from "@supabase/supabase-js";

import type { PositionInputValues } from "@/schemas/position-schema";
import type { Database, TablesUpdate } from "@/types/database.types";
import { slugify } from "@/utilities/slug";

export const POSITION_DETAIL_SELECT =
  "id, title, slug, department, locations, remote_flag, position_type, education_level, education_level_required, experience_level, salary_from, salary_to, salary_period, salary_currency, description, status, publish_mode, application_form_config, application_questionnaire_id, assigned_pipeline_id, email_sender_name, hiring_team, created_at, position_stages(id, name, sort_order)";

export async function candidateCounts(
  supabase: SupabaseClient<Database>,
): Promise<Map<string, number>> {
  const { data } = await supabase.from("applications").select("position_id");
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.position_id, (counts.get(row.position_id) ?? 0) + 1);
  }
  return counts;
}

export async function uniqueSlug(
  supabase: SupabaseClient<Database>,
  title: string,
): Promise<string> {
  const base = slugify(title) || "position";
  const { data } = await supabase.from("positions").select("slug").like("slug", `${base}%`);
  const taken = new Set((data ?? []).map((r) => r.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function toRow(input: Partial<PositionInputValues>): TablesUpdate<"positions"> {
  const row: TablesUpdate<"positions"> = {};
  const set = <K extends keyof TablesUpdate<"positions">>(
    key: K,
    value: TablesUpdate<"positions">[K] | undefined,
  ) => {
    if (value !== undefined) row[key] = value;
  };
  set("title", input.title);
  set("department", input.department);
  set("locations", input.locations);
  set("remote_flag", input.remoteFlag);
  set("position_type", input.positionType);
  set("education_level", input.educationLevel);
  set("education_level_required", input.educationLevelRequired);
  set("experience_level", input.experienceLevel);
  set("salary_from", input.salaryFrom);
  set("salary_to", input.salaryTo);
  set("salary_period", input.salaryPeriod);
  set("salary_currency", input.salaryCurrency);
  set("description", input.description);
  set("publish_mode", input.publishMode);
  set("application_form_config", input.applicationFormConfig);
  set("application_questionnaire_id", input.applicationQuestionnaireId);
  set("assigned_pipeline_id", input.assignedPipelineId);
  set("email_sender_name", input.emailSenderName);
  set("hiring_team", input.hiringTeam);
  return row;
}
