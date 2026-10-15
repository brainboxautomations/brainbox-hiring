import { describe, expect, it, vi } from "vitest";

import {
  BULK_SEND_NOT_SENT,
  BULK_SEND_UNCERTAIN,
  sendInChunks,
} from "@/utilities/chunked-bulk-send";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `app-${i + 1}`);

describe("sendInChunks", () => {
  it("sends a large selection a few at a time, one request after another", async () => {
    const send = vi.fn(async (chunk: string[]) => ({ sent: chunk, failures: [] }));

    const result = await sendInChunks(ids(25), send, { chunkSize: 10 });

    expect(send.mock.calls.map(([chunk]) => chunk.length)).toEqual([10, 10, 5]);
    expect(result.sent).toEqual(ids(25));
    expect(result.failures).toEqual([]);
  });

  it("keeps the failures the server reports for individual candidates", async () => {
    const send = vi.fn(async (chunk: string[]) => ({
      sent: chunk.slice(1),
      failures: [{ applicationId: chunk[0]!, reason: "No email address" }],
    }));

    const result = await sendInChunks(ids(4), send, { chunkSize: 2 });

    expect(result.sent).toEqual(["app-2", "app-4"]);
    expect(result.failures.map((f) => f.applicationId)).toEqual(["app-1", "app-3"]);
  });

  // A failed request may still have sent some of its emails, so its candidates
  // are flagged as uncertain, and the rest of the selection still goes out.
  it("flags only the failed request's candidates and carries on with the rest", async () => {
    const send = vi
      .fn<(chunk: string[]) => Promise<{ sent: string[]; failures: never[] }>>()
      .mockResolvedValueOnce({ sent: ["app-1", "app-2"], failures: [] })
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ sent: ["app-5"], failures: [] });

    const result = await sendInChunks(ids(5), send, { chunkSize: 2 });

    expect(result.sent).toEqual(["app-1", "app-2", "app-5"]);
    expect(result.failures).toEqual([
      { applicationId: "app-3", reason: BULK_SEND_UNCERTAIN },
      { applicationId: "app-4", reason: BULK_SEND_UNCERTAIN },
    ]);
  });

  it("reports a request the server turns down up front as one error, as before", async () => {
    const refused = new Error("That message template does not exist");
    const send = vi.fn().mockRejectedValue(refused);

    await expect(
      sendInChunks(ids(25), send, { chunkSize: 10, isRejection: () => true }),
    ).rejects.toBe(refused);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("marks a later turned-down request as not sent, not as possibly sent", async () => {
    const send = vi
      .fn<(chunk: string[]) => Promise<{ sent: string[]; failures: never[] }>>()
      .mockResolvedValueOnce({ sent: ["app-1", "app-2"], failures: [] })
      .mockRejectedValueOnce(new Error("422"));

    const result = await sendInChunks(ids(3), send, { chunkSize: 2, isRejection: () => true });

    expect(result.failures).toEqual([{ applicationId: "app-3", reason: BULK_SEND_NOT_SENT }]);
  });

  it("makes no request for an empty selection", async () => {
    const send = vi.fn();
    expect(await sendInChunks([], send)).toEqual({ sent: [], failures: [] });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("sendInChunks with emails held past the daily limit", () => {
  it("keeps every request's scheduled candidates", async () => {
    const send = vi
      .fn<
        (chunk: string[]) => Promise<{ sent: string[]; failures: never[]; scheduled?: string[] }>
      >()
      .mockResolvedValueOnce({ sent: ["app-1"], failures: [], scheduled: ["app-2"] })
      .mockResolvedValueOnce({ sent: [], failures: [], scheduled: ["app-3", "app-4"] });

    const result = await sendInChunks(ids(4), send, { chunkSize: 2 });

    expect(result.sent).toEqual(["app-1"]);
    expect(result.scheduled).toEqual(["app-2", "app-3", "app-4"]);
  });
});
