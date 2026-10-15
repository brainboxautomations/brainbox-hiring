"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";

import { cn } from "@/utilities/cn";
import { useNavigate } from "@/hooks/use-navigate";
import { usePositions, useSetPositionStatus } from "@/hooks/use-positions";
import type { PositionListItem, PositionStatus } from "@/types/api";
import { Button } from "@/components/atoms/button";
import { PlusIcon, SearchIcon, DotsIcon } from "@/components/atoms/icons";
import { FloatingMenu } from "@/components/molecules/floating-menu";
import { PositionStatusBadge } from "@/components/molecules/position-status-badge";
import { PositionsTableSkeleton } from "@/components/molecules/positions-table-skeleton";
import { POSITION_STATUS_LABEL, POSITION_STATUS_TRANSITIONS } from "@/utilities/position-status";
import { Briefcase } from "lucide-react";

const iconTints = [
  "bg-accent-3 text-accent-10",
  "bg-violet-100 text-violet-700",
  "bg-green-100 text-green-700",
  "bg-amber-100 text-amber-700",
];

type StatusTab = "all" | PositionStatus;

const statusTabs: { id: StatusTab; label: string }[] = [
  { id: "all", label: "All" },
  ...(Object.keys(POSITION_STATUS_LABEL) as PositionStatus[]).map((status) => ({
    id: status as StatusTab,
    label: POSITION_STATUS_LABEL[status],
  })),
];

function locationLabel(p: PositionListItem): string {
  const first = p.locations[0];
  if (!first) return "—";
  return first.detail?.trim() || first.country;
}

function formatCreated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

function BriefcaseIcon() {
  return <Briefcase size={15} aria-hidden="true" />;
}

export default function PositionsPage() {
  const { push, isNavigating } = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusTab>("all");

  const { data: positions, isLoading, isError, error, refetch, isFetching } = usePositions();
  const all = useMemo(() => positions ?? [], [positions]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length };
    (Object.keys(POSITION_STATUS_LABEL) as PositionStatus[]).forEach((k) => {
      c[k] = all.filter((p) => p.status === k).length;
    });
    return c;
  }, [all]);

  const openCount = counts.open ?? 0;

  const rows = useMemo(() => {
    return all.filter((p) => {
      if (status !== "all" && p.status !== status) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!p.title.toLowerCase().includes(q) && !(p.department ?? "").toLowerCase().includes(q))
          return false;
      }
      return true;
    });
  }, [all, search, status]);

  const isEmpty = !isLoading && !isError && all.length === 0;

  return (
    <div className="mx-auto max-w-275 px-8 pb-16 pt-7">
      <div className="mb-5.5 flex items-end justify-between gap-5">
        <div>
          <h1 className="mb-1 text-2xl font-semibold tracking-[-0.02em]">Positions</h1>
          <p className="text-[13px] text-slate-500">
            {all.length} positions · {openCount} open
          </p>
        </div>
        <Button
          variant="primary"
          leadingIcon={<PlusIcon size={14} />}
          className="h-8.5 rounded-lg"
          loading={isNavigating}
          onClick={() => push("/positions/new")}
        >
          Create position
        </Button>
      </div>

      <div className="mb-3.5 flex items-center gap-2.5">
        <div className="flex h-8.5 w-65 items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.75">
          <SearchIcon size={14} className="shrink-0 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search positions…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-900 placeholder:text-slate-400 outline-none"
          />
        </div>
        <div className="ml-1 flex items-center gap-1">
          {statusTabs.map((t) => {
            const active = status === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setStatus(t.id)}
                className={cn(
                  "inline-flex h-7.5 items-center gap-1.75 rounded-full px-2.75 text-xs font-medium transition-colors",
                  active
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                {t.label}
                <span className="font-mono text-[11px] text-slate-400">{counts[t.id] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="grid h-9.5 grid-cols-[2.4fr_1.2fr_1.4fr_1fr_90px_100px_44px] items-center border-b border-slate-200 bg-slate-50 px-4 font-mono text-[10px] uppercase tracking-[0.06em] text-slate-500">
          <div>Position</div>
          <div>Department</div>
          <div>Location</div>
          <div>Status</div>
          <div className="pr-4 text-right">Candidates</div>
          <div className="pl-1">Created</div>
          <div />
        </div>

        {isLoading && <PositionsTableSkeleton />}

        {isError && (
          <div className="flex flex-col items-center px-5 py-16 text-center">
            <div className="mb-1 text-[15px] font-semibold text-red-800">
              Couldn’t load positions
            </div>
            <div className="mb-4.5 max-w-85 text-[13px] leading-relaxed text-red-700">
              {error instanceof Error ? error.message : "Something went wrong."}
            </div>
            <Button
              variant="secondary"
              className="h-8.5 rounded-lg"
              loading={isFetching}
              onClick={() => refetch()}
            >
              Try again
            </Button>
          </div>
        )}

        {isEmpty && (
          <div className="flex flex-col items-center px-5 py-16 text-center">
            <div className="mb-4 flex h-11.5 w-11.5 items-center justify-center rounded-xl bg-accent-3 text-accent-9">
              <BriefcaseIcon />
            </div>
            <div className="mb-1 text-[15px] font-semibold">No positions yet</div>
            <div className="mb-4.5 max-w-85 text-[13px] leading-relaxed text-slate-500">
              Create your first position to start collecting applications through the careers site.
            </div>
            <Button
              variant="primary"
              leadingIcon={<PlusIcon size={14} />}
              className="h-8.5 rounded-lg"
              loading={isNavigating}
              onClick={() => push("/positions/new")}
            >
              Create position
            </Button>
          </div>
        )}

        {!isLoading &&
          !isError &&
          !isEmpty &&
          (rows.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-slate-400">
              No positions match your filters.
            </div>
          ) : (
            rows.map((p, i) => (
              <PositionRow key={p.id} position={p} tint={iconTints[i % iconTints.length]!} />
            ))
          ))}
      </div>
    </div>
  );
}

function PositionRow({ position, tint }: { position: PositionListItem; tint: string }) {
  return (
    <Link
      href={`/positions/${position.id}/board`}
      className="grid min-h-14 cursor-pointer grid-cols-[2.4fr_1.2fr_1.4fr_1fr_90px_100px_44px] items-center border-b border-slate-100 px-4 py-2 transition-colors last:border-b-0 hover:bg-slate-50"
    >
      <div className="flex min-w-0 items-center gap-2.75">
        <div
          className={cn("flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg", tint)}
        >
          <BriefcaseIcon />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-slate-900">{position.title}</div>
          <div className="mt-px text-[11px] text-slate-400">{position.positionType ?? "—"}</div>
        </div>
      </div>
      <div className="text-xs text-slate-600">{position.department ?? "—"}</div>
      <div className="flex items-center gap-1.5 text-xs text-slate-600">
        {locationLabel(position)}
        {position.remoteFlag && (
          <span className="rounded-sm bg-green-50 px-1.25 py-px font-mono text-[10px] text-green-700">
            REMOTE
          </span>
        )}
      </div>
      <div>
        <PositionStatusBadge status={position.status} />
      </div>
      <div className="pr-4 text-right font-mono text-[13px] font-medium text-slate-700">
        {position.candidateCount}
      </div>
      <div className="pl-1 font-mono text-[11px] text-slate-400">
        {formatCreated(position.createdAt)}
      </div>
      <div className="flex justify-end">
        <RowMenu position={position} />
      </div>
    </Link>
  );
}

function RowMenu({ position }: { position: PositionListItem }) {
  const { push } = useNavigate();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const setStatus = useSetPositionStatus();
  const transitions = POSITION_STATUS_TRANSITIONS[position.status];

  return (
    <div onClick={(e) => e.preventDefault()}>
      <button
        ref={anchorRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-600"
      >
        <DotsIcon size={15} />
      </button>
      <FloatingMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} align="end">
        <div className="w-42 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              push(`/positions/${position.id}/edit`);
            }}
            className="flex w-full items-center px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50"
          >
            Edit position
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              push(`/positions/${position.id}/board?select=all`);
            }}
            className="flex w-full items-center px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50"
          >
            Email all candidates
          </button>
          {/* An unlisted position is shareable only by its direct link, and
              this list is where staff come looking for it. Hidden when there
              is nothing to share: a draft was never published and a disabled
              position's URL 404s. */}
          {position.publishMode !== "disabled" && position.status !== "draft" && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                void navigator.clipboard
                  .writeText(`${window.location.origin}/careers/${position.slug}`)
                  .catch(() => {
                    // Clipboard access can be refused; the link is also on the
                    // position's Application step, so this is not the only way.
                  });
              }}
              className="flex w-full items-center px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50"
            >
              Copy public link
            </button>
          )}
          <div className="my-1 h-px bg-slate-100" />
          {transitions.map((transition) => (
            <button
              key={transition.status}
              type="button"
              disabled={setStatus.isPending}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setStatus.mutate({ id: position.id, status: transition.status });
                setOpen(false);
              }}
              className="flex w-full items-center px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {transition.label}
            </button>
          ))}
        </div>
      </FloatingMenu>
    </div>
  );
}
