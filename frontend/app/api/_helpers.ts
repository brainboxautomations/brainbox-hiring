import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/configurations/supabase-server-configuration";
import type { Database } from "@/types/database.types";

export type AuthedContext = {
  supabase: SupabaseClient<Database>;
  user: User;
};

export async function requireUser(): Promise<AuthedContext | NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return { supabase, user };
}

export type BoundedRequestBody = { text: string } | { tooLarge: true };

export async function readBoundedRequestText(
  request: Request,
  maxBytes: number,
): Promise<BoundedRequestBody> {
  const stream = request.body;
  if (!stream) return { text: await request.text() };

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  let chunk = await reader.read();
  while (!chunk.done) {
    received += chunk.value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return { tooLarge: true };
    }
    chunks.push(chunk.value);
    chunk = await reader.read();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }

  return { text: new TextDecoder().decode(bytes) };
}

export function apiError(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function apiUnexpected(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return NextResponse.json({ error: message }, { status: 500 });
}
