import { createSupabaseServerClient } from "@/configurations/supabase-server-configuration";
import { mapQuestion } from "@/app/api/_mappers";
import type { HostedQuestionnaire, HostedQuestionnaireState } from "@/types/api";
import { isQuestionnaireTokenShape } from "@/utilities/questionnaire-token";

const HOSTED_STATES: HostedQuestionnaireState[] = ["unknown", "expired", "completed", "open"];

function toHostedState(value: string | null): HostedQuestionnaireState {
  const match = HOSTED_STATES.find((state) => state === value);
  return match ?? "unknown";
}

export async function getHostedQuestionnaireState(
  token: string,
): Promise<HostedQuestionnaireState> {
  if (!isQuestionnaireTokenShape(token)) return "unknown";

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("public_questionnaire_token_state", {
    p_token: token,
  });
  if (error) throw new Error(error.message);

  return toHostedState(data);
}

export async function getHostedQuestionnaire(token: string): Promise<HostedQuestionnaire | null> {
  if (!isQuestionnaireTokenShape(token)) return null;

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .rpc("public_questionnaire_by_token", { p_token: token })
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: questionRows, error: questionsError } = await supabase.rpc(
    "public_questionnaire_questions_by_token",
    { p_token: token },
  );
  if (questionsError) throw new Error(questionsError.message);

  return {
    name: data.questionnaire_name,
    positionTitle: data.position_title,
    positionId: data.position_id,
    expiresAt: data.expires_at,
    questions: (questionRows ?? []).map(mapQuestion),
  };
}
