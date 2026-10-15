"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { SettingsService } from "@/services/settings-service";
import type {
  EmailTimingInput,
  SlackConfigInput,
  SlackTokenInput,
} from "@/schemas/settings-schema";
import type { CreateTeamMemberInput } from "@/schemas/team-member-schema";
import type { QuestionnaireEmailSettingsInput } from "@/schemas/questionnaire-schema";

const SLACK_KEY = ["settings", "slack"] as const;
const USERS_KEY = ["settings", "users"] as const;
const EMAIL_KEY = ["settings", "email"] as const;
const EMAIL_TIMING_KEY = ["settings", "email-timing"] as const;
const QUESTIONNAIRE_EMAILS_KEY = ["settings", "questionnaire-emails"] as const;

export function useSlackSettings() {
  return useQuery({ queryKey: SLACK_KEY, queryFn: SettingsService.getSlack });
}

export function useSaveSlackSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SlackConfigInput) => SettingsService.saveSlack(input),
    onSuccess: (slack) => qc.setQueryData(SLACK_KEY, slack),
  });
}

export function useSaveSlackToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SlackTokenInput) => SettingsService.saveSlackToken(input),
    onSuccess: (slack) => qc.setQueryData(SLACK_KEY, slack),
  });
}

export function useTeamMembers() {
  return useQuery({ queryKey: USERS_KEY, queryFn: SettingsService.listUsers });
}

export function useCreateTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTeamMemberInput) => SettingsService.createUser(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  });
}

export function useEmailSettings() {
  return useQuery({ queryKey: EMAIL_KEY, queryFn: SettingsService.getEmail });
}

export function useEmailTiming() {
  return useQuery({ queryKey: EMAIL_TIMING_KEY, queryFn: SettingsService.getEmailTiming });
}

export function useSaveEmailTiming() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EmailTimingInput) => SettingsService.saveEmailTiming(input),
    onSuccess: (timing) => qc.setQueryData(EMAIL_TIMING_KEY, timing),
  });
}

/** The default questionnaire invite and reminder; each questionnaire can override them. */
export function useQuestionnaireEmails() {
  return useQuery({
    queryKey: QUESTIONNAIRE_EMAILS_KEY,
    queryFn: SettingsService.getQuestionnaireEmails,
  });
}

export function useSaveQuestionnaireEmails() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuestionnaireEmailSettingsInput) =>
      SettingsService.saveQuestionnaireEmails(input),
    onSuccess: (emails) => qc.setQueryData(QUESTIONNAIRE_EMAILS_KEY, emails),
  });
}
