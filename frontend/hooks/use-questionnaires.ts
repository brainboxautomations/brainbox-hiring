"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  QuestionnaireRemindersService,
  QuestionnaireResponsesService,
  QuestionnairesService,
} from "@/services/questionnaires-service";
import type { QuestionnaireInput } from "@/types/api";

const KEY = ["questionnaires"] as const;

export function useQuestionnaires() {
  return useQuery({
    queryKey: KEY,
    queryFn: QuestionnairesService.list,
  });
}

export function useCreateQuestionnaire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuestionnaireInput) => QuestionnairesService.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateQuestionnaire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: QuestionnaireInput }) =>
      QuestionnairesService.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteQuestionnaire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => QuestionnairesService.remove(id),

    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["positions"] });
    },
  });
}

export function useSetQuestionnaireReminders(applicationId: string | null) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ responseId, stopped }: { responseId: string; stopped: boolean }) =>
      QuestionnaireRemindersService.setStopped(responseId, stopped),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["candidate-profile", applicationId] });
    },
  });
}

/** Sends one questionnaire on a profile again; the profile and its email thread then refresh. */
export function useResendQuestionnaire(applicationId: string | null) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (responseId: string) => QuestionnaireResponsesService.resend(responseId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["candidate-profile", applicationId] });
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}
