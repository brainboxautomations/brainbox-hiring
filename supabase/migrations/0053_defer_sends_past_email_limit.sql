-- Hold an email for later when the mail relay's daily limit is reached.
--
-- Resend's free plan sends 100 emails a day, reset at midnight UTC. Past that,
-- every send is refused, and both queues used to settle the refusal as
-- `failed`: an automated stage email, questionnaire or reminder was simply
-- never sent, and a scheduled message stayed failed. Now the worker puts the
-- row back in its queue for just after the reset instead.
--
-- One new transition per queue, each taken only through a function:
--
--   scheduled_actions   claimed ─► pending     (defer_scheduled_action)
--   messages            sending ─► scheduled   (defer_scheduled_message)
--
-- A deferred row is an ordinary waiting row again, so every existing rule
-- still applies when it comes due: cancel-on-move cancels it if the candidate
-- leaves the stage, the closed-position hold skips it, and the stage check is
-- re-run at execution time (AUT-7).


-- ── scheduled_actions: claimed may go back to pending ─────────────────────────
--
--   pending ─┬─► claimed ─┬─► sent
--            │      ▲     ├─► failed
--            │      └─────┤   (deferred: back to pending, later scheduled_for)
--            │            └─► skipped
--            └─► cancelled
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
    or (old.status = 'claimed' and new.status in ('sent', 'failed', 'skipped', 'pending'));

  if not v_legal then
    raise exception 'A scheduled action cannot move from % to %', old.status, new.status;
  end if;

  return new;
end;
$$;

-- Releases a claimed action to run again at p_until. Only a claimed row, and
-- only into the future: a deferral that came due at once would be claimed again
-- in the same minute and refused again.
create or replace function defer_scheduled_action(
  p_id uuid,
  p_until timestamptz,
  p_now timestamptz
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_until <= p_now then
    raise exception 'defer_scheduled_action needs a time in the future';
  end if;

  update scheduled_actions
     set status = 'pending',
         claimed_at = null,
         scheduled_for = p_until
   where id = p_id
     and status = 'claimed';

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;


-- ── messages: sending may go back to scheduled ───────────────────────────────
--
--   scheduled ─┬─► sending ─┬─► sent
--              │      ▲     ├─► failed
--              │      └─────┘   (deferred: back to scheduled, later scheduled_for)
--              └─► cancelled
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
    or (old.status = 'sending' and new.status in ('sent', 'failed', 'scheduled'));

  if not v_legal then
    raise exception 'A message cannot move from % to %', coalesce(old.status, 'null'),
      coalesce(new.status, 'null');
  end if;

  return new;
end;
$$;

create or replace function defer_scheduled_message(
  p_id uuid,
  p_until timestamptz,
  p_now timestamptz
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_until <= p_now then
    raise exception 'defer_scheduled_message needs a time in the future';
  end if;

  update messages
     set status = 'scheduled',
         send_claimed_at = null,
         scheduled_for = p_until
   where id = p_id
     and status = 'sending';

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;


-- ── Access ───────────────────────────────────────────────────────────────────
--
-- As 0021 and 0034: off PUBLIC and anon, granted back by name to the roles that
-- already drive the queues (the worker's service role, and authenticated, which
-- the L3 suite uses and which can already write both tables).
revoke execute on function public.defer_scheduled_action(uuid, timestamptz, timestamptz)
  from public, anon;
revoke execute on function public.defer_scheduled_message(uuid, timestamptz, timestamptz)
  from public, anon;

grant execute on function public.defer_scheduled_action(uuid, timestamptz, timestamptz)
  to authenticated, service_role;
grant execute on function public.defer_scheduled_message(uuid, timestamptz, timestamptz)
  to authenticated, service_role;
