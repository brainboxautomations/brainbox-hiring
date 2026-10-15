export type SignatureHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export type SignatureVerdict = { ok: true } | { ok: false; reason: string };

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

const SECRET_PREFIX = "whsec_";

export function readSignatureHeaders(headers: Headers): SignatureHeaders {
  const pick = (svix: string, standard: string) =>
    headers.get(svix) ?? headers.get(standard) ?? null;

  return {
    id: pick("svix-id", "webhook-id"),
    timestamp: pick("svix-timestamp", "webhook-timestamp"),
    signature: pick("svix-signature", "webhook-signature"),
  };
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function encodeBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function encodeUtf8(value: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(value);
  const copy = new Uint8Array(encoded.length);
  copy.set(encoded);
  return copy;
}

export function constantTimeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function signingKeyBytes(secret: string): Uint8Array<ArrayBuffer> | null {
  const trimmed = secret.trim();
  if (trimmed.length === 0) return null;
  const raw = trimmed.startsWith(SECRET_PREFIX) ? trimmed.slice(SECRET_PREFIX.length) : trimmed;
  const decoded = decodeBase64(raw);
  return decoded && decoded.length > 0 ? decoded : null;
}

export async function signPayload(
  secret: string,
  id: string,
  timestamp: string,
  payload: string,
): Promise<string | null> {
  const keyBytes = signingKeyBytes(secret);
  if (!keyBytes) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signed = await crypto.subtle.sign("HMAC", key, encodeUtf8(`${id}.${timestamp}.${payload}`));

  return encodeBase64(new Uint8Array(signed));
}

export function timestampWithinTolerance(
  timestamp: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const sent = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(sent)) return false;
  return Math.abs(nowSeconds - sent) <= SIGNATURE_TOLERANCE_SECONDS;
}

export async function verifyWebhookSignature(input: {
  secret: string;
  headers: SignatureHeaders;
  payload: string;
  nowSeconds?: number;
}): Promise<SignatureVerdict> {
  const { id, timestamp, signature } = input.headers;

  if (!input.secret.trim()) return { ok: false, reason: "No signing secret is configured" };
  if (!id || !timestamp || !signature) return { ok: false, reason: "Missing signature headers" };
  if (!timestampWithinTolerance(timestamp, input.nowSeconds)) {
    return { ok: false, reason: "Signature timestamp is outside the tolerance window" };
  }

  const expected = await signPayload(input.secret, id, timestamp, input.payload);
  if (!expected) return { ok: false, reason: "The signing secret is not valid base64" };

  const offered = signature
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => (part.includes(",") ? part.slice(part.indexOf(",") + 1) : part));

  if (offered.length === 0) return { ok: false, reason: "Missing signature headers" };
  if (!offered.some((candidate) => constantTimeEquals(candidate, expected))) {
    return { ok: false, reason: "Signature does not match" };
  }

  return { ok: true };
}
