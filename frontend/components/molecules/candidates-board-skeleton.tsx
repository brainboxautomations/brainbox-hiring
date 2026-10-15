"use client";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

const COLUMNS = 4;
const CARDS_PER_COLUMN = [3, 2, 4, 2];

function BoardCardSkeleton() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.75 py-2.5 shadow-card">
      <div className="flex items-start gap-2">
        <Skeleton circle width={28} height={28} containerClassName="flex shrink-0 leading-none" />
        <div className="min-w-0 flex-1">
          <Skeleton width="70%" height={12} />
          <Skeleton width="55%" height={10} style={{ marginTop: 4 }} />
        </div>
      </div>
      <div className="mt-2.25 border-t border-slate-100 pt-2">
        <Skeleton width={60} height={9} />
      </div>
    </div>
  );
}

export function CandidatesBoardSkeleton() {
  return (
    <SkeletonTheme baseColor="#F1F5F9" highlightColor="#E2E8F0">
      <div className="flex h-full items-start gap-3.5 p-4">
        {Array.from({ length: COLUMNS }, (_, columnIndex) => (
          <div key={columnIndex} className="flex w-67 shrink-0 flex-col gap-2">
            <div className="flex items-center gap-2 px-1 pb-2.5 pt-0.5">
              <Skeleton circle width={8} height={8} />
              <Skeleton width={80} height={13} />
            </div>
            {Array.from(
              { length: CARDS_PER_COLUMN[columnIndex % CARDS_PER_COLUMN.length]! },
              (_, cardIndex) => (
                <BoardCardSkeleton key={cardIndex} />
              ),
            )}
          </div>
        ))}
      </div>
    </SkeletonTheme>
  );
}
