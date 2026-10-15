"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";

import { Button } from "@/components/atoms/button";
import { Logo } from "@/components/atoms/logo";
import { createSupabaseBrowserClient } from "@/configurations/supabase-browser-configuration";
import { safeNextPath } from "@/utilities/safe-next-path";

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
  "recovery",
  "invite",
  "magiclink",
  "signup",
  "email",
  "email_change",
];

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return EMAIL_OTP_TYPES.includes(value as EmailOtpType);
}

/**
 * Where links in Supabase auth emails land (password recovery, invites).
 *
 * The token is only used when the person presses Continue. Mail scanners such
 * as Microsoft Safe Links open every link in an email before it is read, and a
 * link that verified on load was used up by the scanner, leaving the person
 * with "link expired". This is the workaround Supabase documents for it.
 */
export function ConfirmEmailLink() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [supabase] = useState(createSupabaseBrowserClient);
  const [failed, setFailed] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isEntering, startEntering] = useTransition();

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNextPath(searchParams.get("next"));
  const usable = Boolean(tokenHash) && isEmailOtpType(type);

  async function onContinue() {
    if (!tokenHash || !isEmailOtpType(type)) return;
    setIsVerifying(true);
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    setIsVerifying(false);
    if (error) {
      setFailed(true);
      return;
    }
    startEntering(() => {
      router.replace(next);
      router.refresh();
    });
  }

  const recovery = type === "recovery";

  return (
    <div className="w-full">
      <div className="mb-8">
        <Logo size={28} showTag />
        <h1 className="mt-7 text-2xl font-semibold text-slate-900">
          {recovery ? "Reset your password" : "Confirm your email"}
        </h1>
      </div>

      {usable && !failed ? (
        <>
          <p className="mb-5 text-[13px] text-slate-500">
            {recovery
              ? "Press continue to choose a new password."
              : "Press continue to finish signing in."}
          </p>
          <Button
            type="button"
            variant="primary"
            loading={isVerifying || isEntering}
            onClick={onContinue}
            className="w-full"
          >
            Continue
          </Button>
        </>
      ) : (
        <div
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800"
        >
          That link has expired or was already used. Request a new one, or use the code from the
          email.
        </div>
      )}

      <p className="mt-6 text-center text-[13px] text-slate-500">
        <Link href="/forgot-password" className="text-accent-9 hover:underline">
          Request a new link
        </Link>
      </p>
    </div>
  );
}
