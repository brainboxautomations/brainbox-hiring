"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useProgressWhile } from "@/hooks/use-progress";

/**
 * Navigate from code, with feedback until the next page is on screen.
 *
 * A button that called `router.push` gave no sign it had been pressed: the
 * page-loading indicator only watches link clicks, and the next page can take
 * a few seconds to arrive. People clicked again, or assumed the tap missed.
 *
 * Running the navigation inside a transition keeps `isNavigating` true until
 * the new route has rendered, so a button can show its spinner for exactly as
 * long as the wait lasts, and the top progress bar runs alongside it.
 */
export function useNavigate() {
  const router = useRouter();
  const [isNavigating, startTransition] = useTransition();
  useProgressWhile(isNavigating);

  const push = useCallback((href: string) => startTransition(() => router.push(href)), [router]);
  const replace = useCallback(
    (href: string) => startTransition(() => router.replace(href)),
    [router],
  );

  return { push, replace, isNavigating };
}
