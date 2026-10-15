import { Badge, type BadgeTone } from "@/components/atoms/badge";
import type { PositionStatus } from "@/types/api";
import { POSITION_STATUS_LABEL } from "@/utilities/position-status";

const tones: Record<PositionStatus, BadgeTone> = {
  open: "green",
  draft: "neutral",
  closed: "amber",
  archived: "neutral",
};

export function PositionStatusBadge({ status }: { status: PositionStatus }) {
  return (
    <Badge tone={tones[status]} dot>
      {POSITION_STATUS_LABEL[status]}
    </Badge>
  );
}
