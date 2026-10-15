import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { careersTitle, websiteLabel, type CompanyIdentity } from "@/utilities/company-identity";

export function PublicHeader({ company }: { company: CompanyIdentity }) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-100 bg-white">
      <div className="mx-auto flex h-16 max-w-270 items-center justify-between gap-4 px-10">
        <Link href="/careers" aria-label={`${careersTitle(company.name)}, home`}>
          {company.logoUrl ? (
            <Image
              src={company.logoUrl}
              alt={company.name}
              width={160}
              height={32}
              unoptimized
              className="h-8 w-auto max-w-40 object-contain object-left"
            />
          ) : (
            <span className="text-[17px] font-semibold tracking-[-0.015em] text-slate-900">
              {company.name || "Careers"}
            </span>
          )}
        </Link>
        {company.websiteUrl && (
          <a
            href={company.websiteUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-accent-9 hover:underline"
          >
            {websiteLabel(company.websiteUrl)}
            <ArrowUpRight size={12} aria-hidden="true" />
          </a>
        )}
      </div>
    </header>
  );
}
