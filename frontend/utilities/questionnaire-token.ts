const TOKEN_BYTES = 32;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export const QUESTIONNAIRE_TOKEN_LENGTH = 43;

export const QUESTIONNAIRE_TOKEN_TTL_DAYS = 30;

const TOKEN_SHAPE = new RegExp(`^[A-Za-z0-9_-]{${QUESTIONNAIRE_TOKEN_LENGTH}}$`);

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateQuestionnaireToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function isQuestionnaireTokenShape(value: string): boolean {
  return TOKEN_SHAPE.test(value);
}

export function questionnaireTokenExpiresAt(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + QUESTIONNAIRE_TOKEN_TTL_DAYS * MILLISECONDS_PER_DAY);
}

export function isQuestionnaireTokenExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}
