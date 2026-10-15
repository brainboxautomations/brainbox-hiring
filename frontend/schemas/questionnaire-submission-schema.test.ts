import { describe, expect, it } from "vitest";

import {
  MAX_ANSWER_CHOICES,
  MAX_ANSWER_TEXT_LENGTH,
  MAX_TEXT_ANSWERS,
  MAX_UPLOADS,
  MAX_VIDEO_ANSWERS,
} from "@/schemas/candidate-answer-schema";
import { questionnaireSubmissionSchema } from "@/schemas/questionnaire-submission-schema";

const QUESTION_ID = "22222222-2222-4222-8222-222222222222";

function submission(overrides: Record<string, unknown> = {}) {
  return { token: "8Kj2mQ7vX1pR4tY6uI0oP3aS5dF7gH9jK2lZ4xC6vB8", ...overrides };
}

function repeat(length: number): string {
  return "a".repeat(length);
}

describe("a real questionnaire submission still parses", () => {
  it("accepts an ordinary set of answers", () => {
    const parsed = questionnaireSubmissionSchema.safeParse(
      submission({
        textAnswers: [
          { questionId: QUESTION_ID, value: "I have five years of experience." },
          { questionId: QUESTION_ID, value: 7 },
          { questionId: QUESTION_ID, value: ["typescript", "postgres"] },
        ],
        uploads: [{ questionId: QUESTION_ID, fileKey: "file-0" }],
      }),
    );

    expect(parsed.success).toBe(true);
  });

  it("accepts an answer right up to the limit", () => {
    const parsed = questionnaireSubmissionSchema.safeParse(
      submission({
        textAnswers: [{ questionId: QUESTION_ID, value: repeat(MAX_ANSWER_TEXT_LENGTH) }],
      }),
    );

    expect(parsed.success).toBe(true);
  });
});

describe("the hosted questionnaire is bounded too", () => {
  it("bounds a text answer", () => {
    const parsed = questionnaireSubmissionSchema.safeParse(
      submission({
        textAnswers: [{ questionId: QUESTION_ID, value: repeat(MAX_ANSWER_TEXT_LENGTH + 1) }],
      }),
    );

    expect(parsed.success).toBe(false);
  });

  it("bounds how many answers one submission may carry", () => {
    const parsed = questionnaireSubmissionSchema.safeParse(
      submission({
        textAnswers: Array.from({ length: MAX_TEXT_ANSWERS + 1 }, () => ({
          questionId: QUESTION_ID,
          value: "x",
        })),
      }),
    );

    expect(parsed.success).toBe(false);
  });

  it("bounds a multiple-choice answer", () => {
    const parsed = questionnaireSubmissionSchema.safeParse(
      submission({
        textAnswers: [
          {
            questionId: QUESTION_ID,
            value: Array.from({ length: MAX_ANSWER_CHOICES + 1 }, () => "x"),
          },
        ],
      }),
    );

    expect(parsed.success).toBe(false);
  });

  it("bounds the uploads and video answers arrays", () => {
    const uploads = questionnaireSubmissionSchema.safeParse(
      submission({
        uploads: Array.from({ length: MAX_UPLOADS + 1 }, (_, index) => ({
          questionId: QUESTION_ID,
          fileKey: `file-${index}`,
        })),
      }),
    );

    const videos = questionnaireSubmissionSchema.safeParse(
      submission({
        videoAnswers: Array.from({ length: MAX_VIDEO_ANSWERS + 1 }, () => ({
          source: "link",
          questionId: QUESTION_ID,
          url: "https://www.loom.com/share/abc",
        })),
      }),
    );

    expect(uploads.success).toBe(false);
    expect(videos.success).toBe(false);
  });

  it("still refuses a token that is not a token", () => {
    expect(questionnaireSubmissionSchema.safeParse(submission({ token: "" })).success).toBe(false);
    expect(
      questionnaireSubmissionSchema.safeParse(submission({ token: repeat(201) })).success,
    ).toBe(false);
  });
});
