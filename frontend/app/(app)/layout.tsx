import type { ReactNode } from "react";

import { TopNav } from "@/components/organisms/top-nav";
import { NavigationLoader } from "@/components/organisms/navigation-loader";

export default function AppShellLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <TopNav />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <NavigationLoader>{children}</NavigationLoader>
      </main>
    </div>
  );
}
