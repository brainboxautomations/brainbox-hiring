import { NextResponse, type NextRequest } from "next/server";

import { apiError, requireUser } from "@/app/api/_helpers";
import type { CandidateSearchResult } from "@/types/api";
import { candidateSearchWords, matchesAllWords } from "@/utilities/candidate-search";

const MAX_RESULTS = 20;

/** Fetched from the database, then narrowed by the remaining words. */
const MAX_CANDIDATES_SCANNED = 60;

/**
 * Finds candidates by name or email, for picking who an email goes to.
 *
 * The database narrows on the first word only: combining one `or` group per
 * word on an embedded table is not something PostgREST can express reliably.
 * The rest of the words are applied here, so "nadia rahman" finds Nadia Rahman
 * even though no single column holds both.
 */
export async function GET(request: NextRequest) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const words = candidateSearchWords(request.nextUrl.searchParams.get("q") ?? "");
  if (!words) return NextResponse.json({ results: [] });

  const first = words[0];
  const { data, error } = await supabase
    .from("applications")
    .select("id, status, applied_at, people!inner(first_name, last_name, email), positions(title)")
    .or(`first_name.ilike.%${first}%,last_name.ilike.%${first}%,email.ilike.%${first}%`, {
      referencedTable: "people",
    })
    .order("applied_at", { ascending: false })
    .limit(MAX_CANDIDATES_SCANNED);
  if (error) return apiError(error.message, 500);

  const results: CandidateSearchResult[] = (data ?? [])
    .map((row) => ({
      applicationId: row.id,
      firstName: row.people.first_name,
      lastName: row.people.last_name,
      email: row.people.email,
      positionTitle: row.positions?.title ?? null,
      archived: row.status === "archived",
    }))
    .filter((result) => matchesAllWords(words, result))
    .slice(0, MAX_RESULTS);

  return NextResponse.json({ results });
}
