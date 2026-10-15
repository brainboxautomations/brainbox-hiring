"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/atoms/button";
import { Field, Input } from "@/components/atoms/input";
import { Logo } from "@/components/atoms/logo";
import { createSupabaseBrowserClient } from "@/configurations/supabase-browser-configuration";
import {
  forgotPasswordSchema,
  recoveryCodeSchema,
  type ForgotPasswordValues,
  type RecoveryCodeValues,
} from "@/schemas/login-schema";

function ErrorNote({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700"
    >
      {message}
    </div>
  );
}

/**
 * Sends the recovery email, then takes the code from it.
 *
 * The code is the fallback for when the email's link has been used up by a
 * mail scanner, or is opened on a different device.
 */
export function ForgotPasswordForm() {
  const router = useRouter();
  const [supabase] = useState(createSupabaseBrowserClient);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isEntering, startEntering] = useTransition();

  const emailForm = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });
  const codeForm = useForm<RecoveryCodeValues>({
    resolver: zodResolver(recoveryCodeSchema),
    defaultValues: { code: "" },
  });

  async function onSendEmail(values: ForgotPasswordValues) {
    setFormError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(values.email);
    // Supabase answers the same whether or not the address has an account, so
    // the page does too. Only a real failure (rate limit, outage) is shown.
    if (error) {
      setFormError(
        error.status === 429
          ? "Too many reset emails have been sent. Wait a few minutes and try again."
          : error.message,
      );
      return;
    }
    setSentTo(values.email);
  }

  async function onVerifyCode(values: RecoveryCodeValues) {
    if (!sentTo) return;
    setFormError(null);
    const { error } = await supabase.auth.verifyOtp({
      email: sentTo,
      token: values.code,
      type: "recovery",
    });
    if (error) {
      setFormError("That code is wrong or has expired.");
      return;
    }
    startEntering(() => {
      router.replace("/reset-password");
      router.refresh();
    });
  }

  return (
    <div className="w-full">
      <div className="mb-8">
        <Logo size={28} showTag />
        <h1 className="mt-7 text-2xl font-semibold text-slate-900">Reset your password</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          {sentTo
            ? "If that address has an account, we've sent it a reset link and a code. Open the link, or enter the code here."
            : "Enter your email and we'll send you a link to set a new password."}
        </p>
      </div>

      {sentTo ? (
        <form onSubmit={codeForm.handleSubmit(onVerifyCode)} noValidate className="space-y-4">
          <Field label="Code" htmlFor="code" error={codeForm.formState.errors.code?.message}>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              invalid={Boolean(codeForm.formState.errors.code)}
              {...codeForm.register("code")}
            />
          </Field>

          {formError && <ErrorNote message={formError} />}

          <Button
            type="submit"
            variant="primary"
            loading={codeForm.formState.isSubmitting || isEntering}
            className="w-full"
          >
            Verify code
          </Button>
        </form>
      ) : (
        <form onSubmit={emailForm.handleSubmit(onSendEmail)} noValidate className="space-y-4">
          <Field label="Email" htmlFor="email" error={emailForm.formState.errors.email?.message}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="name@company.com"
              invalid={Boolean(emailForm.formState.errors.email)}
              {...emailForm.register("email")}
            />
          </Field>

          {formError && <ErrorNote message={formError} />}

          <Button
            type="submit"
            variant="primary"
            loading={emailForm.formState.isSubmitting}
            className="w-full"
          >
            Send reset link
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-[13px] text-slate-500">
        <Link href="/admin" className="text-accent-9 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
