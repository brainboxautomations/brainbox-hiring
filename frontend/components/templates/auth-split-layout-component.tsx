import type { ReactNode } from "react";

type AuthSplitLayoutProps = Readonly<{
  children: ReactNode;
}>;

/** Sign-in and password pages: one card, centred on the page. */
export function AuthSplitLayout({ children }: AuthSplitLayoutProps) {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-zinc-100 p-4 sm:p-6">
      <div className="w-full max-w-110 rounded-xl border border-slate-200 bg-white p-7 shadow-sm sm:p-10">
        {children}
      </div>
    </main>
  );
}
