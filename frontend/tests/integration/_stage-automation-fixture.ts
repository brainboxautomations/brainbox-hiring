import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export type PipelineFixture = {
  stageOneId: string;
  stageTwoId: string;
  stageThreeId: string;
  templateId: string;
  cleanup: () => Promise<void>;
};

export async function seedPipelineForPosition(
  supabase: SupabaseClient<Database>,
  positionId: string,
): Promise<PipelineFixture> {
  const suffix = crypto.randomUUID();

  const { data: stages, error: stageError } = await supabase
    .from("position_stages")
    .insert([
      { position_id: positionId, name: "Applied", sort_order: 1 },
      { position_id: positionId, name: "Interview", sort_order: 2 },
      { position_id: positionId, name: "Hired", sort_order: 3 },
    ])
    .select("id, sort_order");

  if (stageError || !stages) throw new Error(`seed stages: ${stageError?.message}`);

  const [stageOne, stageTwo, stageThree] = [...stages].sort((a, b) => a.sort_order - b.sort_order);
  if (!stageOne || !stageTwo || !stageThree) throw new Error("seed stages: expected three stages");

  const { data: template, error: templateError } = await supabase
    .from("message_templates")
    .insert({
      name: `L3 automation template ${suffix}`,
      subject: "About {{position.title}}",
      body: "Hi {{candidate.first_name}}, thanks for applying.",
    })
    .select("id")
    .single();

  if (templateError || !template) throw new Error(`seed template: ${templateError?.message}`);

  return {
    stageOneId: stageOne.id,
    stageTwoId: stageTwo.id,
    stageThreeId: stageThree.id,
    templateId: template.id,
    cleanup: async () => {
      await supabase.from("message_templates").delete().eq("id", template.id);
    },
  };
}

export type RoutingFixture = {
  routedStageId: string;
  routedTemplateStageId: string;
  questionnaireId: string;
  questionId: string;
  severTemplateStage: () => Promise<void>;
  cleanup: () => Promise<void>;
};

export async function seedRoutingQuestionnaire(
  supabase: SupabaseClient<Database>,
  positionId: string,
): Promise<RoutingFixture> {
  const suffix = crypto.randomUUID();

  const { data: position, error: positionError } = await supabase
    .from("positions")
    .select("id, assigned_pipeline_id")
    .eq("id", positionId)
    .single();
  if (positionError || !position?.assigned_pipeline_id) {
    throw new Error(`seed routing: position has no pipeline (${positionError?.message})`);
  }

  const { data: templateStage, error: templateStageError } = await supabase
    .from("pipeline_template_stages")
    .insert({
      pipeline_id: position.assigned_pipeline_id,
      name: "Rejected",
      sort_order: 9,
    })
    .select("id")
    .single();
  if (templateStageError || !templateStage) {
    throw new Error(`seed routing template stage: ${templateStageError?.message}`);
  }

  const { data: routedStage, error: routedStageError } = await supabase
    .from("position_stages")
    .insert({
      position_id: positionId,
      source_template_stage_id: templateStage.id,
      name: "Rejected",
      sort_order: 9,
    })
    .select("id")
    .single();
  if (routedStageError || !routedStage) {
    throw new Error(`seed routing position stage: ${routedStageError?.message}`);
  }

  const { data: questionnaire, error: questionnaireError } = await supabase
    .from("questionnaire_templates")
    .insert({ name: `L3 routing questionnaire ${suffix}` })
    .select("id")
    .single();
  if (questionnaireError || !questionnaire) {
    throw new Error(`seed routing questionnaire: ${questionnaireError?.message}`);
  }

  const { data: question, error: questionError } = await supabase
    .from("questions")
    .insert({
      questionnaire_template_id: questionnaire.id,
      sort_order: 1,
      type: "single_choice",
      prompt: "Do you have the right to work in the UK?",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
      answer_routing: [{ option_value: "no", pipeline_template_stage_id: templateStage.id }],
    })
    .select("id")
    .single();
  if (questionError || !question)
    throw new Error(`seed routing question: ${questionError?.message}`);

  return {
    routedStageId: routedStage.id,
    routedTemplateStageId: templateStage.id,
    questionnaireId: questionnaire.id,
    questionId: question.id,
    severTemplateStage: async () => {
      await supabase.from("pipeline_template_stages").delete().eq("id", templateStage.id);
    },
    cleanup: async () => {
      await supabase.from("questionnaire_templates").delete().eq("id", questionnaire.id);
      await supabase.from("pipeline_template_stages").delete().eq("id", templateStage.id);
    },
  };
}

export async function completeQuestionnaireFor(
  supabase: SupabaseClient<Database>,
  input: {
    applicationId: string;
    questionnaireId: string;
    questionId: string;
    optionValue: string;
  },
): Promise<string> {
  const { data: response, error: responseError } = await supabase
    .from("questionnaire_responses")
    .insert({
      questionnaire_template_id: input.questionnaireId,
      application_id: input.applicationId,
      context: "application_embedded",
      status: "pending",
    })
    .select("id")
    .single();
  if (responseError || !response) throw new Error(`seed response: ${responseError?.message}`);

  const { error: answerError } = await supabase.from("answers").insert({
    questionnaire_response_id: response.id,
    question_id: input.questionId,
    value: input.optionValue,
  });
  if (answerError) throw new Error(`seed answer: ${answerError.message}`);

  const { error: completeError } = await supabase
    .from("questionnaire_responses")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", response.id);
  if (completeError) throw new Error(`complete response: ${completeError.message}`);

  return response.id;
}

export async function sendQuestionnaireFor(
  supabase: SupabaseClient<Database>,
  input: { applicationId: string; questionnaireId: string; stageActionId: string },
): Promise<string> {
  const { data, error } = await supabase
    .from("questionnaire_responses")
    .insert({
      questionnaire_template_id: input.questionnaireId,
      application_id: input.applicationId,
      context: "stage_sent",
      status: "pending",
      sent_at: new Date().toISOString(),
      stage_action_id: input.stageActionId,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`seed sent questionnaire: ${error?.message}`);
  return data.id;
}

export type QueuedAction = {
  id: string;
  status: Database["public"]["Enums"]["scheduled_action_status"];
  kind: Database["public"]["Enums"]["scheduled_action_kind"];
  origin_stage_id: string | null;
  scheduled_for: string;
  failure_reason: string | null;
  message_id: string | null;
};

export function onlyQueuedAction(rows: QueuedAction[]): QueuedAction {
  const [first, ...rest] = rows;
  if (!first || rest.length > 0) {
    throw new Error(`Expected exactly one queued action, found ${rows.length}`);
  }
  return first;
}

export async function queuedActionsFor(
  supabase: SupabaseClient<Database>,
  applicationId: string,
): Promise<QueuedAction[]> {
  const { data, error } = await supabase
    .from("scheduled_actions")
    .select("id, status, kind, origin_stage_id, scheduled_for, failure_reason, message_id")
    .eq("application_id", applicationId)
    .order("scheduled_for");

  if (error) throw new Error(`read queue: ${error.message}`);
  return data ?? [];
}
