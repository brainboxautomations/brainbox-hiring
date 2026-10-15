import { describe, expect, it } from "vitest";

import {
  applyPayloadSchema,
  MAX_EMAIL_LENGTH,
  MAX_FORM_ANSWERS,
  MAX_FORM_ANSWER_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PHONE_LENGTH,
} from "@/schemas/apply-schema";
import {
  MAX_ANSWER_CHOICES,
  MAX_ANSWER_TEXT_LENGTH,
  MAX_TEXT_ANSWERS,
  MAX_UPLOADS,
  MAX_VIDEO_ANSWERS,
} from "@/schemas/candidate-answer-schema";

const POSITION_ID = "11111111-1111-4111-8111-111111111111";
const QUESTION_ID = "22222222-2222-4222-8222-222222222222";
const RESUME_PATH = `applications/${POSITION_ID}/33333333-3333-4333-8333-333333333333-cv.pdf`;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    positionId: POSITION_ID,
    firstName: "Ada",
    email: "ada@example.com",
    ...overrides,
  };
}

function repeat(length: number): string {
  return "a".repeat(length);
}

describe("a real application still parses", () => {
  it("accepts an ordinary submission", () => {
    const parsed = applyPayloadSchema.safeParse(
      payload({
        lastName: "Lovelace",
        phone: "+44 7700 900123",
        formAnswers: { why_this_role: "I have wanted to work here for years." },
        questionnaireTextAnswers: [{ questionId: QUESTION_ID, value: "Yes" }],
        uploads: [
          {
            slot: "resume",
            storagePath: RESUME_PATH,
            filename: "cv.pdf",
            mimeType: "application/pdf",
          },
        ],
        videoAnswers: [
          { source: "link", questionId: QUESTION_ID, url: "https://www.loom.com/share/abc" },
        ],
      }),
    );

    expect(parsed.success).toBe(true);
  });

  it("accepts answers right up to the limits", () => {
    const parsed = applyPayloadSchema.safeParse(
      payload({
        firstName: repeat(MAX_NAME_LENGTH),
        phone: repeat(MAX_PHONE_LENGTH),
        formAnswers: { why_this_role: repeat(MAX_FORM_ANSWER_LENGTH) },
        questionnaireTextAnswers: [
          { questionId: QUESTION_ID, value: repeat(MAX_ANSWER_TEXT_LENGTH) },
        ],
      }),
    );

    expect(parsed.success).toBe(true);
  });
});

describe("no single request may carry megabytes into the database", () => {
  it("bounds the name fields", () => {
    expect(applyPayloadSchema.safeParse(payload({ firstName: repeat(101) })).success).toBe(false);
    expect(applyPayloadSchema.safeParse(payload({ lastName: repeat(101) })).success).toBe(false);
  });

  it("bounds the email address at the RFC maximum", () => {
    const long = `${repeat(MAX_EMAIL_LENGTH)}@example.com`;
    expect(applyPayloadSchema.safeParse(payload({ email: long })).success).toBe(false);
  });

  it("bounds the phone number", () => {
    expect(applyPayloadSchema.safeParse(payload({ phone: repeat(41) })).success).toBe(false);
  });

  it("bounds each application-form answer", () => {
    const parsed = applyPayloadSchema.safeParse(
      payload({ formAnswers: { why_this_role: repeat(MAX_FORM_ANSWER_LENGTH + 1) } }),
    );

    expect(parsed.success).toBe(false);
  });

  it("bounds how many application-form answers there can be", () => {
    const answers: Record<string, string> = {};
    for (let index = 0; index <= MAX_FORM_ANSWERS; index += 1) {
      answers[`field_${index}`] = "x";
    }

    expect(applyPayloadSchema.safeParse(payload({ formAnswers: answers })).success).toBe(false);
  });

  it("bounds a questionnaire answer and the number of them", () => {
    const tooLong = applyPayloadSchema.safeParse(
      payload({
        questionnaireTextAnswers: [
          { questionId: QUESTION_ID, value: repeat(MAX_ANSWER_TEXT_LENGTH + 1) },
        ],
      }),
    );

    const tooMany = applyPayloadSchema.safeParse(
      payload({
        questionnaireTextAnswers: Array.from({ length: MAX_TEXT_ANSWERS + 1 }, () => ({
          questionId: QUESTION_ID,
          value: "x",
        })),
      }),
    );

    expect(tooLong.success).toBe(false);
    expect(tooMany.success).toBe(false);
  });

  it("bounds a multiple-choice answer", () => {
    const parsed = applyPayloadSchema.safeParse(
      payload({
        questionnaireTextAnswers: [
          {
            questionId: QUESTION_ID,
            value: Array.from({ length: MAX_ANSWER_CHOICES + 1 }, () => "x"),
          },
        ],
      }),
    );

    expect(parsed.success).toBe(false);
  });

  it("bounds the uploads array, which is otherwise 15 MB per element", () => {
    const parsed = applyPayloadSchema.safeParse(
      payload({
        // Valid elements, so the only thing wrong is how many there are.
        uploads: Array.from({ length: MAX_UPLOADS + 1 }, () => ({
          slot: "question",
          questionId: QUESTION_ID,
          storagePath: RESUME_PATH,
        })),
      }),
    );

    expect(parsed.success).toBe(false);
  });

  it("bounds the video answers array", () => {
    const parsed = applyPayloadSchema.safeParse(
      payload({
        videoAnswers: Array.from({ length: MAX_VIDEO_ANSWERS + 1 }, () => ({
          source: "link",
          questionId: QUESTION_ID,
          url: "https://www.loom.com/share/abc",
        })),
      }),
    );

    expect(parsed.success).toBe(false);
  });
});

describe("files arrive as storage paths, not inside the request", () => {
  // Files used to ride in the submit request under a file key. The host
  // rejects bodies over ~6 MB before the route runs, so a large file failed
  // with an empty reply. The browser now uploads each one and sends its path.
  it("accepts a resume described by its storage path", () => {
    const parsed = applyPayloadSchema.safeParse(
      payload({ uploads: [{ slot: "resume", storagePath: RESUME_PATH }] }),
    );

    expect(parsed.success).toBe(true);
  });

  it("rejects a resume sent the old way, as a file key", () => {
    const parsed = applyPayloadSchema.safeParse(
      payload({ uploads: [{ slot: "resume", fileKey: "file_resume" }] }),
    );

    expect(parsed.success).toBe(false);
  });

  it("accepts a file answer described by its storage path", () => {
    const parsed = applyPayloadSchema.safeParse(
      payload({
        uploads: [{ slot: "question", questionId: QUESTION_ID, storagePath: RESUME_PATH }],
      }),
    );

    expect(parsed.success).toBe(true);
  });

  it("rejects a file answer sent the old way, as a file key", () => {
    const parsed = applyPayloadSchema.safeParse(
      payload({
        uploads: [
          { slot: "question", fileKey: "file_q", questionId: QUESTION_ID, questionType: "file" },
        ],
      }),
    );

    expect(parsed.success).toBe(false);
  });
});
