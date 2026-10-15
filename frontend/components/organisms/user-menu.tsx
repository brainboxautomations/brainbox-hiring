"use client";

import { useRef, useState } from "react";
import Link from "next/link";

import { Avatar } from "@/components/atoms/avatar";
import { useAuth } from "@/providers/auth-provider";
import { FloatingMenu } from "@/components/molecules/floating-menu";
import { useProgressWhile } from "@/hooks/use-progress";

const menu = [{ label: "Settings", href: "/settings" }];

export function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  // Signing out talks to the auth server and then loads the login page. The
  // menu used to close at once and leave nothing on screen for that wait, so
  // it stays open showing progress until the redirect replaces the page.
  const [signingOut, setSigningOut] = useState(false);
  useProgressWhile(signingOut);

  const email = user?.email ?? "";
  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ?? email.split("@")[0] ?? "Account";

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent-9/40"
      >
        <Avatar name={displayName} color="accent" size={28} />
      </button>
      <FloatingMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} align="end">
        {/* Sized to the address rather than fixed: a long work email ran past a
            fixed-width menu and was clipped at its edge. Past the cap it
            truncates, with the full value on hover. */}
        <div className="w-max min-w-52 max-w-80 rounded-xl border border-slate-200 bg-white p-1.5 shadow-modal">
          <div className="mb-1.5 border-b border-slate-100 px-2.5 pb-2.5 pt-2">
            <div className="truncate text-[13px] font-semibold text-slate-900" title={displayName}>
              {displayName}
            </div>
            <div className="truncate text-[11px] text-slate-400" title={email}>
              {email}
            </div>
          </div>
          {menu.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-slate-700 hover:bg-slate-100"
            >
              {m.label}
            </Link>
          ))}
          <button
            type="button"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void signOut();
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-red-700 hover:bg-slate-100 disabled:cursor-default disabled:opacity-70"
          >
            {signingOut && (
              <span className="inline-block h-3 w-3 animate-[ds-spin_0.7s_linear_infinite] rounded-full border-2 border-current/30 border-t-current" />
            )}
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </FloatingMenu>
    </div>
  );
}
