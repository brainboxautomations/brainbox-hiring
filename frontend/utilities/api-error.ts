type HttpErrorLike = { response?: { status?: number; data?: unknown } };

function asHttpError(error: unknown): HttpErrorLike | null {
  if (typeof error !== "object" || error === null || !("response" in error)) return null;
  return error as HttpErrorLike;
}

export function apiErrorStatus(error: unknown): number | null {
  return asHttpError(error)?.response?.status ?? null;
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  const data = asHttpError(error)?.response?.data;
  if (typeof data === "object" && data !== null && "error" in data) {
    const message = (data as { error: unknown }).error;
    if (typeof message === "string" && message.trim().length > 0) return message;
  }
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return fallback;
}
