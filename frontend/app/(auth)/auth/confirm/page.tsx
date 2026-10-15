import { Suspense } from "react";
import type { Metadata } from "next";

import { ConfirmEmailLink } from "@/components/organisms/confirm-email-link";

export const metadata: Metadata = {
  title: "Continue · BrainBox ATS",
};

export default function ConfirmEmailPage() {
  return (
    <Suspense>
      <ConfirmEmailLink />
    </Suspense>
  );
}
