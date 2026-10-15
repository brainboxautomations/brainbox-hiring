/**
 * The `next` query value, if it is a path on this site.
 *
 * "//evil.com" and "/\evil.com" both start with a slash but browsers treat them
 * as another host, so only a single leading slash is accepted.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/positions"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}
