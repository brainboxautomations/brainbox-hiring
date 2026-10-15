"use client";

import { useParams } from "next/navigation";

import { EditPositionScreen } from "./edit-position-screen";

export default function EditPositionPage() {
  const params = useParams<{ positionId: string }>();
  return <EditPositionScreen positionId={params.positionId} />;
}
