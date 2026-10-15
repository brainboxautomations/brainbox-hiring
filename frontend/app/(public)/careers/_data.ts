import { createSupabaseServerClient } from "@/configurations/supabase-server-configuration";
import { mapPosition, mapPositionListItem, mapQuestion } from "@/app/api/_mappers";
import type { Position, PositionListItem, Question } from "@/types/api";

const LIST_SELECT =
  "id, title, slug, department, position_type, locations, remote_flag, status, publish_mode, created_at";

export async function listPublicPositions(): Promise<PositionListItem[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("positions")
    .select(LIST_SELECT)
    .eq("status", "open")
    .eq("publish_mode", "listed")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => mapPositionListItem(row, 0));
}

export type PublicPosition = { position: Position; questions: Question[] };

export async function getPublicPositionBySlug(slug: string): Promise<PublicPosition | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .rpc("public_position_by_slug", { p_slug: slug })
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const position = mapPosition(data, 0);

  let questions: Question[] = [];
  if (position.applicationQuestionnaireId) {
    const { data: qRows, error: qError } = await supabase.rpc("public_position_questions", {
      p_position_id: position.id,
    });
    if (qError) throw new Error(qError.message);
    questions = (qRows ?? []).map(mapQuestion);
  }

  return { position, questions };
}
