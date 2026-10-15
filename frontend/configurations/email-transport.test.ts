// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const send = vi.fn();

vi.mock("resend", () => ({
  Resend: class {
    emails = { send, get: vi.fn(async () => ({ data: null })) };
  },
}));

beforeAll(() => {
  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.EMAIL_RELAY_ADDRESS = "talent@example.com";
});

const transport = async () => {
  const { getEmailTransport, EmailSendError } = await import("@/configurations/email-transport");
  return { transport: getEmailTransport(), EmailSendError };
};

const EMAIL = {
  senderDisplayName: "Acme Talent",
  messageId: "<test@hiring.example.com>",
  to: "candidate@example.com",
  cc: [],
  bcc: [],
  subject: "Hello",
  html: "<p>Hi</p>",
  text: "Hi",
  attachments: [],
  inReplyTo: null,
  references: [],
};

const refused = (name: string) => ({
  data: null,
  error: { name, message: `refused: ${name}`, statusCode: 429 },
});
const accepted = { data: { id: "email_1" }, error: null };

afterEach(() => {
  send.mockReset();
  vi.useRealTimers();
});

describe("Resend transport and the relay's limits", () => {
  // Ten requests a second is a per-second limit: a short pause clears it.
  it("retries a send refused for going over the per-second limit", async () => {
    vi.useFakeTimers();
    send
      .mockResolvedValueOnce(refused("rate_limit_exceeded"))
      .mockResolvedValueOnce(refused("rate_limit_exceeded"))
      .mockResolvedValueOnce(accepted);
    const { transport: t } = await transport();

    const sending = t.send(EMAIL);
    await vi.runAllTimersAsync();

    await expect(sending).resolves.toMatchObject({ relayMessageId: "email_1" });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("gives up after a few retries rather than waiting forever", async () => {
    vi.useFakeTimers();
    send.mockResolvedValue(refused("rate_limit_exceeded"));
    const { transport: t, EmailSendError } = await transport();
    expect(EmailSendError).toBeTypeOf("function");

    const sending = t.send(EMAIL).catch((error: unknown) => error);
    await vi.runAllTimersAsync();

    const error = await sending;
    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as InstanceType<typeof EmailSendError>).limit).toBeNull();
    expect(send).toHaveBeenCalledTimes(4);
  });

  // Waiting a moment cannot help a spent daily quota; the caller decides what
  // to do with the email, so the error says which limit it was.
  it("reports the daily limit at once, without retrying", async () => {
    send.mockResolvedValue(refused("daily_quota_exceeded"));
    const { transport: t, EmailSendError } = await transport();
    expect(EmailSendError).toBeTypeOf("function");

    const error = await t.send(EMAIL).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as InstanceType<typeof EmailSendError>).limit).toBe("daily");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reports the monthly limit as its own kind", async () => {
    send.mockResolvedValue(refused("monthly_quota_exceeded"));
    const { transport: t, EmailSendError } = await transport();
    expect(EmailSendError).toBeTypeOf("function");

    const error = await t.send(EMAIL).catch((e: unknown) => e);
    expect((error as InstanceType<typeof EmailSendError>).limit).toBe("monthly");
  });

  it("leaves any other refusal as an ordinary failure", async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "Invalid to address", statusCode: 422 },
    });
    const { transport: t, EmailSendError } = await transport();
    expect(EmailSendError).toBeTypeOf("function");

    const error = await t.send(EMAIL).catch((e: unknown) => e);
    expect((error as InstanceType<typeof EmailSendError>).message).toBe("Invalid to address");
    expect((error as InstanceType<typeof EmailSendError>).limit).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("Resend transport without a relay address", () => {
  it("refuses to send and names the missing variable", async () => {
    vi.resetModules();
    const relay = process.env.EMAIL_RELAY_ADDRESS;
    delete process.env.EMAIL_RELAY_ADDRESS;

    try {
      const { transport: t, EmailSendError } = await transport();
      const error = await t.send(EMAIL).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmailSendError);
      expect((error as Error).message).toMatch(/EMAIL_RELAY_ADDRESS/);
      expect(send).not.toHaveBeenCalled();
    } finally {
      process.env.EMAIL_RELAY_ADDRESS = relay;
      vi.resetModules();
    }
  });
});
