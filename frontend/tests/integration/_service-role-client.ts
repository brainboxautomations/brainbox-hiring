import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { inject } from "vitest";

import type { Database } from "@/types/database.types";

export const MISSING_SERVICE_ROLE_KEY =
  "L3 needs a real SUPABASE_SERVICE_ROLE_KEY to exercise a Route Handler that runs as the service role. `npm run test:integration:local` sets the local stack's key; against a hosted project, put it in frontend/.env.";

export function serviceRoleClient(): SupabaseClient<Database> {
  const { url } = inject("l3Credentials");
  const key = inject("l3ServiceRoleKey");

  if (!key || key.startsWith("l3-placeholder")) throw new Error(MISSING_SERVICE_ROLE_KEY);

  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
