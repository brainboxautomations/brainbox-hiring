"use client";

import { useEffect, useRef, useState } from "react";

import { env } from "@/configurations/env-configuration";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () =>
        window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile missing"));
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error("Turnstile failed to load"));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

/** True when the captcha is configured, so forms know a token is required. */
export const CAPTCHA_ENABLED = Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

type TurnstileWidgetProps = {
  /** Called with a fresh token, or null when it expires or fails. */
  onToken: (token: string | null) => void;
  /** Change this to get a new token; a token is used up by one submission. */
  resetSignal: number;
};

/**
 * Cloudflare Turnstile on the public forms: a small box that usually passes on
 * its own and asks for a click only when Cloudflare wants more signal. It stays
 * visible, so a check that cannot run says so instead of leaving the candidate
 * with a "complete the security check" message and nothing to complete.
 * Renders nothing while no site key is configured.
 */
export function TurnstileWidget({ onToken, resetSignal }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useEffect(() => {
    if (!CAPTCHA_ENABLED || !containerRef.current) return;
    const container = containerRef.current;
    let cancelled = false;

    loadTurnstile()
      .then((turnstile) => {
        if (cancelled) return;
        widgetIdRef.current = turnstile.render(container, {
          sitekey: env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
          callback: (token) => {
            setFailed(false);
            onTokenRef.current(token);
          },
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => {
            setFailed(true);
            onTokenRef.current(null);
          },
        });
      })
      .catch(() => {
        setFailed(true);
        onTokenRef.current(null);
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (resetSignal === 0 || !widgetIdRef.current) return;
    onTokenRef.current(null);
    window.turnstile?.reset(widgetIdRef.current);
  }, [resetSignal]);

  if (!CAPTCHA_ENABLED) return null;
  return (
    <div>
      <div ref={containerRef} />
      {failed && (
        <p className="mt-2 text-[13px] text-red-700">
          The security check couldn&apos;t load. Refresh the page and try again.
        </p>
      )}
    </div>
  );
}
