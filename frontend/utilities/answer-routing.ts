import type { AnswerRoutingRule } from "@/types/api";

export type RoutingQuestion = {
  id: string;
  sortOrder: number;
  answerRouting: AnswerRoutingRule[];
};

export type RoutingAnswer = {
  questionId: string;
  value: unknown;
};

export type AnswerRoutingPlan =
  | {
      kind: "answer";
      pipelineTemplateStageId: string;
      questionId: string;
      optionValue: string;
    }
  | { kind: "on_completion"; positionStageId: string }
  | { kind: "none" };

export function selectedOptionValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [String(value)];
  if (typeof value === "boolean") return [value ? "yes" : "no"];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function selectionsByQuestion(answers: RoutingAnswer[]): Map<string, Set<string>> {
  const selections = new Map<string, Set<string>>();

  for (const answer of answers) {
    const values = selectedOptionValues(answer.value);
    if (values.length === 0) continue;

    const existing = selections.get(answer.questionId) ?? new Set<string>();
    for (const value of values) existing.add(value);
    selections.set(answer.questionId, existing);
  }

  return selections;
}

function lastMatchingRule(
  questions: RoutingQuestion[],
  answers: RoutingAnswer[],
): AnswerRoutingPlan | null {
  const selections = selectionsByQuestion(answers);
  const ordered = [...questions].sort((a, b) => a.sortOrder - b.sortOrder);

  let winner: AnswerRoutingPlan | null = null;

  for (const question of ordered) {
    const selected = selections.get(question.id);
    if (!selected) continue;

    for (const rule of question.answerRouting) {
      if (!rule.pipelineTemplateStageId) continue;
      if (!selected.has(rule.optionValue)) continue;

      winner = {
        kind: "answer",
        pipelineTemplateStageId: rule.pipelineTemplateStageId,
        questionId: question.id,
        optionValue: rule.optionValue,
      };
    }
  }

  return winner;
}

export function planAnswerRouting(input: {
  questions: RoutingQuestion[];
  answers: RoutingAnswer[];
  onCompletionPositionStageId: string | null;
}): AnswerRoutingPlan {
  const matched = lastMatchingRule(input.questions, input.answers);
  if (matched) return matched;

  if (input.onCompletionPositionStageId) {
    return { kind: "on_completion", positionStageId: input.onCompletionPositionStageId };
  }

  return { kind: "none" };
}
