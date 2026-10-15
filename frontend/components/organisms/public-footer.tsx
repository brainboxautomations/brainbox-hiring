import { POWERED_BY_URL, websiteLabel, type CompanyIdentity } from "@/utilities/company-identity";

export function PublicFooter({ company }: { company: CompanyIdentity }) {
  return (
    <footer className="border-t border-slate-200">
      <div className="mx-auto flex max-w-270 flex-wrap items-center justify-between gap-3 px-10 py-7">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-slate-500">
          {company.name && <span>© {company.name}</span>}
          {company.websiteUrl && (
            <a
              href={company.websiteUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:text-slate-900"
            >
              {websiteLabel(company.websiteUrl)}
            </a>
          )}
        </div>
        <a
          href={POWERED_BY_URL}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-slate-400 hover:text-slate-600"
        >
          Powered by BrainBox
        </a>
      </div>
    </footer>
  );
}
