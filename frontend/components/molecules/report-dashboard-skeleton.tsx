"use client";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

import { Card } from "@/components/atoms/card";

export function ReportDashboardSkeleton() {
  return (
    <SkeletonTheme baseColor="#F1F5F9" highlightColor="#E2E8F0">
      <section aria-label="Key figures" className="mb-3.5 grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="rounded-xl px-[18px] py-4">
            <Skeleton width={100} height={12} />
            <Skeleton width={56} height={26} style={{ marginTop: 8 }} />
          </Card>
        ))}
      </section>

      <div className="mb-3.5 grid grid-cols-[1.3fr_1fr] gap-3">
        <Card className="rounded-[14px] p-5">
          <Skeleton width={170} height={14} />
          <Skeleton width={230} height={11} style={{ marginTop: 6, marginBottom: 20 }} />
          <div className="flex h-[130px] items-end gap-3.5 pl-1">
            {[62, 88, 46, 100].map((h, i) => (
              <div key={i} className="flex h-full flex-1 flex-col items-end justify-end">
                <Skeleton width="100%" height={h} />
              </div>
            ))}
          </div>
        </Card>
        <Card className="rounded-[14px] p-5">
          <Skeleton width={150} height={14} />
          <Skeleton width={200} height={11} style={{ marginTop: 6, marginBottom: 18 }} />
          <div className="flex flex-col gap-[13px]">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i}>
                <Skeleton width={90 + i * 12} height={11} style={{ marginBottom: 5 }} />
                <Skeleton width="100%" height={7} borderRadius={999} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden rounded-[14px]">
        <div className="px-5 pb-1 pt-4">
          <Skeleton width={150} height={14} />
        </div>
        <div className="mt-2 grid h-9 grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center border-b border-slate-200 bg-slate-50 px-5" />
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="grid h-[46px] grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center border-b border-slate-100 px-5 last:border-b-0"
          >
            <Skeleton width={140 + ((i * 19) % 60)} height={13} />
            <Skeleton width={28} height={12} />
            <Skeleton width={28} height={12} />
            <Skeleton width={28} height={12} />
            <Skeleton width={28} height={12} />
          </div>
        ))}
      </Card>
    </SkeletonTheme>
  );
}
