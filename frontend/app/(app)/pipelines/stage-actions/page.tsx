"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useNavigate } from "@/hooks/use-navigate";

import { StageActionsPanel } from "@/components/organisms/stage-actions-panel";

function StageActionsRoute() {
  const navigate = useNavigate();
  const params = useSearchParams();
  const positionId = params.get("positionId");
  const stageId = params.get("stageId");
  const draftSaved = params.get("draftSaved") === "1";

  const close = () => navigate.push(positionId ? `/positions/${positionId}/board` : "/positions");

  if (!positionId || !stageId) {
    return (
      <div className="relative h-full overflow-hidden bg-slate-50">
        <button
          type="button"
          aria-label="Close stage actions"
          className="absolute inset-0 h-full w-full cursor-default bg-slate-900/30"
          onClick={close}
        />
        <div className="absolute inset-y-0 right-0 flex w-135 max-w-[96vw] flex-col items-center justify-center gap-3 border-l border-slate-200 bg-white p-8 text-center shadow-modal">
          <div className="text-sm font-semibold text-slate-900">
            Stage actions belong to one stage of one position
          </div>
          <p className="max-w-70 text-xs leading-relaxed text-slate-500">
            Open a position&apos;s board and choose Automations on the stage you want to configure.
          </p>
          <a href="/positions" className="text-[13px] font-medium text-accent-11 hover:underline">
            Go to positions
          </a>
        </div>
      </div>
    );
  }

  return (
    <StageActionsPanel
      positionId={positionId}
      stageId={stageId}
      onClose={close}
      draftSavedBanner={draftSaved}
    />
  );
}

export default function StageActionsPage() {
  return (
    <Suspense fallback={<div className="h-full bg-slate-50" />}>
      <StageActionsRoute />
    </Suspense>
  );
}
