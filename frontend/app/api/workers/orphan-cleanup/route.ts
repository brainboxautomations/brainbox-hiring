import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/configurations/env-configuration";
import {
  MissingServiceRoleKeyError,
  createSupabaseServiceClient,
} from "@/configurations/supabase-service-configuration";
import { runOrphanCleanup, supabaseOrphanStore } from "@/app/api/workers/orphan-cleanup/_run";
import { WORKER_SECRET_HEADER } from "@/app/api/workers/scheduled-actions/route";
import { constantTimeEquals } from "@/utilities/webhook-signature";

export const runtime = "nodejs";

/**
 * Deletes abandoned candidate uploads. Called once a day by the
 * `brainbox-orphan-cleanup` cron job (migration 0045), with the same shared
 * secret as the scheduled-actions worker.
 */
export async function POST(request: NextRequest) {
  const { AUTOMATION_WORKER_SECRET } = serverEnv();

  if (!AUTOMATION_WORKER_SECRET) {
    return NextResponse.json(
      { error: "AUTOMATION_WORKER_SECRET is not configured; orphan cleanup is disabled" },
      { status: 503 },
    );
  }

  const presented = request.headers.get(WORKER_SECRET_HEADER) ?? "";
  if (!constantTimeEquals(presented, AUTOMATION_WORKER_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch (error) {
    if (error instanceof MissingServiceRoleKeyError) {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY is not configured; orphan cleanup cannot run" },
        { status: 503 },
      );
    }
    throw error;
  }

  try {
    const summary = await runOrphanCleanup(supabaseOrphanStore(supabase));
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Orphan cleanup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
