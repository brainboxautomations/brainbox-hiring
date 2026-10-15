import { NextResponse, type NextRequest } from "next/server";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { mapMessageTemplate } from "@/app/api/_mappers";
import { TEMPLATE_SELECT } from "@/app/api/message-templates/route";
import { messageTemplateInputSchema } from "@/schemas/message-template-schema";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;

  const { data, error } = await supabase
    .from("message_templates")
    .select(TEMPLATE_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) return apiError(error.message, 500);
  if (!data) return apiError("Template not found", 404);

  return NextResponse.json({ template: mapMessageTemplate(data) });
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;

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
      .update({
        name: parsed.data.name,
        subject: parsed.data.subject,
        body: parsed.data.body,
      })
      .eq("id", id)
      .select(TEMPLATE_SELECT)
      .maybeSingle();

    if (error) return apiError(error.message, 500);
    if (!data) return apiError("Template not found", 404);

    return NextResponse.json({ template: mapMessageTemplate(data) });
  } catch (error) {
    return apiUnexpected(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;

  const { error } = await supabase.from("message_templates").delete().eq("id", id);
  if (error) return apiError(error.message, 500);

  return NextResponse.json({ ok: true });
}
