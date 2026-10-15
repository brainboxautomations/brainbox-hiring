import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import type { TablesUpdate } from "@/types/database.types";

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    phone: z.string().trim().nullish(),
    headline: z.string().trim().nullish(),
    links: z.array(z.object({ label: z.string().trim(), url: z.string().trim() })).optional(),
    customAttributes: z.record(z.string(), z.string()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError("Invalid JSON body");
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid update", 422);
  }
  const input = parsed.data;

  const rowUpdate: TablesUpdate<"people"> = {};
  if (input.phone !== undefined) rowUpdate.phone = input.phone;
  if (input.headline !== undefined) rowUpdate.headline = input.headline;
  if (input.links !== undefined) rowUpdate.links = input.links;
  if (input.customAttributes !== undefined) rowUpdate.custom_attributes = input.customAttributes;

  try {
    const { data, error } = await supabase
      .from("people")
      .update(rowUpdate)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) return apiError(error.message, 500);
    if (!data) return apiError("Person not found", 404);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiUnexpected(error);
  }
}
