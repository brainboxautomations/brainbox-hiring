import { describe, expect, it } from "vitest";

import {
  planAnswerRouting,
  selectedOptionValues,
  type RoutingAnswer,
  type RoutingQuestion,
} from "@/utilities/answer-routing";

const REJECT_STAGE = "template-stage-reject";
const INTERVIEW_STAGE = "template-stage-interview";
const OFFER_STAGE = "template-stage-offer";

function question(overrides: Partial<RoutingQuestion> = {}): RoutingQuestion {
  return {
    id: "question-1",
    sortOrder: 0,
    answerRouting: [{ optionValue: "no", pipelineTemplateStageId: REJECT_STAGE }],
    ...overrides,
  };
}

function plan(input: {
  questions: RoutingQuestion[];
  answers: RoutingAnswer[];
  onCompletionPositionStageId?: string | null;
}) {
  return planAnswerRouting({
    questions: input.questions,
    answers: input.answers,
    onCompletionPositionStageId: input.onCompletionPositionStageId ?? null,
  });
}

describe("a choice answer can carry a move-to-stage rule", () => {
  it("routes to the stage the chosen option names", () => {
    expect(
      plan({
        questions: [question()],
        answers: [{ questionId: "question-1", value: "no" }],
      }),
    ).toEqual({
      kind: "answer",
      pipelineTemplateStageId: REJECT_STAGE,
      questionId: "question-1",
      optionValue: "no",
    });
  });

  it("does nothing when the candidate chose an option with no rule on it", () => {
    expect(
      plan({
        questions: [question()],
        answers: [{ questionId: "question-1", value: "yes" }],
      }),
    ).toEqual({ kind: "none" });
  });

  it("matches any of a multi-choice answer's selected values", () => {
    expect(
      plan({
        questions: [question()],
        answers: [{ questionId: "question-1", value: ["maybe", "no"] }],
      }),
    ).toMatchObject({ kind: "answer", pipelineTemplateStageId: REJECT_STAGE });
  });

  it("ignores a rule that names no target stage", () => {
    expect(
      plan({
        questions: [
          question({ answerRouting: [{ optionValue: "no", pipelineTemplateStageId: "" }] }),
        ],
        answers: [{ questionId: "question-1", value: "no" }],
      }),
    ).toEqual({ kind: "none" });
  });

  it("ignores an answer to a question that carries no rules", () => {
    expect(
      plan({
        questions: [question({ answerRouting: [] })],
        answers: [{ questionId: "question-1", value: "no" }],
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("where several rules would fire, the last triggering option wins", () => {
  it("prefers a later question over an earlier one", () => {
    const result = plan({
      questions: [
        question({ id: "first", sortOrder: 0 }),
        question({
          id: "second",
          sortOrder: 1,
          answerRouting: [{ optionValue: "no", pipelineTemplateStageId: INTERVIEW_STAGE }],
        }),
      ],
      answers: [
        { questionId: "first", value: "no" },
        { questionId: "second", value: "no" },
      ],
    });

    expect(result).toMatchObject({
      pipelineTemplateStageId: INTERVIEW_STAGE,
      questionId: "second",
    });
  });

  it("reads questions in sort order, not the order they were handed over", () => {
    const result = plan({
      questions: [
        question({
          id: "second",
          sortOrder: 5,
          answerRouting: [{ optionValue: "no", pipelineTemplateStageId: INTERVIEW_STAGE }],
        }),
        question({ id: "first", sortOrder: 1 }),
      ],
      answers: [
        { questionId: "first", value: "no" },
        { questionId: "second", value: "no" },
      ],
    });

    expect(result).toMatchObject({
      pipelineTemplateStageId: INTERVIEW_STAGE,
      questionId: "second",
    });
  });

  it("prefers a later rule on the same question", () => {
    const result = plan({
      questions: [
        question({
          answerRouting: [
            { optionValue: "no", pipelineTemplateStageId: REJECT_STAGE },
            { optionValue: "maybe", pipelineTemplateStageId: OFFER_STAGE },
          ],
        }),
      ],
      answers: [{ questionId: "question-1", value: ["no", "maybe"] }],
    });

    expect(result).toMatchObject({ pipelineTemplateStageId: OFFER_STAGE, optionValue: "maybe" });
  });

  it("is not swayed by the order the candidate's selections happen to be stored in", () => {
    const questions = [
      question({
        answerRouting: [
          { optionValue: "no", pipelineTemplateStageId: REJECT_STAGE },
          { optionValue: "maybe", pipelineTemplateStageId: OFFER_STAGE },
        ],
      }),
    ];

    const forwards = plan({
      questions,
      answers: [{ questionId: "question-1", value: ["no", "maybe"] }],
    });
    const backwards = plan({
      questions,
      answers: [{ questionId: "question-1", value: ["maybe", "no"] }],
    });

    expect(forwards).toEqual(backwards);
  });
});

describe("answer-based routing beats on-completion routing", () => {
  it("uses the answer rule when both are present", () => {
    expect(
      plan({
        questions: [question()],
        answers: [{ questionId: "question-1", value: "no" }],
        onCompletionPositionStageId: "position-stage-on-completion",
      }),
    ).toMatchObject({ kind: "answer", pipelineTemplateStageId: REJECT_STAGE });
  });

  it("falls back to the on-completion stage when no answer rule fires", () => {
    expect(
      plan({
        questions: [question()],
        answers: [{ questionId: "question-1", value: "yes" }],
        onCompletionPositionStageId: "position-stage-on-completion",
      }),
    ).toEqual({ kind: "on_completion", positionStageId: "position-stage-on-completion" });
  });

  it("does nothing at all when neither is configured", () => {
    expect(plan({ questions: [], answers: [] })).toEqual({ kind: "none" });
  });

  it("does nothing when the on-completion stage could not be resolved on this position", () => {
    expect(
      plan({
        questions: [],
        answers: [{ questionId: "question-1", value: "no" }],
        onCompletionPositionStageId: null,
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("an answer value is read out of untrusted jsonb", () => {
  it("reads a single string", () => {
    expect(selectedOptionValues("yes")).toEqual(["yes"]);
  });

  it("reads an array of strings and drops anything else in it", () => {
    expect(selectedOptionValues(["a", 2, null, "b"])).toEqual(["a", "b"]);
  });

  it("reads a numeric answer as its own text", () => {
    expect(selectedOptionValues(7)).toEqual(["7"]);
  });

  it("reads a yes/no answer as yes or no", () => {
    expect(selectedOptionValues(true)).toEqual(["yes"]);
    expect(selectedOptionValues(false)).toEqual(["no"]);
  });

  it("reads nothing out of a video or file answer", () => {
    expect(selectedOptionValues({ source: "upload", storagePath: "x" })).toEqual([]);
    expect(selectedOptionValues(null)).toEqual([]);
    expect(selectedOptionValues(undefined)).toEqual([]);
  });
});
