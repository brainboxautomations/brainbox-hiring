import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MarkdownContent } from "@/components/molecules/markdown-content";
import type { Position } from "@/types/api";
import { getPublicPositionBySlug } from "../_data";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

function locationLabel(p: Position): string {
  const first = p.locations[0];
  if (!first) return "Remote";
  return first.detail?.trim() || first.country;
}

function metaLine(p: Position): string {
  return [locationLabel(p), p.positionType, p.department].filter(Boolean).join(" · ");
}

function formatSalary(p: Position): string | null {
  if (p.salaryFrom == null && p.salaryTo == null) return null;
  const currency = p.salaryCurrency ? `${p.salaryCurrency} ` : "";
  const money = (n: number) => `${currency}${n.toLocaleString()}`;
  const range =
    p.salaryFrom != null && p.salaryTo != null
      ? `${money(p.salaryFrom)} – ${money(p.salaryTo)}`
      : money((p.salaryFrom ?? p.salaryTo) as number);
  return p.salaryPeriod ? `${range} / ${p.salaryPeriod}` : range;
}

function formatEducation(p: Position): string | null {
  if (!p.educationLevel || p.educationLevel === "No requirement") return null;
  return p.educationLevelRequired
    ? `${p.educationLevel} required`
    : `${p.educationLevel} preferred (not required)`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPublicPositionBySlug(slug);
  if (!result) return { title: "Role not found" };
  const { position } = result;
  return {
    title: position.title,
    description: metaLine(position),
  };
}

export default async function PositionDetailPage({ params }: Params) {
  const { slug } = await params;
  const result = await getPublicPositionBySlug(slug);
  if (!result) notFound();

  const { position } = result;
  const salary = formatSalary(position);
  const education = formatEducation(position);

  return (
    <div className="mx-auto max-w-180 px-8 pb-24 pt-10">
      <Link
        href="/careers"
        className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 transition-colors hover:text-slate-700"
      >
        <ChevronLeft size={14} aria-hidden />
        All openings
      </Link>

      <header className="mt-5 border-b border-slate-100 pb-7">
        <h1 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] text-slate-900">
          {position.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-500">
          <span>{metaLine(position)}</span>
          {position.remoteFlag && (
            <span className="rounded-[5px] bg-green-50 px-1.75 py-0.5 font-mono text-[11px] text-green-700">
              REMOTE
            </span>
          )}
        </div>
        {(salary || education) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {salary && (
              <div className="inline-flex items-center rounded-lg bg-slate-50 px-3 py-1.5 text-[13px] font-medium text-slate-700">
                {salary}
              </div>
            )}
            {education && (
              <div className="inline-flex items-center rounded-lg bg-slate-50 px-3 py-1.5 text-[13px] font-medium text-slate-700">
                {education}
              </div>
            )}
          </div>
        )}
        <Link
          href={`/careers/${position.slug}/apply`}
          className="press mt-6 inline-flex h-11 items-center gap-2 rounded-[10px] bg-slate-900 px-6 text-[15px] font-medium text-white transition-colors hover:bg-slate-800"
        >
          Apply for this role
          <ChevronRight size={15} aria-hidden />
        </Link>
      </header>

      <section className="pt-8">
        {position.description ? (
          <MarkdownContent content={position.description} />
        ) : (
          <p className="text-[15px] leading-relaxed text-slate-500">
            We&apos;ll share the full role details during the process. Hit{" "}
            <span className="font-medium text-slate-700">Apply for this role</span> to introduce
            yourself — we read every application.
          </p>
        )}
      </section>

      <div className="mt-10 border-t border-slate-100 pt-8">
        <Link
          href={`/careers/${position.slug}/apply`}
          className="press inline-flex h-11 items-center gap-2 rounded-[10px] bg-slate-900 px-6 text-[15px] font-medium text-white transition-colors hover:bg-slate-800"
        >
          Apply for this role
          <ChevronRight size={15} aria-hidden />
        </Link>
      </div>
    </div>
  );
}
