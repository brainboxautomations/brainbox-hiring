"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/atoms/button";
import { Field, Input } from "@/components/atoms/input";
import { Logo } from "@/components/atoms/logo";
import { createSupabaseBrowserClient } from "@/configurations/supabase-browser-configuration";
import { resetPasswordSchema, type ResetPasswordValues } from "@/schemas/login-schema";

/** Reached signed in, through the link in a recovery email (see /auth/confirm). */
export function ResetPasswordForm() {
  const router = useRouter();
  const [supabase] = useState(createSupabaseBrowserClient);
  const [formError, setFormError] = useState<string | null>(null);
  const [isEntering, startEntering] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirm: "" },
  });

  async function onSubmit(values: ResetPasswordValues) {
    setFormError(null);
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      setFormError(error.message);
      return;
    }
    startEntering(() => {
      router.replace("/positions");
      router.refresh();
    });
  }

  return (
    <div className="w-full">
      <div className="mb-8">
        <Logo size={28} showTag />
        <h1 className="mt-7 text-2xl font-semibold text-slate-900">Set a new password</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Choose a password you don&apos;t use anywhere else.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <Field label="New password" htmlFor="password" error={errors.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            invalid={Boolean(errors.password)}
            {...register("password")}
          />
        </Field>

        <Field label="Confirm new password" htmlFor="confirm" error={errors.confirm?.message}>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            invalid={Boolean(errors.confirm)}
            {...register("confirm")}
          />
        </Field>

        {formError && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700"
          >
            {formError}
          </div>
        )}

        <Button
          type="submit"
          variant="primary"
          loading={isSubmitting || isEntering}
          className="w-full"
        >
          Save password
        </Button>
      </form>
    </div>
  );
}
