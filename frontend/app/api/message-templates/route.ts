import { NextResponse, type NextRequest } from "next/server";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapMessageTemplate } from "@/app/api/_mappers";
import { messageTemplateInputSchema } from "@/schemas/message-template-schema";

export const TEMPLATE_SELECT = "id, name, subject, body, created_at, updated_at";

export async function GET() {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const { data, error } = await supabase
    .from("message_templates")
    .select(TEMPLATE_SELECT)
    .order("updated_at", { ascending: false });

  if (error) return apiError(error.message, 500);

  return NextResponse.json({ templates: (data ?? []).map(mapMessageTemplate) });
}

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

  const parsed = messageTemplateInputSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid template", 422);
  }

  try {
    const { data, error } = await supabase
      .from("message_templates")
      .insert({
        name: parsed.data.name,
        subject: parsed.data.subject,
        body: parsed.data.body,
      })
      .select(TEMPLATE_SELECT)
      .single();

    if (error || !data) return apiError(error?.message ?? "Insert failed", 500);

    return NextResponse.json({ template: mapMessageTemplate(data) }, { status: 201 });
  } catch (error) {
    return apiUnexpected(error);
  }
}
