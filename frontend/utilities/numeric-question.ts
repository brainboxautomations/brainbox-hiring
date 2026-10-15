import type { Question } from "@/types/api";

export function numericAnswerProblem(question: Question, raw: string): string | null {
  if (question.type !== "numeric") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return `Enter a number for: ${question.prompt}`;
  if (question.numericMin !== null && value < question.numericMin) {
    return `${question.prompt} — the lowest accepted answer is ${question.numericMin}.`;
  }
  if (question.numericMax !== null && value > question.numericMax) {
    return `${question.prompt} — the highest accepted answer is ${question.numericMax}.`;
  }
  return null;
}

export function numericRangeHint(question: Question): string | null {
  const { numericMin, numericMax } = question;
  if (numericMin !== null && numericMax !== null) return `Between ${numericMin} and ${numericMax}`;
  if (numericMin !== null) return `${numericMin} or more`;
  if (numericMax !== null) return `${numericMax} or less`;
  return null;
}
