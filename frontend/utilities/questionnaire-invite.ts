export type QuestionnaireInvite =
  | { available: true; urlFor: (token: string) => string }
  | { available: false; reason: string };

export type QuestionnaireInviteConfig = {
  appBaseUrl: string;
  careersUrl: string;
};

export const QUESTIONNAIRE_LINK_UNAVAILABLE =
  "No public base URL is configured, so a questionnaire link cannot be built";

function originOf(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function questionnaireBaseUrl(config: QuestionnaireInviteConfig): string | null {
  return originOf(config.appBaseUrl) ?? originOf(config.careersUrl);
}

export function questionnaireInvite(config: QuestionnaireInviteConfig): QuestionnaireInvite {
  const baseUrl = questionnaireBaseUrl(config);
  if (!baseUrl) return { available: false, reason: QUESTIONNAIRE_LINK_UNAVAILABLE };

  return {
    available: true,
    urlFor: (token: string) => `${baseUrl}/q/${encodeURIComponent(token)}`,
  };
}
