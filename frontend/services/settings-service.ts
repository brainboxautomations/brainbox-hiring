import { HttpClient } from "@/services/http-client";
import type {
  EmailTimingInput,
  SlackConfigInput,
  SlackTokenInput,
} from "@/schemas/settings-schema";
import type { CreateTeamMemberInput } from "@/schemas/team-member-schema";
import type { QuestionnaireEmailSettingsInput } from "@/schemas/questionnaire-schema";
import type {
  EmailSettings,
  EmailTimingSettings,
  QuestionnaireEmailSettings,
  SlackSettings,
  TeamMember,
} from "@/types/api";

export const SettingsService = {
  getSlack: () => HttpClient.get<{ slack: SlackSettings }>("/settings/slack").then((r) => r.slack),

  saveSlack: (input: SlackConfigInput) =>
    HttpClient.put<{ slack: SlackSettings }, SlackConfigInput>("/settings/slack", input).then(
      (r) => r.slack,
    ),

  saveSlackToken: (input: SlackTokenInput) =>
    HttpClient.put<{ slack: SlackSettings }, SlackTokenInput>("/settings/slack/token", input).then(
      (r) => r.slack,
    ),

  listUsers: () => HttpClient.get<{ users: TeamMember[] }>("/settings/users").then((r) => r.users),

  createUser: (input: CreateTeamMemberInput) =>
    HttpClient.post<{ user: TeamMember }, CreateTeamMemberInput>("/settings/users", input).then(
      (r) => r.user,
    ),

  getEmail: () => HttpClient.get<{ email: EmailSettings }>("/settings/email").then((r) => r.email),

  getEmailTiming: () =>
    HttpClient.get<{ timing: EmailTimingSettings }>("/settings/email-timing").then((r) => r.timing),

  saveEmailTiming: (input: EmailTimingInput) =>
    HttpClient.put<{ timing: EmailTimingSettings }, EmailTimingInput>(
      "/settings/email-timing",
      input,
    ).then((r) => r.timing),

  getQuestionnaireEmails: () =>
    HttpClient.get<{ emails: QuestionnaireEmailSettings }>("/settings/questionnaire-emails").then(
      (r) => r.emails,
    ),

  saveQuestionnaireEmails: (input: QuestionnaireEmailSettingsInput) =>
    HttpClient.put<{ emails: QuestionnaireEmailSettings }, QuestionnaireEmailSettingsInput>(
      "/settings/questionnaire-emails",
      input,
    ).then((r) => r.emails),
};
