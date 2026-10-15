import { describe, expect, it } from "vitest";

import {
  toBuilderQuestion,
  toQuestionInput,
  type BuilderQuestion,
} from "@/utilities/questionnaire-builder";
import type { Question } from "@/types/api";

const REJECT_STAGE = "template-stage-reject";
const INTERVIEW_STAGE = "template-stage-interview";

function builderQuestion(overrides: Partial<BuilderQuestion> = {}): BuilderQuestion {
  return {
    id: 1,
    type: "single",
    prompt: "Do you have the right to work?",
    help: "",
    required: false,
    options: [
      { label: "Yes", route: "" },
      { label: "No", route: REJECT_STAGE },
    ],
    ...overrides,
  };
}

function savedQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "question-1",
    sortOrder: 0,
    type: "single_choice",
    prompt: "Do you have the right to work?",
    helpText: null,
    required: false,
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
    videoMaxDuration: null,
    videoAllowRetakes: null,
    numericMin: null,
    numericMax: null,
    answerRouting: [{ optionValue: "no", pipelineTemplateStageId: REJECT_STAGE }],
    ...overrides,
  };
}

describe("routing survives the trip out of the builder", () => {
  it("keys each rule on the option value the option will be saved with", () => {
    const input = toQuestionInput(builderQuestion());

    expect(input.options).toEqual([
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ]);
    expect(input.answerRouting).toEqual([
      { optionValue: "no", pipelineTemplateStageId: REJECT_STAGE },
    ]);
  });

  it("keeps the rule keyed correctly when two labels collide", () => {
    const input = toQuestionInput(
      builderQuestion({
        options: [
          { label: "No", route: "" },
          { label: "No", route: REJECT_STAGE },
        ],
      }),
    );

    expect((input.options ?? []).map((option) => option.value)).toEqual(["no", "no_2"]);
    expect(input.answerRouting).toEqual([
      { optionValue: "no_2", pipelineTemplateStageId: REJECT_STAGE },
    ]);
  });

  it("emits no rules for an unrouted question", () => {
    const input = toQuestionInput(
      builderQuestion({
        options: [
          { label: "Yes", route: "" },
          { label: "No", route: "" },
        ],
      }),
    );

    expect(input.answerRouting).toEqual([]);
  });

  it("emits no rules for a question type that cannot carry them", () => {
    const input = toQuestionInput(builderQuestion({ type: "short", options: undefined }));

    expect(input.options).toEqual([]);
    expect(input.answerRouting).toEqual([]);
  });

  it("carries several rules in the order the options are shown", () => {
    const input = toQuestionInput(
      builderQuestion({
        options: [
          { label: "Yes", route: INTERVIEW_STAGE },
          { label: "No", route: REJECT_STAGE },
        ],
      }),
    );

    expect(input.answerRouting).toEqual([
      { optionValue: "yes", pipelineTemplateStageId: INTERVIEW_STAGE },
      { optionValue: "no", pipelineTemplateStageId: REJECT_STAGE },
    ]);
  });
});

describe("routing loads back into the builder", () => {
  it("puts each saved rule back on its own option", () => {
    const loaded = toBuilderQuestion(savedQuestion(), 1);

    expect(loaded.options).toEqual([
      { label: "Yes", route: "" },
      { label: "No", route: REJECT_STAGE },
    ]);
  });

  it("survives a full round trip", () => {
    const loaded = toBuilderQuestion(savedQuestion(), 1);
    const input = toQuestionInput(loaded);

    expect(input.answerRouting).toEqual(savedQuestion().answerRouting);
  });

  it("leaves an option unrouted when a rule names an option that is gone", () => {
    const loaded = toBuilderQuestion(
      savedQuestion({
        answerRouting: [{ optionValue: "maybe", pipelineTemplateStageId: REJECT_STAGE }],
      }),
      1,
    );

    expect(loaded.options?.every((option) => option.route === "")).toBe(true);
  });
});

describe("video retakes and the numeric range survive the save", () => {
  it("saves the retakes switch as it is set, not as a hardcoded true", () => {
    expect(
      toQuestionInput(builderQuestion({ type: "video", videoMax: "2 min", retakes: false }))
        .videoAllowRetakes,
    ).toBe(false);

    expect(
      toQuestionInput(builderQuestion({ type: "video", videoMax: "2 min", retakes: true }))
        .videoAllowRetakes,
    ).toBe(true);
  });

  it("loads the saved retakes value back rather than assuming true", () => {
    const loaded = toBuilderQuestion(
      savedQuestion({ type: "video", videoMaxDuration: 120, videoAllowRetakes: false }),
      1,
    );

    expect(loaded.retakes).toBe(false);
  });

  it("defaults an older video question with no stored preference to allowing retakes", () => {
    const loaded = toBuilderQuestion(
      savedQuestion({ type: "video", videoMaxDuration: 120, videoAllowRetakes: null }),
      1,
    );

    expect(loaded.retakes).toBe(true);
  });

  it("saves the numeric bounds as numbers", () => {
    const input = toQuestionInput(builderQuestion({ type: "numeric", numMin: "1", numMax: "10" }));

    expect(input.numericMin).toBe(1);
    expect(input.numericMax).toBe(10);
  });

  it("keeps a blank bound blank rather than turning it into zero", () => {
    const input = toQuestionInput(builderQuestion({ type: "numeric", numMin: "", numMax: "10" }));

    expect(input.numericMin).toBeNull();
    expect(input.numericMax).toBe(10);
  });

  it("accepts a decimal and a negative bound", () => {
    const input = toQuestionInput(
      builderQuestion({ type: "numeric", numMin: "-2.5", numMax: "2.5" }),
    );

    expect(input.numericMin).toBe(-2.5);
    expect(input.numericMax).toBe(2.5);
  });

  it("drops a bound that is not a number instead of saving NaN", () => {
    const input = toQuestionInput(builderQuestion({ type: "numeric", numMin: "abc", numMax: "" }));

    expect(input.numericMin).toBeNull();
  });

  it("round-trips the numeric bounds", () => {
    const saved = savedQuestion({ type: "numeric", numericMin: 0, numericMax: 40 });
    const input = toQuestionInput(toBuilderQuestion(saved, 1));

    expect(input.numericMin).toBe(0);
    expect(input.numericMax).toBe(40);
  });

  it("never attaches a numeric bound to a question that is not numeric", () => {
    const input = toQuestionInput(builderQuestion({ type: "short", numMin: "1", numMax: "10" }));

    expect(input.numericMin).toBeNull();
    expect(input.numericMax).toBeNull();
    expect(input.videoAllowRetakes).toBeNull();
  });
});

// Saving used to delete every question and insert new ones. Answers reference
// questions with `on delete cascade`, so fixing a typo wiped every candidate's
// recorded answers. The id has to survive the builder for an update in place.
describe("a saved question keeps its id through the builder", () => {
  it("sends the saved id back, so the question is updated rather than replaced", () => {
    const loaded = toBuilderQuestion(savedQuestion({ id: "question-42" }), 1);
    expect(toQuestionInput({ ...loaded, prompt: "Edited prompt" })).toMatchObject({
      id: "question-42",
      prompt: "Edited prompt",
    });
  });

  it("sends no id for a question added in this edit", () => {
    expect(toQuestionInput(builderQuestion())).not.toHaveProperty("id");
  });
});
