-- Make the 0055 defer guard refuse a hand-written requeue in every session.
--
-- 0055 let a row go back into its queue only while the defer functions had set
-- brainbox.deferring_send. In a session that never set it, current_setting(…,
-- true) returns NULL, the comparison with 'on' is NULL, the whole legality
-- check is NULL, and `if not v_legal` does not raise on NULL — so the requeue
-- was let through after all. An unset mark now reads as off, so for any row
-- with a status the check is a plain true or false again. (A message whose old
-- status is NULL, a legacy row, is still let through exactly as before 0053.)

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
        and coalesce(current_setting('brainbox.deferring_send', true), '') = 'on');

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
        and coalesce(current_setting('brainbox.deferring_send', true), '') = 'on');

  if not v_legal then
    raise exception 'A message cannot move from % to %', coalesce(old.status, 'null'),
      coalesce(new.status, 'null');
  end if;

  return new;
end;
$$;
