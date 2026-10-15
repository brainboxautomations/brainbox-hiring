"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useIsMutating } from "@tanstack/react-query";

import { BrandLoader } from "@/components/atoms/brand-loader";
import { TopProgressBar } from "@/components/atoms/top-progress-bar";
import { useProgressActive } from "@/hooks/use-progress";

type NavKind = "page" | "inline";

/**
 * `brand` covers a page change with the full-screen Brainbox loader, which
 * suits the staff app. `bar` uses only the thin top progress bar: on the
 * careers site and the login screen an internal "Brainbox ATS" splash over
 * the page would be out of place, but a click still needs visible feedback.
 */
type PageLoader = "brand" | "bar";

export function NavigationLoader({
  children,
  pageLoader = "brand",
}: {
  children: React.ReactNode;
  pageLoader?: PageLoader;
}) {
  return (
    <>
      {children}
      <Suspense fallback={null}>
        <NavigationIndicator pageLoader={pageLoader} />
      </Suspense>
    </>
  );
}

function NavigationIndicator({ pageLoader }: { pageLoader: PageLoader }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const url = `${pathname}?${searchParams.toString()}`;

  // Any save in flight runs the top bar too. Many small controls (a star, a
  // reorder arrow, a toggle, a status item in a menu that closes on click)
  // save in the background with no spinner of their own, so without this a
  // click on them showed nothing at all.
  const saving = useIsMutating() > 0;
  const busy = useProgressActive() || saving;

  const [pending, setPending] = useState<NavKind | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [seenUrl, setSeenUrl] = useState(url);
  const [wasBusy, setWasBusy] = useState(busy);

  if (seenUrl !== url) {
    setSeenUrl(url);
    if (pending) {
      setFinishing(pending === "inline");
      setPending(null);
    }
  }

  if (wasBusy !== busy) {
    setWasBusy(busy);
    if (!busy) setFinishing(true);
  }

  useEffect(() => {
    if (!finishing) return;
    const t = setTimeout(() => setFinishing(false), 320);
    return () => clearTimeout(t);
  }, [finishing]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const target = e.target as Element;
      const a = target.closest<HTMLAnchorElement>("a[href]");
      if (!a) return;
      const control = target.closest(
        "button, [role='button'], input, select, textarea, [contenteditable='true']",
      );
      if (control && control !== a && a.contains(control)) return;
      if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const href = a.getAttribute("href") ?? "";
      if (!href || /^(https?:\/\/|\/\/|#|mailto:|tel:)/.test(href)) return;

      const dest = new URL(href, window.location.href);
      const samePath = dest.pathname === window.location.pathname;
      if (samePath && dest.search === window.location.search) return;

      setPending(samePath ? "inline" : "page");
    }

    function onSubmit(e: SubmitEvent) {
      const form = e.target as HTMLFormElement;
      const method = form.getAttribute("method")?.toLowerCase();
      const action = form.getAttribute("action") ?? "";
      if (method !== "get" || !action.startsWith("/")) return;
      setPending("inline");
    }

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), 8000);
    return () => clearTimeout(t);
  }, [pending]);

  const showBrand = pending === "page" && pageLoader === "brand";
  const showBar = pending === "inline" || (pending === "page" && pageLoader === "bar");

  return (
    <>
      {showBar || busy || finishing ? (
        <TopProgressBar done={finishing && !pending && !busy} />
      ) : null}
      {showBrand ? <BrandLoader /> : null}
    </>
  );
}
