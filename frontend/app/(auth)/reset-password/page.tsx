import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/organisms/reset-password-form";

export const metadata: Metadata = {
  title: "Set a new password · openHR",
};

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
