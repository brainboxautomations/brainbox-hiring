import { Suspense } from "react";
import type { Metadata } from "next";

import { LoginForm } from "@/components/organisms/login-form";

export const metadata: Metadata = {
  title: "Sign in · openHR",
};

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
