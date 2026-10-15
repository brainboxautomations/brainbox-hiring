import type { PositionStatus } from "@/types/api";

export type PositionStatusTransition = { status: PositionStatus; label: string };

export const POSITION_STATUS_LABEL: Record<PositionStatus, string> = {
  open: "Open",
  draft: "Draft",
  closed: "Closed",
  archived: "Archived",
};

export const POSITION_STATUS_TRANSITIONS: Record<PositionStatus, PositionStatusTransition[]> = {
  draft: [
    { status: "open", label: "Publish" },
    { status: "archived", label: "Archive" },
  ],
  open: [
    { status: "closed", label: "Close (pause)" },
    { status: "archived", label: "Archive" },
  ],
  closed: [
    { status: "open", label: "Reopen" },
    { status: "archived", label: "Archive" },
  ],
  archived: [{ status: "draft", label: "Restore to draft" }],
};

export function isPipelineEditable(status: PositionStatus): boolean {
  return status === "draft";
}

export const PIPELINE_FREEZE_EXPLANATION =
  "Stage order is frozen once a position leaves draft, so its pipeline can no longer be reassigned. Candidates already in the pipeline would lose their place. Create a new position to use a different pipeline.";
