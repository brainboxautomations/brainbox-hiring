-- Only the defer functions may put a row back in its queue.
--
-- 0053 added one backward transition per queue so the worker could hold a send
-- past the mail relay's daily limit:
--
--   scheduled_actions   claimed ─► pending     (defer_scheduled_action)
--   messages            sending ─► scheduled   (defer_scheduled_message)
--
-- but the status guards allowed it for any UPDATE, so a hand-written statement
-- could push a claimed row back into the queue and have it sent twice — the
-- very thing those guards exist to refuse. Now each defer function marks its
-- own transaction for the one update it makes, and the guards accept the
-- backward step only while that mark is set.

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
    or (old.status = 'claimed' and new.status in ('sent', 'failed', 'skipped'))
    or (old.status = 'claimed' and new.status = 'pending'
        and current_setting('brainbox.deferring_send', true) = 'on');

  if not v_legal then
    raise exception 'A scheduled action cannot move from % to %', old.status, new.status;
  end if;

  return new;
end;
$$;

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
    or (old.status = 'sending' and new.status in ('sent', 'failed'))
    or (old.status = 'sending' and new.status = 'scheduled'
        and current_setting('brainbox.deferring_send', true) = 'on');

  if not v_legal then
    raise exception 'A message cannot move from % to %', coalesce(old.status, 'null'),
      coalesce(new.status, 'null');
  end if;

  return new;
end;
$$;

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

  perform set_config('brainbox.deferring_send', 'on', true);

  update scheduled_actions
     set status = 'pending',
         claimed_at = null,
         scheduled_for = p_until
   where id = p_id
     and status = 'claimed';

  get diagnostics v_updated = row_count;
  perform set_config('brainbox.deferring_send', 'off', true);
  return v_updated = 1;
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

  perform set_config('brainbox.deferring_send', 'on', true);

  update messages
     set status = 'scheduled',
         send_claimed_at = null,
         scheduled_for = p_until
   where id = p_id
     and status = 'sending';

  get diagnostics v_updated = row_count;
  perform set_config('brainbox.deferring_send', 'off', true);
  return v_updated = 1;
end;
$$;
