import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

let client: SupabaseClient<Database> | null = null;

export function setServiceClient(next: SupabaseClient<Database>): void {
  client = next;
}

export function getServiceClient(): SupabaseClient<Database> {
  if (!client) throw new Error("The L3 service client stand-in was never set");
  return client;
}
