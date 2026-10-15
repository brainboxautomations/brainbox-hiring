"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/atoms/button";
import { Field, Input, Label } from "@/components/atoms/input";
import { Logo } from "@/components/atoms/logo";
import { createSupabaseBrowserClient } from "@/configurations/supabase-browser-configuration";
import { loginSchema, type LoginValues } from "@/schemas/login-schema";
import { safeNextPath } from "@/utilities/safe-next-path";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [supabase] = useState(createSupabaseBrowserClient);
  const [formError, setFormError] = useState<string | null>(null);
  // Signing in is only half the wait: the button used to stop spinning the
  // moment the password was accepted, then sat idle while the first page
  // loaded, so it looked like the click had not registered.
  const [isEntering, startEntering] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginValues) {
    setFormError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });

    if (error) {
      setFormError(error.message);
      return;
    }

    const destination = safeNextPath(searchParams.get("next"));

    startEntering(() => {
      router.replace(destination);
      router.refresh();
    });
  }

  return (
    <div className="w-full">
      <div className="mb-8">
        <Logo size={28} showTag />
        <h1 className="mt-7 text-2xl font-semibold text-slate-900">Sign in</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Welcome back. Enter your credentials to continue.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="name@company.com"
            invalid={Boolean(errors.email)}
            {...register("email")}
          />
        </Field>

        <div>
          <div className="flex items-baseline justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="text-[12px] text-accent-9 hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            invalid={Boolean(errors.password)}
            {...register("password")}
          />
          {errors.password?.message && (
            <p className="mt-1.5 text-[11px] text-red-700">{errors.password.message}</p>
          )}
        </div>

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
          Sign in
        </Button>
      </form>
    </div>
  );
}
