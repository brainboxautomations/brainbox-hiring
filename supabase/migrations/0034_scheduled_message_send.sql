-- EML-1 — scheduled and delayed send, part 1 of 2: the state machine.
--
-- 0015 gave `messages` a `scheduled_for`, a `status` vocabulary and the partial
-- index `messages_due_outbound_idx`, and then stopped: nothing ever consumed a
-- due row. A message scheduled through the composer sat in the table forever and
-- silently never sent. This migration supplies the half that was missing.
--
-- The design is deliberately the same one the automation engine already uses
-- (0018 / 0019), because the failure it has to prevent is the same failure:
-- **an email that has gone out cannot be recalled**, so the queue must never be
-- able to hand the same row to two workers.
--
-- The lifecycle of an outbound message row after this migration:
--
--   (insert) ──► sent                  an immediate send; scheduled_for stays null
--   (insert) ──► failed                the relay rejected an immediate send
--   (insert) ──► scheduled ─┬─► sending ─┬─► sent     the worker delivered it
--                           │            └─► failed   the relay rejected it
--                           └─► cancelled             a human stopped it in time
--
-- `sending` is the claim. It is what makes the send exactly-once: the claim is a
-- status transition inside one statement, not a timing assumption, so two
-- overlapping worker runs take disjoint sets and a row that has been claimed can
-- never re-enter the due predicate.
--
-- `sending → cancelled` is absent on purpose, exactly as `claimed → cancelled`
-- is absent for scheduled_actions. Once a worker owns the row it is about to
-- call the mail relay, and a cancel must not race an in-flight send. The losing
-- move is the cancel.
--
-- Nothing here re-implements sending. pg_cron rings a doorbell (0035) and the
-- Next.js worker calls the one real send path in
-- `frontend/app/api/messages/_send.ts`.


-- ── Two new columns, both forensic ───────────────────────────────────────────

alter table messages
  -- Set when a worker claims the row for delivery, and kept through the terminal
  -- states. It is the record that this message came out of the scheduled queue
  -- rather than being sent inline, and — read against `sent_at` — how long the
  -- relay call took. A row sitting in `sending` with an old `send_claimed_at` is
  -- a worker that died mid-batch; see `stalled_scheduled_messages` below.
  add column send_claimed_at timestamptz,
  -- Set when a human cancels a scheduled send before a worker claims it.
  add column cancelled_at timestamptz;


-- ── The vocabulary ───────────────────────────────────────────────────────────
--
-- 0015 constrained `status` to scheduled / sent / failed / received. Two values
-- are added: `sending` (claimed by a worker) and `cancelled` (stopped by a
-- human). `status` is text rather than an enum, so this is a plain constraint
-- swap with no enum-value-in-the-same-transaction problem.
alter table messages drop constraint messages_status_check;

alter table messages
  add constraint messages_status_check
  check (
    status is null
    or status in ('scheduled', 'sending', 'cancelled', 'sent', 'failed', 'received')
  );


-- ── scheduled_for belongs to the states that have a pending send ─────────────
--
-- 0015's rule was "only a `scheduled` row may carry a scheduled_for", and the
-- reason it gave — a settled row with a scheduled_for would be picked up twice —
-- is one this migration takes seriously enough to keep rather than relax.
--
-- The three states that describe a send which has not yet gone out all need the
-- time: `scheduled` is waiting for it, `sending` is being delivered on account
-- of it, and `cancelled` is the record of a send that was stopped, where the
-- time it would have gone out is the only interesting fact left. Every other
-- state describes something that has already happened, so the queue field is
-- cleared. That is why `complete_scheduled_message` below nulls it: the row is
-- leaving the queue, and `send_claimed_at` plus `sent_at` are what remain.
alter table messages drop constraint messages_scheduled_for_matches_status;

alter table messages
  add constraint messages_scheduled_for_matches_status
  check (
    case
      when status in ('scheduled', 'sending', 'cancelled') then scheduled_for is not null
      else scheduled_for is null
    end
  );


-- ── Columns and status move together ─────────────────────────────────────────
--
-- The same discipline as `scheduled_actions_status_columns_check` in 0019: an
-- inconsistent row cannot be written by any code path, including a hand-written
-- UPDATE in psql. In particular a `failed` message must say why — silent
-- disappearance is not a state this table can be in.
alter table messages
  add constraint messages_send_state_columns_check
  check (
    case status
      when 'scheduled' then send_claimed_at is null and cancelled_at is null
      when 'sending' then send_claimed_at is not null and cancelled_at is null
      when 'cancelled' then send_claimed_at is null and cancelled_at is not null
      when 'failed' then failure_reason is not null and cancelled_at is null
      when 'sent' then cancelled_at is null
      else send_claimed_at is null and cancelled_at is null
    end
  );


-- ── The state machine, enforced where it cannot be routed around ─────────────
--
--   scheduled ─┬─► sending ─┬─► sent
--              │            └─► failed
--              └─► cancelled
--
-- Inserts are not governed here: an immediate send inserts `sent` or `failed`
-- directly (the send-then-record ordering in `_send.ts`), and the inbound
-- webhook inserts `received`. Only transitions are constrained, and the set of
-- legal ones is total — anything not listed raises.
--
-- The guard compares status only, so a row can still be updated for other
-- reasons — re-threading, an `on delete set null` foreign key — after it has
-- settled.
create or replace function guard_message_send_status()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_legal boolean;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  v_legal :=
    (old.status = 'scheduled' and new.status in ('sending', 'cancelled'))
    or (old.status = 'sending' and new.status in ('sent', 'failed'));

  if not v_legal then
    raise exception 'A message cannot move from % to %', coalesce(old.status, 'null'),
      coalesce(new.status, 'null');
  end if;

  return new;
end;
$$;

create trigger messages_send_status_transition
  before update on messages
  for each row execute function guard_message_send_status();


-- ── Claiming: the exactly-once mechanism, and it is one statement ────────────
--
-- Identical in shape to `claim_due_scheduled_actions` (0019), and identical in
-- what it buys. `for update skip locked` means two workers running at the same
-- instant take disjoint sets: the second does not block and does not see the
-- first's rows. The move to `sending` then removes the row from the due
-- predicate permanently, so a worker that starts a minute later cannot pick it
-- up either. Nothing depends on a lease, on cron runs not overlapping, or on any
-- clock but the one `p_now` carries.
--
-- `p_now` is a parameter rather than `now()` so that tests can control it.
create or replace function claim_due_messages(
  p_now timestamptz,
  p_limit integer
)
returns setof uuid
language sql
set search_path = public
as $$
  with due as (
    select id
      from messages
     where direction = 'outbound'
       and status = 'scheduled'
       and scheduled_for <= p_now
     order by scheduled_for, created_at
     limit greatest(coalesce(p_limit, 0), 0)
       for update skip locked
  )
  update messages m
     set status = 'sending',
         send_claimed_at = p_now
    from due
   where m.id = due.id
  returning m.id;
$$;


-- ── Settling a claimed row ───────────────────────────────────────────────────
--
-- Only a row in `sending`. If the id names anything else the function reports
-- false rather than forcing a transition, so a confused worker cannot overwrite
-- a terminal outcome. `failed` without a reason is refused outright rather than
-- being caught by the check constraint, because the error a caller sees should
-- name the actual mistake.
--
-- The relay's own identifiers are recorded on success: `from_address` is the
-- header the relay actually used, and `rfc_message_id` is what inbound threading
-- (0017) matches replies against.
create or replace function complete_scheduled_message(
  p_id uuid,
  p_status text,
  p_now timestamptz,
  p_failure_reason text default null,
  p_from_address text default null,
  p_relay_message_id text default null,
  p_rfc_message_id text default null
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'complete_scheduled_message only settles a row as sent or failed';
  end if;

  if p_status = 'failed' and coalesce(p_failure_reason, '') = '' then
    raise exception 'A failed message must record why it failed';
  end if;

  update messages
     set status = p_status,
         scheduled_for = null,
         sent_at = case when p_status = 'sent' then p_now else sent_at end,
         failure_reason = case when p_status = 'sent' then null else p_failure_reason end,
         from_address = coalesce(p_from_address, from_address),
         relay_message_id = coalesce(p_relay_message_id, relay_message_id),
         rfc_message_id = coalesce(p_rfc_message_id, rfc_message_id)
   where id = p_id
     and status = 'sending';

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;


-- ── Cancelling a scheduled send ──────────────────────────────────────────────
--
-- EML-1's composer lets a user schedule by mistake, so it has to let them stop
-- it. Only a row still in `scheduled` can be cancelled: once it is `sending` the
-- relay call is already in flight and the answer is honestly "too late", which
-- is what `false` means here. The caller turns that into a message the user can
-- act on rather than pretending the cancel worked.
create or replace function cancel_scheduled_message(
  p_id uuid,
  p_now timestamptz
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_updated integer;
begin
  update messages
     set status = 'cancelled',
         cancelled_at = p_now
   where id = p_id
     and status = 'scheduled'
     and direction = 'outbound';

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;


-- ── Operator visibility ──────────────────────────────────────────────────────
--
-- A worker that dies between claiming a message and settling it leaves the row
-- in `sending` forever: no lease expiry, no automatic retry, no second delivery.
-- That is the same deliberate trade `stalled_scheduled_actions` documents, and
-- it is only defensible if it is visible. Anything in this view for more than a
-- few minutes is a candidate whose email did not go out, and re-queueing it is a
-- human act.
create view stalled_scheduled_messages
with (security_invoker = true)
as
  select
    m.id,
    m.person_id,
    m.application_id,
    m.thread_id,
    m.to_address,
    m.subject,
    m.scheduled_for,
    m.send_claimed_at,
    now() - m.send_claimed_at as claimed_for
  from messages m
  where m.status = 'sending';


-- ── Access ───────────────────────────────────────────────────────────────────
--
-- The complete rule from 0021: a new function in `public` carries an implicit
-- EXECUTE grant to PUBLIC *and* the Supabase default-privileges grants to anon
-- and authenticated. Revoking one without the other leaves it on the public
-- internet, so every one of these is revoked from both, then granted back by
-- name.
--
-- `authenticated` keeps the claim and settle functions for the same reason 0021
-- gives: Phase 1 has one shared access level, a signed-in user can already write
-- `messages` directly, and withholding EXECUTE would only push callers towards
-- raw UPDATEs that the transition trigger would then have to catch. The L3 suite
-- drives the worker through an authenticated session for exactly this reason.
revoke execute on function public.guard_message_send_status()
  from public, anon, authenticated;

revoke execute on function public.claim_due_messages(timestamptz, integer)
  from public, anon;
revoke execute on function
  public.complete_scheduled_message(uuid, text, timestamptz, text, text, text, text)
  from public, anon;
revoke execute on function public.cancel_scheduled_message(uuid, timestamptz)
  from public, anon;

grant execute on function public.claim_due_messages(timestamptz, integer)
  to authenticated, service_role;
grant execute on function
  public.complete_scheduled_message(uuid, text, timestamptz, text, text, text, text)
  to authenticated, service_role;
grant execute on function public.cancel_scheduled_message(uuid, timestamptz)
  to authenticated, service_role;

-- The view inherits `messages`' RLS through security_invoker, so anon already
-- saw nothing through it. Off the PostgREST surface entirely is better than
-- empty — the same treatment 0021 gave `stalled_scheduled_actions`.
revoke all on table public.stalled_scheduled_messages from public, anon;
grant select on table public.stalled_scheduled_messages to authenticated, service_role;
