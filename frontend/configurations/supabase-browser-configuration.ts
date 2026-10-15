import { createBrowserClient } from "@supabase/ssr";

import { env } from "@/configurations/env-configuration";
import type { Database } from "@/types/database.types";

export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
