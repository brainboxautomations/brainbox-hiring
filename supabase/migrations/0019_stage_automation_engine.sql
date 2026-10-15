-- M6a — the automation engine, part 2 of 3: producer, ledger, state machine.
--
-- PRD §7.2–7.3 (AUT-1 … AUT-7) plus PUB-6. `stage_actions` and
-- `scheduled_actions` have existed since 0001 and held no logic at all.
--
-- Everything that has to be true regardless of which code path caused a stage
-- change lives in this file, in the database, because there are three such paths
-- and there will be more:
--
--   * PATCH /api/applications/[id]      — a recruiter drags a card
--   * POST  /api/applications/bulk      — a bulk move
--   * submit_application()              — a public applicant lands at stage 1 (PUB-6)
--
-- Putting the producer in a Route Handler would mean the public intake path
-- silently never fires anything, and "fire only on first entry" would be a check
-- any future caller could forget. So the producer is an AFTER trigger on
-- `applications`, and there is exactly one of it.
--
-- Time is a parameter throughout. Every function below takes the instant it
-- should reason about; only the trigger reads `now()`, and it passes it down.
-- That is what makes the delay arithmetic and the due-date predicate assertable
-- from pgTAP without waiting an hour for an email to come due.


-- ── Stage actions: make an unusable configuration unrepresentable ────────────

-- AUT-4: every action carries a delay, and the delay is the undo window. A
-- negative delay would schedule into the past and fire immediately, destroying
-- that window; the upper bound is a sanity rail, not a product rule.
alter table stage_actions
  add constraint stage_actions_delay_minutes_check
  check (delay_minutes >= 0 and delay_minutes <= 129600);

-- AUT-2: three action types, each with exactly one shaped payload. This checks
-- only that the *wrong* columns are empty, never that the right one is filled —
-- `message_template_id`, `questionnaire_template_id` and
-- `target_position_stage_id` are all `on delete set null`, so a perfectly valid
-- action becomes a dangling one the moment its template or target stage is
-- deleted. Requiring them here would make those deletes fail instead. A dangling
-- action is a real state — the worker settles it as `skipped` with a reason
-- naming what is missing — so it has to be storable.
alter table stage_actions
  add constraint stage_actions_payload_matches_type_check
  check (
    case type
      when 'send_email' then
        questionnaire_template_id is null and target_position_stage_id is null
      when 'send_questionnaire' then
        message_template_id is null and target_position_stage_id is null
      when 'move_to_stage' then
        message_template_id is null and questionnaire_template_id is null
    end
  );

-- A move_to_stage action must point at a stage on its own position. This cannot
-- be a check constraint — it spans two rows of position_stages — and it must not
-- be left to the API, because "move the candidate to a stage belonging to a
-- different position" is the single worst thing this engine could do.
create or replace function guard_stage_action_target()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_own_position uuid;
  v_target_position uuid;
begin
  if new.target_position_stage_id is null then
    return new;
  end if;

  select position_id into v_own_position
    from position_stages where id = new.position_stage_id;

  select position_id into v_target_position
    from position_stages where id = new.target_position_stage_id;

  if v_own_position is distinct from v_target_position then
    raise exception
      'A stage action can only move a candidate to a stage on its own position';
  end if;

  return new;
end;
$$;

create trigger stage_actions_target_on_same_position
  before insert or update on stage_actions
  for each row execute function guard_stage_action_target();


-- ── The first-entry ledger (AUT-3) ───────────────────────────────────────────
--
-- "Actions fire only the first time a candidate enters a stage." That needs a
-- durable record of which stages a candidacy has already visited, because the
-- queue itself cannot answer it: a stage that had no actions when the candidate
-- first passed through leaves no queue rows behind, and if actions were added
-- afterwards a re-entry would fire them. One row per (application, stage), a
-- unique constraint, and the insert is the test.
create table application_stage_entries (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  position_stage_id uuid not null references position_stages (id) on delete cascade,
  first_entered_at timestamptz not null default now(),
  unique (application_id, position_stage_id)
);
create index application_stage_entries_application_idx
  on application_stage_entries (application_id);


-- ── The queue row grows a lifecycle ──────────────────────────────────────────

alter table scheduled_actions
  -- Set when a worker claims the row. Also the forensic record after a crash:
  -- a row sitting in `claimed` says a worker took it and never came back.
  add column claimed_at timestamptz,
  -- Set when the row reaches any terminal state.
  add column completed_at timestamptz,
  -- Why it failed or was skipped. Never null for those two states.
  add column failure_reason text,
  -- The message the action produced, when it produced one. Nullable: a
  -- move_to_stage sends nothing, and a relay rejection may not record a row.
  add column message_id uuid references messages (id) on delete set null;

-- Columns and status move together, so an inconsistent row cannot be written by
-- any code path at all. `sent` here means "the action executed" — a
-- move_to_stage that moved the candidate is `sent` with no message attached.
alter table scheduled_actions
  add constraint scheduled_actions_status_columns_check
  check (
    case status
      when 'pending' then
        claimed_at is null and completed_at is null
        and failure_reason is null and message_id is null
      when 'claimed' then
        claimed_at is not null and completed_at is null
        and failure_reason is null and message_id is null
      when 'cancelled' then
        claimed_at is null and completed_at is not null and failure_reason is null
      when 'sent' then
        claimed_at is not null and completed_at is not null and failure_reason is null
      when 'failed' then
        claimed_at is not null and completed_at is not null and failure_reason is not null
      when 'skipped' then
        claimed_at is not null and completed_at is not null and failure_reason is not null
    end
  );

-- The state machine, enforced where it cannot be routed around.
--
--   pending ─┬─► claimed ─┬─► sent
--            │            ├─► failed
--            │            └─► skipped
--            └─► cancelled
--
-- `claimed → cancelled` is absent on purpose. Once a worker owns a row it is
-- about to talk to the mail relay, and cancel-on-move must not race an in-flight
-- send: an email that has gone out cannot be recalled (AUT-6), so the losing
-- move is the cancel, not the send.
--
-- The guard compares status only. Terminal rows still receive updates from the
-- `on delete set null` foreign keys when a stage or a stage action is deleted,
-- and blocking those would make deleting a stage fail once anything had ever
-- fired from it.
create or replace function guard_scheduled_action_status()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_legal boolean;
begin
  if old.status = new.status then
    return new;
  end if;

  v_legal :=
    (old.status = 'pending' and new.status in ('claimed', 'cancelled'))
    or (old.status = 'claimed' and new.status in ('sent', 'failed', 'skipped'));

  if not v_legal then
    raise exception 'A scheduled action cannot move from % to %', old.status, new.status;
  end if;

  return new;
end;
$$;

create trigger scheduled_actions_status_transition
  before update on scheduled_actions
  for each row execute function guard_scheduled_action_status();

-- The worker's pickup predicate, and nothing else. Partial, so the index holds
-- only the live queue however long the history grows — the same shape as
-- `messages_due_outbound_idx` from 0015.
create index scheduled_actions_pending_due_idx
  on scheduled_actions (scheduled_for)
  where status = 'pending';

-- Cancel-on-move's lookup: everything still pending from one stage of one
-- candidacy.
create index scheduled_actions_pending_origin_idx
  on scheduled_actions (application_id, origin_stage_id)
  where status = 'pending';


-- ── D2: resolving a template stage to a position's own stage ─────────────────
--
-- Questionnaires are global templates, so answer routing can only name a
-- `pipeline_template_stage_id`; the stage a candidate actually moves to is a
-- `position_stages` row belonging to their position. `source_template_stage_id`
-- (0001) is the link, and it is `on delete set null` — deleting a template stage
-- severs it permanently.
--
-- This function returns NULL when the link is broken. That is the whole point.
-- Callers must leave the candidate where they are and record why; there is no
-- "nearest stage", no "first stage", no "next stage" fallback anywhere in this
-- engine. A silent wrong move in an ATS is worse than no move.
create or replace function position_stage_for_template_stage(
  p_position_id uuid,
  p_template_stage_id uuid
)
returns uuid
language sql
stable
set search_path = public
as $$
  select ps.id
    from position_stages ps
   where ps.position_id = p_position_id
     and ps.source_template_stage_id = p_template_stage_id
   order by ps.sort_order
   limit 1;
$$;


-- ── The producer (AUT-3, AUT-5) ──────────────────────────────────────────────

-- Records that this candidacy has reached this stage. Returns true only the
-- first time. The unique constraint is what makes it safe under concurrency —
-- two simultaneous moves cannot both see "first entry".
create or replace function record_first_stage_entry(
  p_application_id uuid,
  p_position_stage_id uuid,
  p_at timestamptz
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_inserted uuid;
begin
  insert into application_stage_entries (application_id, position_stage_id, first_entered_at)
  values (p_application_id, p_position_stage_id, p_at)
  on conflict (application_id, position_stage_id) do nothing
  returning id into v_inserted;

  return v_inserted is not null;
end;
$$;

-- AUT-5: writes every enabled action on the stage into the queue, each with its
-- own delay counted from `p_now`. AUT-1 — the actions are independent; there is
-- no ordering engine, `sort_order` only decides how they read in the editor.
--
-- Returns the number of rows queued: 0 when the stage has no enabled actions,
-- and 0 when this is a re-entry (AUT-3).
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
begin
  if not record_first_stage_entry(p_application_id, p_position_stage_id, p_now) then
    return 0;
  end if;

  insert into scheduled_actions (application_id, stage_action_id, origin_stage_id, scheduled_for)
  select p_application_id, sa.id, p_position_stage_id,
         p_now + make_interval(mins => sa.delay_minutes)
    from stage_actions sa
   where sa.position_stage_id = p_position_stage_id
     and sa.enabled;

  get diagnostics v_queued = row_count;
  return v_queued;
end;
$$;

-- AUT-6: leaving a stage cancels everything still pending from it. Rows that
-- already reached a terminal state are untouched — an email that has been sent
-- is not recalled, and a row a worker has claimed is not stolen back.
create or replace function cancel_pending_stage_actions(
  p_application_id uuid,
  p_origin_stage_id uuid,
  p_now timestamptz
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_cancelled integer;
begin
  update scheduled_actions
     set status = 'cancelled',
         completed_at = p_now
   where application_id = p_application_id
     and origin_stage_id = p_origin_stage_id
     and status = 'pending';

  get diagnostics v_cancelled = row_count;
  return v_cancelled;
end;
$$;

-- The one place a stage change turns into queue activity. Fires for every
-- writer: the API, a bulk move, the public intake RPC, a psql session, and the
-- worker's own move_to_stage.
create or replace function apply_stage_automation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if tg_op = 'INSERT' then
    if new.current_stage_id is not null then
      perform schedule_stage_actions(new.id, new.current_stage_id, v_now);
    end if;
    return null;
  end if;

  if old.current_stage_id is not distinct from new.current_stage_id then
    return null;
  end if;

  -- Cancel before scheduling. The two stages are different by the test above, so
  -- the order cannot matter for correctness, but reading the queue afterwards is
  -- much clearer when the outgoing stage is settled first.
  if old.current_stage_id is not null then
    perform cancel_pending_stage_actions(new.id, old.current_stage_id, v_now);
  end if;

  if new.current_stage_id is not null then
    perform schedule_stage_actions(new.id, new.current_stage_id, v_now);
  end if;

  return null;
end;
$$;

create trigger applications_stage_automation
  after insert or update of current_stage_id on applications
  for each row execute function apply_stage_automation();

-- Deleting a stage action must not leave orphaned work in the queue.
-- `scheduled_actions.stage_action_id` is `on delete set null`, which preserves
-- the history of what already fired but would leave a pending row that no longer
-- describes anything. Cancel those first, while the link still exists.
create or replace function cancel_pending_actions_for_deleted_stage_action()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update scheduled_actions
     set status = 'cancelled',
         completed_at = now()
   where stage_action_id = old.id
     and status = 'pending';

  return old;
end;
$$;

create trigger stage_actions_cancel_pending_on_delete
  before delete on stage_actions
  for each row execute function cancel_pending_actions_for_deleted_stage_action();


-- ── The worker's two RPCs (AUT-7) ────────────────────────────────────────────

-- Claiming is the exactly-once mechanism, and it is one statement.
--
-- `for update skip locked` means two workers running at the same moment take
-- disjoint sets: the second does not block, and it does not see the rows the
-- first is claiming. The status change to `claimed` then removes the row from
-- the pending predicate for good, so even a worker that starts a minute later
-- cannot pick it up again. Nothing here depends on timing, on a lease, or on the
-- cron schedule not overlapping.
create or replace function claim_due_scheduled_actions(
  p_now timestamptz,
  p_limit integer
)
returns setof uuid
language sql
set search_path = public
as $$
  with due as (
    select id
      from scheduled_actions
     where status = 'pending'
       and scheduled_for <= p_now
     order by scheduled_for, created_at
     limit greatest(coalesce(p_limit, 0), 0)
       for update skip locked
  )
  update scheduled_actions sa
     set status = 'claimed',
         claimed_at = p_now
    from due
   where sa.id = due.id
  returning sa.id;
$$;

-- Settles a claimed row. Only a claimed row: if the id names something else the
-- function reports false rather than forcing a transition, so a confused worker
-- cannot overwrite a terminal outcome.
--
-- `failed` and `skipped` both require a reason, enforced by the check constraint
-- above. Silent disappearance is not a state this queue can be in.
create or replace function complete_scheduled_action(
  p_id uuid,
  p_status scheduled_action_status,
  p_now timestamptz,
  p_failure_reason text default null,
  p_message_id uuid default null
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'complete_scheduled_action only settles a row as sent, failed or skipped';
  end if;

  update scheduled_actions
     set status = p_status,
         completed_at = p_now,
         failure_reason = case when p_status = 'sent' then null else p_failure_reason end,
         message_id = p_message_id
   where id = p_id
     and status = 'claimed';

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;


-- ── Operator visibility ──────────────────────────────────────────────────────
--
-- A worker that dies between claiming a row and settling it leaves that row in
-- `claimed` forever. That is deliberate — see the note on the state machine
-- above and `docs/architecture.md` — but it must be visible rather than merely
-- silent, because a stuck row is a candidate who is not getting their email.
create view stalled_scheduled_actions
with (security_invoker = true)
as
  select
    sa.id,
    sa.application_id,
    sa.stage_action_id,
    sa.origin_stage_id,
    sa.scheduled_for,
    sa.claimed_at,
    now() - sa.claimed_at as claimed_for
  from scheduled_actions sa
  where sa.status = 'claimed';


-- ── Access ───────────────────────────────────────────────────────────────────
--
-- Per 0014: every function added to `public` on this project is granted EXECUTE
-- to anon and authenticated at creation time by a default-privileges rule.
-- Nothing here belongs on the anonymous surface, so every one is revoked from
-- anon by name. `revoke ... from public` alone would not do it.
revoke execute on function public.guard_stage_action_target() from anon;
revoke execute on function public.guard_scheduled_action_status() from anon;
revoke execute on function public.apply_stage_automation() from anon;
revoke execute on function public.cancel_pending_actions_for_deleted_stage_action() from anon;
revoke execute on function public.position_stage_for_template_stage(uuid, uuid) from anon;
revoke execute on function public.record_first_stage_entry(uuid, uuid, timestamptz) from anon;
revoke execute on function public.schedule_stage_actions(uuid, uuid, timestamptz) from anon;
revoke execute on function public.cancel_pending_stage_actions(uuid, uuid, timestamptz) from anon;
revoke execute on function public.claim_due_scheduled_actions(timestamptz, integer) from anon;
revoke execute on function
  public.complete_scheduled_action(uuid, scheduled_action_status, timestamptz, text, uuid)
  from anon;

revoke all on table public.stalled_scheduled_actions from anon;

-- The ledger follows the same access model as every other internal table (0003):
-- one shared access level, no roles. It is not a security boundary — an
-- authenticated user can already rewrite `applications` directly — it is the
-- record that makes AUT-3 hold for every code path rather than for whichever
-- ones remembered to check.
alter table application_stage_entries enable row level security;

create policy application_stage_entries_authenticated_all on application_stage_entries
  for all to authenticated using (true) with check (true);
