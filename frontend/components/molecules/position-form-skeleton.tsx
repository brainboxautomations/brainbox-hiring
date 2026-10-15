"use client";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

const STEPS = 4;

export function PositionFormSkeleton() {
  return (
    <SkeletonTheme baseColor="#F1F5F9" highlightColor="#E2E8F0">
      <div className="mb-7 flex items-center">
        {Array.from({ length: STEPS }, (_, i) => (
          <div key={i} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-2.5">
              <Skeleton circle width={22} height={22} containerClassName="flex leading-none" />
              <Skeleton width={70} height={12} />
            </div>
            {i < STEPS - 1 && <div className="mx-3 h-px flex-1 bg-slate-200" />}
          </div>
        ))}
      </div>

      <div className="mb-6">
        <Skeleton width={220} height={22} />
        <Skeleton width={320} height={13} style={{ marginTop: 8 }} />
      </div>

      <div className="flex flex-col gap-5">
        <div>
          <Skeleton width={110} height={11} style={{ marginBottom: 6 }} />
          <Skeleton height={36} borderRadius={7} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Skeleton width={90} height={11} style={{ marginBottom: 6 }} />
            <Skeleton height={36} borderRadius={7} />
          </div>
          <div>
            <Skeleton width={90} height={11} style={{ marginBottom: 6 }} />
            <Skeleton height={36} borderRadius={7} />
          </div>
        </div>
        <div>
          <Skeleton width={130} height={11} style={{ marginBottom: 6 }} />
          <Skeleton height={90} borderRadius={7} />
        </div>
      </div>
    </SkeletonTheme>
  );
}
