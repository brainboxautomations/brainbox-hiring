"use client";

import { useParams } from "next/navigation";

import { PipelineBoardScreen } from "./pipeline-board-screen";

export default function PipelineBoardPage() {
  const params = useParams<{ positionId: string }>();
  return <PipelineBoardScreen positionId={params.positionId} />;
}
