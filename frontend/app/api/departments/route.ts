import { NextResponse, type NextRequest } from "next/server";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { departmentInputSchema } from "@/schemas/department-schema";
import type { Department } from "@/types/api";

const UNIQUE_VIOLATION = "23505";

export async function GET() {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const { data, error } = await ctx.supabase
    .from("departments")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) return apiError(error.message, 500);

  const departments: Department[] = data ?? [];
  return NextResponse.json({ departments });
}

export async function POST(request: NextRequest) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body");
  }

  const parsed = departmentInputSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid department", 422);
  }

  try {
    const { data, error } = await ctx.supabase
      .from("departments")
      .insert({ name: parsed.data.name })
      .select("id, name")
      .single();

    if (error) {
      // The unique index ignores case, so "sales" clashes with "Sales".
      if (error.code === UNIQUE_VIOLATION) {
        return apiError("That department already exists.", 409);
      }
      return apiError(error.message, 500);
    }

    const department: Department = data;
    return NextResponse.json({ department }, { status: 201 });
  } catch (error) {
    return apiUnexpected(error);
  }
}
