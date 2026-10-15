import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { TemplatedEmailSender } from "@/app/api/messages/_send";
import type { BulkCandidateFailure } from "@/types/api";
import type { Database } from "@/types/database.types";

export const CANDIDATE_NOT_FOUND = "Candidate not found";

export type BulkSelectionCandidate = {
  applicationId: string;
  positionId: string;
  currentStageId: string | null;
};

export type BulkSelection = {
  candidates: BulkSelectionCandidate[];
  failures: BulkCandidateFailure[];
};

export async function readSelection(
  supabase: SupabaseClient<Database>,
  applicationIds: string[],
): Promise<BulkSelection | { error: string }> {
  const requestedIds = [...new Set(applicationIds)];

  const { data, error } = await supabase
    .from("applications")
    .select("id, position_id, current_stage_id")
    .in("id", requestedIds);

  if (error) return { error: error.message };

  const rows = data ?? [];
  const found = new Map(rows.map((row) => [row.id, row]));

  const candidates: BulkSelectionCandidate[] = [];
  const failures: BulkCandidateFailure[] = [];

  for (const applicationId of requestedIds) {
    const row = found.get(applicationId);
    if (!row) {
      failures.push({ applicationId, reason: CANDIDATE_NOT_FOUND });
      continue;
    }
    candidates.push({
      applicationId: row.id,
      positionId: row.position_id,
      currentStageId: row.current_stage_id,
    });
  }

  return { candidates, failures };
}

export async function manualSender(
  supabase: SupabaseClient<Database>,
  user: User,
): Promise<TemplatedEmailSender> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  return {
    origin: "manual",
    userId: user.id,
    fullName: profile?.full_name ?? null,
    email: profile?.email ?? user.email ?? null,
  };
}
