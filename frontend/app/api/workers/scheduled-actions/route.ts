import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/configurations/env-configuration";
import {
  MissingServiceRoleKeyError,
  createSupabaseServiceClient,
} from "@/configurations/supabase-service-configuration";
import { runDueScheduledActions } from "@/app/api/workers/scheduled-actions/_run";
import { runDueScheduledMessages } from "@/app/api/workers/scheduled-actions/_run-messages";
import type { WorkerRunSummary } from "@/types/api";
import { constantTimeEquals } from "@/utilities/webhook-signature";

export const runtime = "nodejs";

export const WORKER_SECRET_HEADER = "x-automation-worker-secret";

export async function POST(request: NextRequest) {
  const { AUTOMATION_WORKER_SECRET } = serverEnv();

  if (!AUTOMATION_WORKER_SECRET) {
    return NextResponse.json(
      { error: "AUTOMATION_WORKER_SECRET is not configured; the queue worker is disabled" },
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
        { error: "SUPABASE_SERVICE_ROLE_KEY is not configured; the queue worker cannot run" },
        { status: 503 },
      );
    }
    throw error;
  }

  try {
    const summary: WorkerRunSummary = {
      actions: await runDueScheduledActions(supabase, { now: new Date() }),
      messages: await runDueScheduledMessages(supabase, { now: new Date() }),
    };
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The queue worker failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
