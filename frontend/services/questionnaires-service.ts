import { HttpClient } from "@/services/http-client";
import type {
  QuestionnaireInput,
  QuestionnaireResendResult,
  QuestionnaireTemplate,
} from "@/types/api";

export const QuestionnaireRemindersService = {
  setStopped: (questionnaireResponseId: string, remindersStopped: boolean) =>
    HttpClient.patch<{ remindersStoppedAt: string | null }, { remindersStopped: boolean }>(
      `/questionnaire-responses/${questionnaireResponseId}`,
      { remindersStopped },
    ),
};

export const QuestionnaireResponsesService = {
  /** Sends one questionnaire on a profile again: a fresh link, or a new ask if completed. */
  resend: (questionnaireResponseId: string) =>
    HttpClient.post<QuestionnaireResendResult, Record<string, never>>(
      `/questionnaire-responses/${questionnaireResponseId}/resend`,
      {},
    ),
};

export const QuestionnairesService = {
  list: () =>
    HttpClient.get<{ questionnaires: QuestionnaireTemplate[] }>("/questionnaires").then(
      (r) => r.questionnaires,
    ),

  create: (input: QuestionnaireInput) =>
    HttpClient.post<{ questionnaire: QuestionnaireTemplate }, QuestionnaireInput>(
      "/questionnaires",
      input,
    ).then((r) => r.questionnaire),

  update: (id: string, input: QuestionnaireInput) =>
    HttpClient.patch<{ questionnaire: QuestionnaireTemplate }, QuestionnaireInput>(
      `/questionnaires/${id}`,
      input,
    ).then((r) => r.questionnaire),

  remove: (id: string) => HttpClient.delete<{ ok: boolean }>(`/questionnaires/${id}`),
};
