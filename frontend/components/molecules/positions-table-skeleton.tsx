"use client";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

const ROWS = 6;

export function PositionsTableSkeleton() {
  return (
    <SkeletonTheme baseColor="#F1F5F9" highlightColor="#E2E8F0">
      {Array.from({ length: ROWS }, (_, i) => (
        <div
          key={i}
          className="grid h-14 grid-cols-[2.4fr_1.2fr_1.4fr_1fr_90px_100px_44px] items-center border-b border-slate-100 px-4 last:border-b-0"
        >
          <div className="flex items-center gap-2.75">
            <Skeleton
              circle
              width={30}
              height={30}
              containerClassName="flex shrink-0 leading-none"
            />
            <Skeleton width={120 + ((i * 17) % 90)} height={13} />
          </div>
          <Skeleton width={58 + ((i * 13) % 40)} height={11} />
          <Skeleton width={60 + ((i * 11) % 60)} height={11} />
          <Skeleton width={64} height={20} borderRadius={999} />
          <div className="flex justify-end pr-4">
            <Skeleton width={22} height={13} />
          </div>
          <Skeleton width={70} height={11} />
          <div />
        </div>
      ))}
    </SkeletonTheme>
  );
}
