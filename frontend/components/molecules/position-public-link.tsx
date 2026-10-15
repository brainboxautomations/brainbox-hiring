"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { CheckIcon, ExternalLinkIcon, LinkIcon } from "@/components/atoms/icons";
import type { PositionStatus, PublishMode } from "@/types/api";

type PositionPublicLinkProps = {
  slug: string;
  status: PositionStatus;
  publishMode: PublishMode;
};

/**
 * The position's public URL, shown where staff can actually copy it.
 *
 * "Unlisted" promises a role is "reachable by direct link only" and the app
 * then never showed that link anywhere, so the only way to share one was to
 * guess `/careers/<title-slug>` by hand. That guess silently fails twice over:
 * a duplicate title gets `-2` appended at creation, and renaming a position
 * never updates its slug, so the name it is guessed from stops matching.
 *
 * Built relative to the current origin rather than COMPANY_CAREERS_URL, which
 * is server-only — the careers pages are routes of this same app, so the origin
 * is already correct.
 */
export function PositionPublicLink({ slug, status, publishMode }: PositionPublicLinkProps) {
  const [copied, setCopied] = useState(false);

  // The origin only exists in the browser. `useSyncExternalStore` renders the
  // server snapshot ("") on the server and the real value on the client, with
  // no effect and no cascading render — the origin never changes, so the
  // subscribe callback has nothing to listen to.
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const path = `/careers/${slug}`;
  const url = origin ? `${origin}${path}` : path;

  // A disabled position 404s and a draft was never published, so there is no
  // link to offer. Closed positions 404 too, but staff often want the old URL
  // for reference, so the card stays and says why it will not open.
  if (publishMode === "disabled" || status === "draft") return null;

  const live = status === "open";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access can be refused (permissions, an insecure origin).
      // The URL is on screen and selectable, so the copy button failing is an
      // inconvenience, not a dead end.
      setCopied(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <LinkIcon size={13} className="text-slate-500" />
        <span className="text-xs font-medium text-slate-700">
          {publishMode === "unlisted" ? "Direct link" : "Public link"}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[12px] text-slate-700">
          {url}
        </code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-[12px] font-medium text-white transition-colors hover:bg-slate-800"
        >
          {copied ? <CheckIcon size={13} /> : <LinkIcon size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
        {live && (
          <a
            href={path}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <ExternalLinkIcon size={13} />
            Open
          </a>
        )}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        {!live
          ? "This position is not open, so the link returns a not-found page until it is reopened."
          : publishMode === "unlisted"
            ? "Not listed on the careers page. Anyone with this link can view and apply, so share it deliberately."
            : "Listed on the public careers page, and reachable directly at this link."}
      </p>
    </div>
  );
}
