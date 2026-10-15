"use client";

import Link from "next/link";

import {
  candidateHref,
  type CandidateNavigationContext,
  type CandidateNeighbours,
} from "@/utilities/candidate-navigation";
import { ChevronDownIcon, ChevronRightIcon } from "@/components/atoms/icons";

export type CandidateNavigatorProps = {
  context: CandidateNavigationContext | null;
  neighbours: CandidateNeighbours;
};

const stepClass =
  "flex h-7 w-7.5 items-center justify-center text-slate-500 hover:bg-slate-100 aria-disabled:pointer-events-none aria-disabled:opacity-40";

function Step({
  applicationId,
  context,
  label,
  children,
}: {
  applicationId: string | null;
  context: CandidateNavigationContext;
  label: string;
  children: React.ReactNode;
}) {
  if (!applicationId) {
    return (
      <span role="link" aria-disabled="true" aria-label={label} className={stepClass}>
        {children}
      </span>
    );
  }

  return (
    <Link href={candidateHref(applicationId, context)} aria-label={label} className={stepClass}>
      {children}
    </Link>
  );
}

export function CandidateNavigator({ context, neighbours }: CandidateNavigatorProps) {
  if (!context) return null;

  return (
    <div className="flex items-center overflow-hidden rounded-md border border-slate-200">
      <Step applicationId={neighbours.previousId} context={context} label="Previous candidate">
        <ChevronDownIcon size={14} className="rotate-90" />
      </Step>
      <span className="h-4 w-px bg-slate-200" />
      <Step applicationId={neighbours.nextId} context={context} label="Next candidate">
        <ChevronRightIcon size={14} />
      </Step>
    </div>
  );
}
