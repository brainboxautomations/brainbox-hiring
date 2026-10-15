"use client";

import Link from "next/link";

import { cn } from "@/utilities/cn";
import type { Candidate } from "@/types/api";
import { candidateHref, type CandidateNavigationContext } from "@/utilities/candidate-navigation";
import { Avatar } from "@/components/atoms/avatar";
import { Checkbox } from "@/components/atoms/checkbox";
import { StarIcon, CheckIcon, ClockIcon } from "@/components/atoms/icons";

const fullName = (c: Candidate): string => `${c.firstName} ${c.lastName ?? ""}`.trim();

// `now` is passed in rather than read here, so the label re-renders when the
// board's clock ticks instead of freezing at first render.
function timeInStage(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.floor((now - then) / 60_000));
  if (mins < 60) return `${mins}m in stage`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h in stage`;
  return `${Math.floor(hours / 24)}d in stage`;
}

type CandidateCardProps = {
  candidate: Candidate;

  navigationContext: CandidateNavigationContext;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onToggleStar: () => void;
  /** Current time, ticked by the board so elapsed labels stay honest. */
  now: number;
};

export function CandidateCard({
  candidate,
  navigationContext,
  selectMode,
  selected,
  onToggleSelect,
  onToggleStar,
  now,
}: CandidateCardProps) {
  const unseen = !candidate.seen;
  const starred = candidate.starred;
  const name = fullName(candidate);
  const subtitle = candidate.headline || candidate.email;

  return (
    <Link
      href={candidateHref(candidate.id, navigationContext)}
      draggable={false}
      className={cn(
        "group relative block select-none rounded-lg border bg-white px-2.75 py-2.5 shadow-card transition-shadow hover:shadow-popover",
        selected ? "border-transparent ring-[1.5px] ring-accent-9 bg-accent-2" : "border-slate-200",
      )}
    >
      {unseen && <span className="absolute left-0 top-2.5 h-6.5 w-0.75 rounded-r-sm bg-accent-9" />}
      <div className="flex items-start gap-2">
        {selectMode && (
          <span
            className="mt-px"
            onClick={(e) => {
              e.preventDefault();
              onToggleSelect();
            }}
          >
            <Checkbox checked={selected} size={16} aria-label={`Select ${name}`} />
          </span>
        )}
        <Avatar name={name} size={28} />
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "truncate text-[13px] leading-tight text-slate-900",
              unseen ? "font-semibold" : "font-medium",
            )}
          >
            {name}
          </div>
          <div className="truncate text-[11px] leading-tight text-slate-500">{subtitle}</div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onToggleStar();
          }}
          className="-mr-1 -mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm hover:bg-slate-100"
          aria-label={starred ? "Unstar" : "Star"}
        >
          <StarIcon
            size={14}
            filled={starred}
            className={starred ? "text-amber-600" : "text-slate-300"}
          />
        </button>
      </div>
      <div className="mt-2.25 flex items-center gap-1.75 border-t border-slate-100 pt-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.03em] text-slate-400">
          {timeInStage(candidate.stageEnteredAt, now)}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {candidate.questionnaire === "complete" && (
            <span className="inline-flex h-4.25 items-center gap-1 rounded-full bg-accent-3 px-1.5 text-[10px] font-medium text-accent-10">
              <CheckIcon size={10} />
              Quest.
            </span>
          )}
          {candidate.questionnaire === "pending" && (
            <span className="inline-flex h-4.25 items-center gap-1 rounded-full bg-slate-100 px-1.5 text-[10px] font-medium text-slate-500">
              <ClockIcon size={10} />
              Quest.
            </span>
          )}
        </span>
      </div>
    </Link>
  );
}
