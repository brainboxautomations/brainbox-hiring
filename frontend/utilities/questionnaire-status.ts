import type { QuestionnaireResponseDetail } from "@/types/api";
import { isQuestionnaireTokenExpired } from "./questionnaire-token";

export type QuestionnaireCompletionState = "completed" | "awaiting" | "link_expired" | "not_sent";

export type QuestionnaireCompletionInput = Pick<
  QuestionnaireResponseDetail,
  "context" | "status" | "sentAt" | "linkExpiresAt"
>;

export function questionnaireCompletionState(
  response: QuestionnaireCompletionInput,
  now: Date,
): QuestionnaireCompletionState {
  if (response.status === "completed") return "completed";
  if (response.context === "application_embedded") return "awaiting";
  if (!response.sentAt) return "not_sent";

  if (response.linkExpiresAt) {
    const expiresAt = new Date(response.linkExpiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && isQuestionnaireTokenExpired(expiresAt, now)) {
      return "link_expired";
    }
  }

  return "awaiting";
}
