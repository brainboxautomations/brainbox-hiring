-- EML-1 — scheduled and delayed send, part 2 of 2: waking the worker.
--
-- 0020 installed a doorbell: once a minute pg_cron asks whether any
-- `scheduled_actions` row is due and, if so, `pg_net`-POSTs
-- /api/workers/scheduled-actions. The handler claims rows and calls the one real
-- send path in `frontend/app/api/messages/_send.ts`.
--
-- A due `messages` row needs exactly the same treatment, and this migration
-- deliberately does NOT build a second doorbell for it. One cron job, one
-- endpoint, one shared secret, one row in `automation_worker_config` for an
-- operator to fill in. A second worker would mean a second secret to rotate, a
-- second job that can be paused independently of the first, and a second thing
-- to notice is broken. The two queues are different tables with different claim
-- functions, but they come due through one mechanism.
--
-- So the only change here is the predicate: knock when *either* queue has work.
-- The function keeps its 0020 name because `cron.job` references it by name and
-- `automation_worker_config.endpoint_url` is set by hand on each deployment;
-- renaming either would silently stop the engine on an existing database. The
-- name now reads as "dispatch due scheduled work" rather than strictly actions.
--
-- Both halves of the predicate are index probes. `scheduled_actions_pending_due_idx`
-- (0019) covers the first; `messages_due_outbound_idx` (0015) — which has waited
-- three milestones for a consumer — covers the second exactly.

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

  -- Don't wake the app for two empty queues.
  if not exists (
    select 1 from scheduled_actions
     where status = 'pending' and scheduled_for <= p_now
  ) and not exists (
    select 1 from messages
     where direction = 'outbound' and status = 'scheduled' and scheduled_for <= p_now
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

-- `create or replace` preserves the existing grants, but 0021's rule is worth
-- restating rather than relying on: this function is SECURITY DEFINER, reads a
-- shared secret and originates outbound HTTP. It belongs to the cron job's owner
-- and the service role, and to nobody else.
revoke execute on function public.dispatch_due_scheduled_actions(timestamptz)
  from public, anon, authenticated;
