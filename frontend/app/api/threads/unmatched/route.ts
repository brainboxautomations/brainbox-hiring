import { NextResponse } from "next/server";

import { apiError, requireUser } from "@/app/api/_helpers";
import { mapUnmatchedInboundEmail } from "@/app/api/_mappers";

const UNMATCHED_SELECT =
  "id, from_address, subject, body_text, body_html, attachments, reason, received_at";

const MAX_UNMATCHED = 200;

export async function GET() {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const { data, error } = await supabase
    .from("unmatched_inbound_emails")
    .select(UNMATCHED_SELECT)
    .order("received_at", { ascending: false })
    .limit(MAX_UNMATCHED);

  if (error) return apiError(error.message, 500);

  return NextResponse.json({ emails: (data ?? []).map(mapUnmatchedInboundEmail) });
}
