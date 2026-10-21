import Link from "next/link";
import { FileQuestion } from "lucide-react";

import { Logo } from "@/components/atoms/logo";

const HOME_PATH = "/admin";

export default function NotFound() {
  return (
    <div className="flex min-h-full items-center justify-center px-8 py-20">
      <div className="w-full max-w-120 rounded-[18px] border border-slate-200 bg-white px-9 py-11 text-center shadow-card">
        <div className="mb-7 flex justify-center">
          <Logo size={20} />
        </div>
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-100">
          <FileQuestion size={40} className="text-slate-500" aria-hidden />
        </div>
        <h1 className="mb-2.5 text-[26px] font-semibold tracking-[-0.02em] text-slate-900">
          Page not found
        </h1>
        <p className="mx-auto max-w-95 text-[15px] leading-relaxed text-slate-500">
          The page you asked for does not exist, or you no longer have access to it.
        </p>
        <Link
          href={HOME_PATH}
          className="mt-7 inline-flex h-8 items-center justify-center rounded-md bg-accent-9 px-4 text-[13px] font-medium text-white transition-colors hover:bg-accent-10"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
