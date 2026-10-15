import { NextResponse, type NextRequest } from "next/server";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapCandidateExportRecord } from "@/app/api/_mappers";
import { CANDIDATE_EXPORT_SELECT } from "@/app/api/applications/_shared";
import { bulkCandidateExportSchema } from "@/schemas/bulk-candidate-schema";

export async function POST(request: NextRequest) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body");
  }

  const parsed = bulkCandidateExportSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid export request", 422);
  }

  const requestedIds = [...new Set(parsed.data.applicationIds)];

  try {
    const { data, error } = await supabase
      .from("applications")
      .select(CANDIDATE_EXPORT_SELECT)
      .in("id", requestedIds)
      .order("applied_at", { ascending: false });
    if (error) return apiError(error.message, 500);

    const records = (data ?? []).map((row) => mapCandidateExportRecord(row));
    const foundIds = new Set(records.map((record) => record.applicationId));
    const missingIds = requestedIds.filter((applicationId) => !foundIds.has(applicationId));

    return NextResponse.json({ records, missingIds });
  } catch (error) {
    return apiUnexpected(error);
  }
}
