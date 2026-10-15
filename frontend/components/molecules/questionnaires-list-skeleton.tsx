"use client";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

const ROWS = 4;

export function QuestionnairesListSkeleton() {
  return (
    <SkeletonTheme baseColor="#F1F5F9" highlightColor="#E2E8F0">
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: ROWS }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3.5 rounded-xl border border-slate-200 bg-white px-4.5 py-3.75 shadow-card"
          >
            <Skeleton
              width={36}
              height={36}
              borderRadius={9}
              containerClassName="flex shrink-0 leading-none"
            />
            <div className="min-w-0 flex-1">
              <Skeleton width={160 + ((i * 23) % 90)} height={14} />
              <Skeleton width={90} height={11} style={{ marginTop: 6 }} />
            </div>
            <Skeleton width={52} height={26} borderRadius={7} />
          </div>
        ))}
      </div>
    </SkeletonTheme>
  );
}
