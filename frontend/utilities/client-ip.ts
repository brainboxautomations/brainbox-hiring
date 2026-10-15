/**
 * The visitor's IP address, as the host reports it, for rate limiting.
 *
 * Amplify serves the app through CloudFront. CloudFront's own
 * `cloudfront-viewer-address` header ("ip:port") cannot be set by the client,
 * so it is preferred when present. Otherwise the first `x-forwarded-for` entry
 * is used, which a client can influence by sending its own header; that only
 * helps an attacker spread requests across fake addresses, and the captcha and
 * the per-email limit on applications still hold.
 *
 * Which headers Amplify actually forwards should be confirmed on staging before
 * relying on the per-IP limit alone.
 */
export function clientIp(headers: Headers): string | null {
  const viewer = headers.get("cloudfront-viewer-address")?.trim();
  if (viewer) {
    // IPv4 "1.2.3.4:5678" or IPv6 "2001:db8::1:5678": the port is after the last colon.
    const lastColon = viewer.lastIndexOf(":");
    const ip = lastColon > 0 ? viewer.slice(0, lastColon) : viewer;
    if (ip) return ip;
  }

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return headers.get("x-real-ip")?.trim() || null;
}
