import { afterEach, describe, expect, it, vi } from "vitest";

import { SlackPostError, getSlackTransport } from "@/configurations/slack-transport";

type FetchArgs = [input: string | URL | Request, init?: RequestInit];

function stubFetch(response: Response) {
  const spy = vi.fn(async () => response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(body: unknown, status = 200, statusText = "OK"): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

function post(token = "xoxb-token") {
  return getSlackTransport().postMessage(
    token,
    { channelId: "C0123ABCD", text: "hello" },
    AbortSignal.timeout(1_000),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Slack Web API transport", () => {
  it("posts to chat.postMessage with a bearer token and a JSON body", async () => {
    const fetchSpy = stubFetch(jsonResponse({ ok: true, ts: "1700000000.000100" }));

    await post("xoxb-a-real-looking-token");

    const [url, init] = fetchSpy.mock.calls[0] as unknown as FetchArgs;
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect(init?.method).toBe("POST");

    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer xoxb-a-real-looking-token");
    expect(headers["Content-Type"]).toContain("application/json");

    expect(JSON.parse(String(init?.body))).toEqual({
      channel: "C0123ABCD",
      text: "hello",
      // The Brainbox link would otherwise expand into its sign-in page's preview.
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  it("returns the message timestamp Slack assigned", async () => {
    stubFetch(jsonResponse({ ok: true, ts: "1700000000.000100" }));
    await expect(post()).resolves.toEqual({ messageTs: "1700000000.000100" });
  });

  it("throws on a non-2xx response, naming the status", async () => {
    stubFetch(jsonResponse({}, 500, "Internal Server Error"));
    await expect(post()).rejects.toThrow(SlackPostError);
    await expect(post()).rejects.toThrow("500");
  });

  it("throws on a 429, which Slack uses for rate limiting", async () => {
    stubFetch(jsonResponse({ ok: false, error: "ratelimited" }, 429, "Too Many Requests"));
    await expect(post()).rejects.toThrow("429");
  });

  it("throws when Slack answers 200 with ok:false, which is its normal error shape", async () => {
    stubFetch(jsonResponse({ ok: false, error: "channel_not_found" }));
    await expect(post()).rejects.toThrow("channel_not_found");
  });

  it("names the error unknown_error when Slack sends ok:false with no code", async () => {
    stubFetch(jsonResponse({ ok: false }));
    await expect(post()).rejects.toThrow("unknown_error");
  });

  it("throws when the body is not JSON at all", async () => {
    stubFetch(new Response("<html>gateway</html>", { status: 200, statusText: "OK" }));
    await expect(post()).rejects.toThrow(SlackPostError);
  });

  it("throws when Slack accepts the message but returns no timestamp", async () => {
    stubFetch(jsonResponse({ ok: true }));
    await expect(post()).rejects.toThrow("no timestamp");
  });

  it("passes the abort signal through to fetch, so the caller's timeout applies", async () => {
    const fetchSpy = stubFetch(jsonResponse({ ok: true, ts: "1.1" }));
    await post();

    const [, init] = fetchSpy.mock.calls[0] as unknown as FetchArgs;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("lets a rejected fetch surface, so the notifier can record it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND slack.com");
      }),
    );

    await expect(post()).rejects.toThrow("ENOTFOUND");
  });
});
