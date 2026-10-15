-- Two safety windows against a slip of the hand, both set in Settings.
--
--  * Automation safety delay. A candidate dragged into the wrong stage (Hired
--    instead of Interview) used to get that stage's email as soon as its own
--    delay ran out, and questionnaires and moves default to no delay at all.
--    Now every automated email and questionnaire waits at least this long after
--    the candidate enters the stage, whatever the action's own delay. Moving
--    them back out within the window cancels it (AUT-6), so nothing is sent.
--
--  * Send undo window. An email a person sends is held this long before it goes
--    out, with Undo and Send now. That part lives in the app; the value is kept
--    here beside the other.
--
-- And re-entry. AUT-3 fired a stage's actions only the first time a candidate
-- entered it, even when that first visit was a mistake whose actions were all
-- cancelled. Moving them there again later, on purpose, then sent nothing. Now
-- re-entering schedules each action that never ran for this candidate; one that
-- did run (sent, failed, skipped) is still never repeated.

-- ── Settings ─────────────────────────────────────────────────────────────────
create table email_timing_settings (
  id boolean primary key default true,  -- single-row table, like slack_config
  automation_safety_delay_minutes integer not null default 20,
  send_undo_minutes integer not null default 30,
  updated_at timestamptz not null default now(),
  constraint email_timing_settings_singleton check (id),
  constraint email_timing_settings_safety_range
    check (automation_safety_delay_minutes between 0 and 1440),
  constraint email_timing_settings_undo_range check (send_undo_minutes between 0 and 1440)
);

insert into email_timing_settings (id) values (true) on conflict (id) do nothing;

create trigger email_timing_settings_set_updated_at
  before update on email_timing_settings
  for each row execute function set_updated_at();

alter table email_timing_settings enable row level security;

create policy email_timing_settings_authenticated_all on email_timing_settings
  for all to authenticated using (true) with check (true);

revoke all on table public.email_timing_settings from anon;
grant select, insert, update, delete on table public.email_timing_settings to authenticated;
grant select, insert, update, delete on table public.email_timing_settings to service_role;


-- ── One queued row per action at a time ──────────────────────────────────────
--
-- The first-entry ledger used to be what stopped two simultaneous moves from
-- queueing a stage twice. Re-entry no longer stops at the ledger, so the queue
-- itself refuses a second live copy of the same action for the same candidate.
create unique index scheduled_actions_one_live_stage_action
  on scheduled_actions (application_id, stage_action_id)
  where kind = 'stage_action' and status in ('pending', 'claimed');


-- ── Scheduling: the safety delay and the re-entry rule ───────────────────────
create or replace function schedule_stage_actions(
  p_application_id uuid,
  p_position_stage_id uuid,
  p_now timestamptz
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_queued integer;
  v_safety integer;
begin
  -- Still recorded: first-entry time feeds reporting and time-in-stage.
  perform record_first_stage_entry(p_application_id, p_position_stage_id, p_now);

  select coalesce(max(automation_safety_delay_minutes), 0) into v_safety
    from email_timing_settings;

  insert into scheduled_actions (application_id, stage_action_id, origin_stage_id, scheduled_for)
  select p_application_id, sa.id, p_position_stage_id,
         p_now + make_interval(mins => case
           when sa.type in ('send_email', 'send_questionnaire')
             then greatest(sa.delay_minutes, v_safety)
           else sa.delay_minutes
         end)
    from stage_actions sa
   where sa.position_stage_id = p_position_stage_id
     and sa.enabled
     -- Only actions that never ran for this candidate. A cancelled row (they
     -- left before it was due, or someone cancelled it) does not count.
     and not exists (
       select 1 from scheduled_actions x
        where x.application_id = p_application_id
          and x.stage_action_id = sa.id
          and x.kind = 'stage_action'
          and x.status <> 'cancelled'
     )
  on conflict (application_id, stage_action_id)
    where kind = 'stage_action' and status in ('pending', 'claimed')
    do nothing;

  get diagnostics v_queued = row_count;
  return v_queued;
end;
$$;
