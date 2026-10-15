import { describe, expect, it } from "vitest";

import {
  SIGNATURE_TOLERANCE_SECONDS,
  readSignatureHeaders,
  signPayload,
  signingKeyBytes,
  timestampWithinTolerance,
  verifyWebhookSignature,
} from "@/utilities/webhook-signature";

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const PAYLOAD = '{"type":"email.received","data":{"email_id":"abc"}}';
const ID = "msg_2gK3iH8LxKz";
const NOW = 1_770_000_000;

async function headersFor(overrides: Partial<{ id: string; timestamp: string }> = {}) {
  const id = overrides.id ?? ID;
  const timestamp = overrides.timestamp ?? String(NOW);
  const signature = await signPayload(SECRET, id, timestamp, PAYLOAD);
  return { id, timestamp, signature: `v1,${signature}` };
}

describe("readSignatureHeaders", () => {
  it("reads the svix-prefixed headers Resend sends", () => {
    const headers = new Headers({
      "svix-id": "a",
      "svix-timestamp": "1",
      "svix-signature": "v1,x",
    });
    expect(readSignatureHeaders(headers)).toEqual({
      id: "a",
      timestamp: "1",
      signature: "v1,x",
    });
  });

  it("also reads the unprefixed Standard Webhooks names", () => {
    const headers = new Headers({
      "webhook-id": "a",
      "webhook-timestamp": "1",
      "webhook-signature": "v1,x",
    });
    expect(readSignatureHeaders(headers).id).toBe("a");
  });

  it("reports missing headers as null rather than empty strings", () => {
    expect(readSignatureHeaders(new Headers())).toEqual({
      id: null,
      timestamp: null,
      signature: null,
    });
  });
});

describe("signingKeyBytes", () => {
  it("strips the whsec_ prefix before decoding", () => {
    const withPrefix = signingKeyBytes(SECRET);
    const without = signingKeyBytes(SECRET.replace("whsec_", ""));
    expect(withPrefix).toEqual(without);
  });

  it("refuses a blank or non-base64 secret", () => {
    expect(signingKeyBytes("")).toBeNull();
    expect(signingKeyBytes("   ")).toBeNull();
    expect(signingKeyBytes("whsec_!!!not base64!!!")).toBeNull();
  });
});

describe("timestampWithinTolerance", () => {
  it("accepts a timestamp inside the replay window", () => {
    expect(timestampWithinTolerance(String(NOW), NOW)).toBe(true);
    expect(timestampWithinTolerance(String(NOW - SIGNATURE_TOLERANCE_SECONDS + 1), NOW)).toBe(true);
  });

  it("rejects a replayed old delivery", () => {
    expect(timestampWithinTolerance(String(NOW - SIGNATURE_TOLERANCE_SECONDS - 1), NOW)).toBe(
      false,
    );
  });

  it("rejects a timestamp from the future", () => {
    expect(timestampWithinTolerance(String(NOW + SIGNATURE_TOLERANCE_SECONDS + 1), NOW)).toBe(
      false,
    );
  });

  it("rejects a non-numeric timestamp", () => {
    expect(timestampWithinTolerance("tomorrow", NOW)).toBe(false);
  });
});

describe("verifyWebhookSignature", () => {
  it("accepts a correctly signed delivery", async () => {
    const verdict = await verifyWebhookSignature({
      secret: SECRET,
      headers: await headersFor(),
      payload: PAYLOAD,
      nowSeconds: NOW,
    });
    expect(verdict).toEqual({ ok: true });
  });

  it("accepts when one of several offered signatures matches, as during key rotation", async () => {
    const good = await headersFor();
    const verdict = await verifyWebhookSignature({
      secret: SECRET,
      headers: { ...good, signature: `v1,ZmFrZQ== ${good.signature}` },
      payload: PAYLOAD,
      nowSeconds: NOW,
    });
    expect(verdict.ok).toBe(true);
  });

  it("rejects a payload that was altered after signing", async () => {
    const verdict = await verifyWebhookSignature({
      secret: SECRET,
      headers: await headersFor(),
      payload: `${PAYLOAD} `,
      nowSeconds: NOW,
    });
    expect(verdict).toEqual({ ok: false, reason: "Signature does not match" });
  });

  it("rejects a signature made with a different secret", async () => {
    const foreign = await signPayload(
      "whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ID,
      String(NOW),
      PAYLOAD,
    );
    const verdict = await verifyWebhookSignature({
      secret: SECRET,
      headers: { id: ID, timestamp: String(NOW), signature: `v1,${foreign}` },
      payload: PAYLOAD,
      nowSeconds: NOW,
    });
    expect(verdict.ok).toBe(false);
  });

  it("rejects a delivery whose id was swapped, so a signature cannot be reused", async () => {
    const signed = await headersFor();
    const verdict = await verifyWebhookSignature({
      secret: SECRET,
      headers: { ...signed, id: "msg_someone_elses" },
      payload: PAYLOAD,
      nowSeconds: NOW,
    });
    expect(verdict.ok).toBe(false);
  });

  it("rejects a replayed delivery even though its signature is genuine", async () => {
    const old = String(NOW - SIGNATURE_TOLERANCE_SECONDS - 60);
    const verdict = await verifyWebhookSignature({
      secret: SECRET,
      headers: await headersFor({ timestamp: old }),
      payload: PAYLOAD,
      nowSeconds: NOW,
    });
    expect(verdict).toEqual({
      ok: false,
      reason: "Signature timestamp is outside the tolerance window",
    });
  });

  it("rejects a delivery with no signature headers at all", async () => {
    const verdict = await verifyWebhookSignature({
      secret: SECRET,
      headers: { id: null, timestamp: null, signature: null },
      payload: PAYLOAD,
      nowSeconds: NOW,
    });
    expect(verdict).toEqual({ ok: false, reason: "Missing signature headers" });
  });

  it("fails closed when no secret is configured, so an unconfigured deployment accepts nothing", async () => {
    const verdict = await verifyWebhookSignature({
      secret: "",
      headers: await headersFor(),
      payload: PAYLOAD,
      nowSeconds: NOW,
    });
    expect(verdict).toEqual({ ok: false, reason: "No signing secret is configured" });
  });

  it("fails closed when the configured secret is not valid base64", async () => {
    const verdict = await verifyWebhookSignature({
      secret: "whsec_!!!!",
      headers: await headersFor(),
      payload: PAYLOAD,
      nowSeconds: NOW,
    });
    expect(verdict).toEqual({ ok: false, reason: "The signing secret is not valid base64" });
  });
});
