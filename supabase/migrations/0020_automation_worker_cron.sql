-- M6a — the automation engine, part 3 of 3: the cron trigger (AUT-7).
--
-- Decision D3: pg_cron plus a queue table. No separate service, no external
-- scheduler.
--
-- pg_cron cannot send the email itself. Everything that makes an outbound
-- message correct — merge-variable resolution, the rich-text link allowlist,
-- header-injection defence, attachment download, the failure row, the
-- send-then-record ordering, the RFC Message-ID fetch — lives in
-- `frontend/app/api/messages/_send.ts`, and re-implementing any of it in plpgsql
-- would mean two mailers that drift. So the cron job is a doorbell: once a
-- minute it asks whether anything is due and, if so, POSTs the worker Route
-- Handler through pg_net. The handler claims rows with
-- `claim_due_scheduled_actions` (0019) and calls the one real send path.
--
-- The HTTP call is fire-and-forget by design. pg_net does not wait for a
-- response, so a slow send never holds a cron slot open, and two overlapping
-- invocations are harmless: claiming is atomic, so the second finds nothing left
-- to take.

-- pg_cron lands in `pg_catalog` and creates the `cron` schema; pg_net registers
-- against `extensions` but hard-codes its own `net` schema for the HTTP
-- functions. Both are called schema-qualified below for that reason — the
-- functions here pin `search_path = public`, so nothing resolves by luck.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Where to knock, and with what. This is a single-row table rather than a
-- migration constant because it holds a shared secret, and migrations are in
-- git. It ships empty and disabled: until an operator fills it in, the cron job
-- runs every minute and does nothing, which is the correct behaviour for a
-- freshly restored database.
--
--   update automation_worker_config
--      set endpoint_url = 'https://…/api/workers/scheduled-actions',
--          shared_secret = '…',   -- must equal AUTOMATION_WORKER_SECRET in the app
--          enabled = true;
create table automation_worker_config (
  id boolean primary key default true,
  endpoint_url text,
  shared_secret text,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint automation_worker_config_singleton check (id)
);

insert into automation_worker_config (id) values (true);

create trigger automation_worker_config_updated_at before update on automation_worker_config
  for each row execute function set_updated_at();

-- This row holds a credential, so unlike every other internal table it is *not*
-- readable by `authenticated`. RLS is on with no policy at all, which denies
-- every role that does not bypass it; only the service role and the migration
-- owner can see the secret. The default table grants are revoked as well, so the
-- table is off the PostgREST surface entirely rather than merely returning zero
-- rows.
alter table automation_worker_config enable row level security;
revoke all on table automation_worker_config from anon;
revoke all on table automation_worker_config from authenticated;

-- The doorbell.
--
-- SECURITY DEFINER because pg_cron runs it as the job owner and it has to read
-- the secret, which no other role can. It returns the pg_net request id, or null
-- when there was nothing to do — `cron.job_run_details` then shows at a glance
-- whether a minute did any work.
create or replace function dispatch_due_scheduled_actions(p_now timestamptz default now())
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config automation_worker_config%rowtype;
  v_request_id bigint;
begin
  select * into v_config from automation_worker_config where id;

  if not found or not v_config.enabled or coalesce(v_config.endpoint_url, '') = '' then
    return null;
  end if;

  -- Don't wake the app for an empty queue. This is the same predicate the
  -- partial index in 0019 covers, so it costs an index probe.
  if not exists (
    select 1 from scheduled_actions
     where status = 'pending' and scheduled_for <= p_now
  ) then
    return null;
  end if;

  select net.http_post(
    url := v_config.endpoint_url,
    body := jsonb_build_object('source', 'pg_cron'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-worker-secret', coalesce(v_config.shared_secret, '')
    ),
    timeout_milliseconds := 30000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke execute on function public.dispatch_due_scheduled_actions(timestamptz) from anon;
revoke execute on function public.dispatch_due_scheduled_actions(timestamptz) from authenticated;

-- Every minute. AUT-4's default email delay is about an hour and the shortest
-- delay a user can set is zero, so minute granularity is the finest resolution
-- the product can express; anything tighter would only add load.
do $$
begin
  perform cron.unschedule('brainbox-scheduled-actions');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'brainbox-scheduled-actions',
  '* * * * *',
  $job$select public.dispatch_due_scheduled_actions()$job$
);
