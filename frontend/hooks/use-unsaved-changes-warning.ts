import { useEffect } from "react";

/**
 * Warns before unsaved work is thrown away.
 *
 * Editors here keep their draft in React state, so anything that unmounts them
 * discards it silently: a click on the top nav, a browser back, a reload. An
 * email template someone had spent ten minutes on was gone with no prompt and
 * no way back.
 *
 * Covers the three ways out of a page:
 *
 *  - Leaving the site (reload, close, external link) via `beforeunload`, which
 *    shows the browser's own confirm. Its wording cannot be customised.
 *  - In-app navigation, by intercepting clicks on links while the work is
 *    dirty. Next's client router gives no route-change guard hook, so the click
 *    is caught during capture, before the router sees it.
 *  - The browser's Back button. In a client-rendered app that does not unload
 *    the page, so `beforeunload` never fires and there is no click to catch.
 *    While dirty, a duplicate history entry for the current page is pushed;
 *    Back lands on the real one (same URL, so nothing unmounts) and the
 *    popstate that follows is where the user is asked.
 */

/** Marks the extra history entry, so it is pushed once and removed on clean. */
const GUARD_KEY = "__unsavedChangesGuard";

function pushGuardEntry(): void {
  // Carry the router's own state across, so Next treats this entry as one of
  // its own if the user ever returns to it with Forward.
  window.history.pushState(
    { ...window.history.state, [GUARD_KEY]: true },
    "",
    window.location.href,
  );
}
export function useUnsavedChangesWarning(dirty: boolean, message: string): void {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Set for older browsers; modern ones show their own wording regardless.
      event.returnValue = "";
    };

    const onClickCapture = (event: MouseEvent) => {
      // Let the browser handle anything that was not a plain left click, so
      // open-in-new-tab and the like are never intercepted — they leave this
      // page alive anyway.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as HTMLElement | null)?.closest("a");
      const href = anchor?.getAttribute("href");
      if (!anchor || !href || anchor.target === "_blank") return;

      // Same-page anchors and downloads do not unmount anything.
      if (href.startsWith("#") || anchor.hasAttribute("download")) return;

      const destination = new URL(href, window.location.href);
      if (destination.href === window.location.href) return;

      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    // The page being protected. Only a history step back onto its real entry
    // (same URL, no guard mark) is the user pressing Back. Anything else is
    // not: a `#section` jump also fires popstate, and returning to the guard
    // entry with Forward is just the user coming back.
    const guardedHref = window.location.href;
    if (!window.history.state?.[GUARD_KEY]) pushGuardEntry();

    // Set once the user agrees to leave, so the Back issued on their behalf is
    // not treated as another attempt to leave.
    let leaving = false;
    const onPopState = () => {
      if (leaving) return;
      if (window.location.href !== guardedHref || window.history.state?.[GUARD_KEY]) return;
      if (window.confirm(message)) {
        leaving = true;
        // The user's Back only removed the guard entry; this one leaves.
        window.history.back();
      } else {
        pushGuardEntry();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClickCapture, true);
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("popstate", onPopState);

      // Saved or discarded in place: drop the guard entry, so the next Back
      // press leaves the page instead of landing on a copy of it. After a real
      // navigation the current entry is the new page's, and is left alone.
      if (!leaving && window.history.state?.[GUARD_KEY]) window.history.back();
    };
  }, [dirty, message]);
}
