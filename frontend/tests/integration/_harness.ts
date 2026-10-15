import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inject } from "vitest";

import type { Database } from "@/types/database.types";
import { cookieJar } from "./_cookie-jar";

export type L3Session = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

function clientOverJar(url: string, anonKey: string) {
  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => cookieJar.getAll(),
      setAll: (cookies) => {
        for (const { name, value } of cookies) cookieJar.set(name, value);
      },
    },
  });
}

export async function signInTestUser(): Promise<L3Session> {
  const { url, anonKey, email, password } = inject("l3Credentials");
  cookieJar.clear();

  const supabase = clientOverJar(url, anonKey);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    throw new Error(`L3 could not sign its test user in: ${error?.message ?? "no session"}`);
  }

  return { supabase, userId: data.user.id };
}

export function signOutForRequest(): void {
  cookieJar.clear();
}

export function restoreSession(cookies: { name: string; value: string }[]): void {
  cookieJar.replaceWith(cookies);
}

export function currentCookies(): { name: string; value: string }[] {
  return cookieJar.getAll();
}

export function jsonRequest(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function multipartRequest(url: string, payload: unknown, files: File[] = []): NextRequest {
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  for (const file of files) form.append("attachments", file);
  return new NextRequest(url, { method: "POST", body: form });
}

export function getRequest(url: string): NextRequest {
  return new NextRequest(url);
}

export function routeParams<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

export type Fixture = {
  personId: string;
  positionId: string;
  applicationId: string;
  pipelineId: string;
  email: string;
  cleanup: () => Promise<void>;
};

export async function seedCandidate(
  supabase: SupabaseClient<Database>,
  overrides: {
    firstName?: string;
    lastName?: string | null;
    phone?: string | null;
    customAttributes?: Record<string, string>;
    positionTitle?: string;
    emailSenderName?: string | null;
  } = {},
): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const email = `l3-candidate-${suffix}@example.com`;

  const { data: person, error: personError } = await supabase
    .from("people")
    .insert({
      first_name: overrides.firstName ?? "Amara",
      last_name: overrides.lastName === undefined ? "Okafor" : overrides.lastName,
      email,
      phone: overrides.phone === undefined ? "+44 20 7946 0821" : overrides.phone,
      custom_attributes: overrides.customAttributes ?? { notice_period: "4 weeks" },
    })
    .select("id")
    .single();
  if (personError || !person) throw new Error(`seed person: ${personError?.message}`);

  const { data: pipeline, error: pipelineError } = await supabase
    .from("pipelines")
    .insert({ name: `L3 pipeline ${suffix}`, is_template: true })
    .select("id")
    .single();
  if (pipelineError || !pipeline) throw new Error(`seed pipeline: ${pipelineError?.message}`);

  const { data: position, error: positionError } = await supabase
    .from("positions")
    .insert({
      title: overrides.positionTitle ?? "Senior Frontend Engineer",
      slug: `l3-position-${suffix}`,
      department: "Engineering",
      locations: [{ country: "United Kingdom", detail: "London" }],
      remote_flag: true,
      salary_from: 85000,
      salary_to: 110000,
      salary_period: "year",
      salary_currency: "GBP",
      assigned_pipeline_id: pipeline.id,
      email_sender_name: overrides.emailSenderName ?? "Acme Talent",
    })
    .select("id")
    .single();
  if (positionError || !position) throw new Error(`seed position: ${positionError?.message}`);

  const { data: application, error: applicationError } = await supabase
    .from("applications")
    .insert({ person_id: person.id, position_id: position.id })
    .select("id")
    .single();
  if (applicationError || !application) {
    throw new Error(`seed application: ${applicationError?.message}`);
  }

  return {
    personId: person.id,
    positionId: position.id,
    applicationId: application.id,
    pipelineId: pipeline.id,
    email,
    cleanup: async () => {
      await supabase.from("messages").delete().eq("person_id", person.id);
      await supabase.from("applications").delete().eq("id", application.id);
      await supabase.from("positions").delete().eq("id", position.id);
      await supabase.from("pipelines").delete().eq("id", pipeline.id);
      await supabase.from("people").delete().eq("id", person.id);
    },
  };
}
