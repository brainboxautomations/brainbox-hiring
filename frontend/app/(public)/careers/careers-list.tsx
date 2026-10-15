"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Briefcase, ChevronRight, MapPin } from "lucide-react";

import { cn } from "@/utilities/cn";
import type { PositionListItem } from "@/types/api";
import { SearchIcon } from "@/components/atoms/icons";

function locationLabel(p: PositionListItem): string {
  const first = p.locations[0];
  if (!first) return "Remote";
  return first.detail?.trim() || first.country;
}

function PinIcon({ size = 13 }: { size?: number }) {
  return <MapPin size={size} aria-hidden />;
}

function BriefcaseIcon({ size = 13 }: { size?: number }) {
  return <Briefcase size={size} aria-hidden />;
}

function ArrowIcon({ size = 14 }: { size?: number }) {
  return <ChevronRight size={size} aria-hidden />;
}

export function CareersList({
  positions,
  companyName,
  contactEmail,
}: {
  positions: PositionListItem[];
  companyName: string;
  contactEmail: string;
}) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("All");

  const departments = useMemo(
    () => [
      "All",
      ...Array.from(
        new Set(positions.map((p) => p.department).filter((d): d is string => Boolean(d))),
      ),
    ],
    [positions],
  );

  const roles = useMemo(() => {
    return positions.filter((r) => {
      if (department !== "All" && r.department !== department) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        if (
          !r.title.toLowerCase().includes(q) &&
          !locationLabel(r).toLowerCase().includes(q) &&
          !(r.department ?? "").toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [positions, query, department]);

  return (
    <>
      <section className="mx-auto max-w-270 px-10 pb-14 pt-18 text-center">
        <div className="mb-5.5 inline-flex h-7 items-center gap-1.75 rounded-full border border-accent-4 bg-accent-2 px-3 text-xs font-medium text-accent-11">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-9" />
          We&apos;re hiring
        </div>
        <h1 className="mx-auto mb-4 max-w-160 text-[46px] font-semibold leading-[1.08] tracking-[-0.03em] text-slate-900">
          {companyName ? `Join ${companyName}` : "Join our team"}
        </h1>
        <p className="mx-auto max-w-135 text-[17px] leading-relaxed text-slate-500">
          Find a role that fits and apply in a few minutes.
        </p>
        <div className="mt-7.5 flex items-center justify-center gap-6">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span className="text-slate-400">
              <BriefcaseIcon size={16} />
            </span>
            {positions.length} open {positions.length === 1 ? "role" : "roles"}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-195 px-10 pb-24">
        <div className="mb-4.5 flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-[-0.015em] text-slate-900">Our openings</h2>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-full min-w-0 items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-3 sm:w-70">
            <SearchIcon size={15} className="shrink-0 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search roles…"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {departments.map((d) => {
              const active = department === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDepartment(d)}
                  className={cn(
                    "inline-flex h-9 items-center rounded-full px-3.25 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 bg-white text-slate-600 hover:border-accent-4 hover:text-slate-900",
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>

        {roles.length > 0 ? (
          <div className="flex flex-col gap-3">
            {roles.map((role) => (
              <Link
                key={role.id}
                href={`/careers/${role.slug}`}
                className="group flex items-center gap-4.5 rounded-[14px] border border-slate-200 px-5.5 py-5 transition-all hover:border-accent-4 hover:shadow-[0_4px_16px_rgba(61,99,221,0.07)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-base font-semibold tracking-[-0.01em] text-slate-900">
                    {role.title}
                  </div>
                  <div className="mt-1.75 flex flex-wrap items-center gap-x-3.5 gap-y-2">
                    <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-500">
                      <span className="text-slate-400">
                        <PinIcon />
                      </span>
                      {locationLabel(role)}
                    </span>
                    {role.positionType && (
                      <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-500">
                        <span className="text-slate-400">
                          <BriefcaseIcon />
                        </span>
                        {role.positionType}
                      </span>
                    )}
                    {role.department && (
                      <span className="text-[13px] text-slate-400">{role.department}</span>
                    )}
                    {role.remoteFlag && (
                      <span className="rounded-[5px] bg-green-50 px-1.75 py-0.5 font-mono text-[11px] text-green-700">
                        REMOTE
                      </span>
                    )}
                  </div>
                </div>
                <span className="press inline-flex h-9.5 shrink-0 items-center gap-1.5 rounded-[9px] bg-slate-900 px-4 text-sm font-medium text-white transition-colors group-hover:bg-slate-800">
                  View role
                  <ArrowIcon />
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center rounded-2xl border border-slate-200 px-6 py-18 text-center">
            <div className="mb-4.5 flex h-12 w-12 items-center justify-center rounded-[13px] bg-slate-100 text-slate-400">
              <Briefcase size={22} aria-hidden />
            </div>
            <div className="mb-1.5 text-[17px] font-semibold text-slate-900">
              {positions.length === 0 ? "No open roles right now" : "No roles match your search"}
            </div>
            <div className="max-w-95 text-sm leading-relaxed text-slate-500">
              We&apos;re not actively hiring, but we&apos;re always glad to hear from great people.
              {contactEmail && (
                <>
                  {" "}
                  Drop us a note at{" "}
                  <a href={`mailto:${contactEmail}`} className="text-accent-9 hover:underline">
                    {contactEmail}
                  </a>
                  .
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
