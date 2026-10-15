import type { Metadata } from "next";
import type { ReactNode } from "react";

import { companyEnv } from "@/configurations/env-configuration";
import { NavigationLoader } from "@/components/organisms/navigation-loader";
import { PublicFooter } from "@/components/organisms/public-footer";
import { PublicHeader } from "@/components/organisms/public-header";
import {
  careersDescription,
  careersTitle,
  companyIdentityFrom,
  publicTitleTemplate,
} from "@/utilities/company-identity";

export function generateMetadata(): Metadata {
  const { name } = companyIdentityFrom(companyEnv());
  return {
    title: { default: careersTitle(name), template: publicTitleTemplate(name) },
    description: careersDescription(name),
  };
}

export default function PublicShellLayout({ children }: { children: ReactNode }) {
  const company = companyIdentityFrom(companyEnv());

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <PublicHeader company={company} />
      {/* Candidates clicking "Apply" or a job card got no sign anything was
          happening while the next page loaded. */}
      <div className="min-h-0 flex-1">
        <NavigationLoader pageLoader="bar">{children}</NavigationLoader>
      </div>
      <PublicFooter company={company} />
    </div>
  );
}
