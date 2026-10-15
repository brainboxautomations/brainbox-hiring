import { NextResponse, type NextRequest } from "next/server";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapTeamMember } from "@/app/api/_mappers";
import {
  MissingServiceRoleKeyError,
  createSupabaseServiceClient,
} from "@/configurations/supabase-service-configuration";
import { createTeamMemberSchema } from "@/schemas/team-member-schema";
import type { TeamMember } from "@/types/api";

const PROFILE_SELECT = "id, full_name, email, created_at";

export async function GET() {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const { data, error } = await ctx.supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .order("created_at", { ascending: true });

  if (error) return apiError(error.message, 500);

  return NextResponse.json({ users: (data ?? []).map(mapTeamMember) });
}

/**
 * Adds a team member with a password chosen by whoever adds them, who then
 * passes it on directly. There is no invite email: these are employees, set up
 * by a colleague.
 *
 * Creating an auth user needs Supabase's admin API and the service-role key,
 * which only the server holds. The account is marked confirmed so they can
 * sign in straight away, and the `handle_new_user` trigger (0001) creates their
 * profile from `full_name`, so they appear in this list at once rather than on
 * first sign-in.
 *
 * Phase 1 has no roles, so any signed-in user can add another.
 */
export async function POST(request: NextRequest) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body");
  }

  const parsed = createTeamMemberSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid user", 422);
  }
  const { fullName, email, password } = parsed.data;

  let admin;
  try {
    admin = createSupabaseServiceClient();
  } catch (error) {
    if (error instanceof MissingServiceRoleKeyError) {
      return apiError("SUPABASE_SERVICE_ROLE_KEY is not configured, so users cannot be added", 503);
    }
    throw error;
  }

  try {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (error || !data.user) {
      if (
        error?.code === "email_exists" ||
        /already (been )?registered/i.test(error?.message ?? "")
      ) {
        return apiError("Someone with this email already has an account.", 409);
      }
      if (error?.code === "weak_password") {
        return apiError(error.message, 422);
      }
      return apiError(error?.message ?? "Could not create the user", 500);
    }

    const member: TeamMember = {
      id: data.user.id,
      fullName,
      email: data.user.email ?? email,
      createdAt: data.user.created_at,
    };
    return NextResponse.json({ user: member }, { status: 201 });
  } catch (error) {
    return apiUnexpected(error);
  }
}
