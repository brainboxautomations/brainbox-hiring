import type { TestProject } from "vitest/node";

import { runSql } from "./_sql";

const TEST_EMAIL_DOMAIN = "example.com";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `L3 needs ${name}. Start the local stack with \`npm run db:start\` and run \`npm run test:integration:local\`, or set it for a hosted project. See docs/testing-strategy.md.`,
    );
  }
  return value;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const STALE_USER_SWEEP = `delete from auth.users where email like 'l3-%@${TEST_EMAIL_DOMAIN}' and created_at < now() - interval '1 hour';`;

function seedUserSql(email: string, password: string): string {
  const e = sqlLiteral(email);
  const p = sqlLiteral(password);

  return `
delete from auth.users where email = ${e};

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  ${e},
  extensions.crypt(${p}, extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"L3 Integration Suite"}'::jsonb,
  now(), now(),
  '', '', '', '', '', '', '', ''
);

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select gen_random_uuid(), u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.email = ${e};
`;
}

const CRON_JOB = "brainbox-scheduled-actions";

function setWorkerCronActive(active: boolean): string {
  return `select cron.alter_job(jobid, active := ${active}) from cron.job where jobname = ${sqlLiteral(CRON_JOB)};`;
}

const PAUSE_WORKER_CRON = setWorkerCronActive(false);

const RESUME_WORKER_CRON = setWorkerCronActive(true);

type EmailTiming = { automation_safety_delay_minutes: number; send_undo_minutes: number };

const DEFAULT_EMAIL_TIMING: EmailTiming = {
  automation_safety_delay_minutes: 20,
  send_undo_minutes: 30,
};

// The suite drives automations and sends that expect to run at once, so the
// safety delay and undo window (0054) are off while it runs, and the project's
// own values are put back afterwards, like the paused cron job.
function setEmailTiming(timing: EmailTiming): string {
  const safety = Math.trunc(timing.automation_safety_delay_minutes);
  const undo = Math.trunc(timing.send_undo_minutes);
  return `update email_timing_settings set automation_safety_delay_minutes = ${safety}, send_undo_minutes = ${undo};`;
}

async function readEmailTiming(url: string, serviceKey: string): Promise<EmailTiming> {
  if (!serviceKey) return DEFAULT_EMAIL_TIMING;
  try {
    const response = await fetch(
      `${url}/rest/v1/email_timing_settings?select=automation_safety_delay_minutes,send_undo_minutes&id=eq.true`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    const rows = (await response.json()) as EmailTiming[];
    return rows[0] ?? DEFAULT_EMAIL_TIMING;
  } catch {
    return DEFAULT_EMAIL_TIMING;
  }
}

export default async function setup(project: TestProject) {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const email =
    process.env.L3_TEST_EMAIL?.trim() || `l3-${crypto.randomUUID()}@${TEST_EMAIL_DOMAIN}`;
  const password = process.env.L3_TEST_PASSWORD?.trim() || `L3-${crypto.randomUUID()}`;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const savedTiming = await readEmailTiming(url, serviceKey);
  const timingOff = setEmailTiming({ automation_safety_delay_minutes: 0, send_undo_minutes: 0 });

  runSql(
    `${PAUSE_WORKER_CRON}\n${timingOff}\n${STALE_USER_SWEEP}\n${seedUserSql(email, password)}`,
  );

  project.provide("l3Credentials", { url, anonKey, email, password });
  project.provide("l3ServiceRoleKey", serviceKey);

  return () => {
    runSql(
      `${RESUME_WORKER_CRON}\n${setEmailTiming(savedTiming)}\ndelete from auth.users where email = ${sqlLiteral(email)};`,
    );
  };
}

declare module "vitest" {
  interface ProvidedContext {
    l3Credentials: { url: string; anonKey: string; email: string; password: string };
    l3ServiceRoleKey: string;
  }
}
