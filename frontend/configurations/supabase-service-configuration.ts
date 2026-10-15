import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env, serverEnv } from "@/configurations/env-configuration";
import type { Database } from "@/types/database.types";

export class MissingServiceRoleKeyError extends Error {
  constructor() {
    super("SUPABASE_SERVICE_ROLE_KEY is not configured");
    this.name = "MissingServiceRoleKeyError";
  }
}

let client: SupabaseClient<Database> | null = null;

export function createSupabaseServiceClient(): SupabaseClient<Database> {
  const { SUPABASE_SERVICE_ROLE_KEY } = serverEnv();
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new MissingServiceRoleKeyError();

  if (!client) {
    client = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  return client;
}
