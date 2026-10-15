import type { ReactNode } from "react";

import { NavigationLoader } from "@/components/organisms/navigation-loader";
import { AuthSplitLayout } from "@/components/templates/auth-split-layout-component";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <AuthSplitLayout>
      <NavigationLoader pageLoader="bar">{children}</NavigationLoader>
    </AuthSplitLayout>
  );
}
