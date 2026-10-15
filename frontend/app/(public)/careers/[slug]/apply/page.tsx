import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type { Position } from "@/types/api";
import { getPublicPositionBySlug } from "../../_data";
import { ApplyForm } from "./apply-form";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

function locationLabel(p: Position): string {
  const first = p.locations[0];
  if (!first) return "Remote";
  return first.detail?.trim() || first.country;
}

function metaLine(p: Position): string {
  return [locationLabel(p), p.positionType, p.department].filter(Boolean).join(" · ");
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPublicPositionBySlug(slug);
  if (!result) return { title: "Role not found" };
  return { title: `Apply · ${result.position.title}` };
}

export default async function ApplyPage({ params }: Params) {
  const { slug } = await params;
  const result = await getPublicPositionBySlug(slug);
  if (!result) notFound();

  return (
    <ApplyForm
      position={result.position}
      questions={result.questions}
      meta={metaLine(result.position)}
    />
  );
}
