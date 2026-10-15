-- L4 — holding an email for later when the mail relay's daily limit is reached (0053).
--
-- The worker puts a claimed action (or a sending message) back in its queue for
-- just after the relay's reset. These tests pin that the deferral lands the row
-- as an ordinary waiting row with the new time, that only a claimed / sending
-- row can be deferred and only into the future, that the old transitions are
-- still the only other ways out, and that neither function is on the anonymous
-- API.
begin;

create schema if not exists tap;

create function tap.test_a_claimed_action_waits_again_until_the_reset()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := gen_random_uuid()::text;
  v_position_id uuid;
  v_person_id uuid;
  v_app_id uuid;
  v_action_id uuid;
  v_now timestamptz := now();
  v_reset timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc' + interval '1 day 5 minutes';
  v_row scheduled_actions%rowtype;
begin
  insert into positions (title, slug) values ('pgTAP defer', 'pgtap-defer-' || v_seed)
  returning id into v_position_id;
  insert into people (first_name, email) values ('pgTAP', 'pgtap-defer-' || v_seed || '@example.test')
  returning id into v_person_id;
  insert into applications (person_id, position_id) values (v_person_id, v_position_id)
  returning id into v_app_id;

  insert into scheduled_actions (application_id, scheduled_for, status, claimed_at)
  values (v_app_id, v_now - interval '1 minute', 'claimed', v_now)
  returning id into v_action_id;

  return next ok(
    defer_scheduled_action(v_action_id, v_reset, v_now),
    'a claimed action can be deferred'
  );

  select * into v_row from scheduled_actions where id = v_action_id;
  return next is(v_row.status::text, 'pending', 'it is waiting again');
  return next is(v_row.scheduled_for, v_reset, 'for the new time');
  return next ok(v_row.claimed_at is null and v_row.completed_at is null,
    'with no trace of the claim, like any waiting row');

  return next ok(
    not defer_scheduled_action(v_action_id, v_reset, v_now),
    'a row that is not claimed is left alone'
  );

  return next throws_ok(
    format('select defer_scheduled_action(%L, %L, %L)', v_action_id, v_now - interval '1 hour', v_now),
    'P0001',
    'defer_scheduled_action needs a time in the future',
    'it cannot be deferred into the past, where it would be refused again at once'
  );

  -- The other rules still hold: a finished row cannot be put back.
  update scheduled_actions set status = 'claimed', claimed_at = v_now where id = v_action_id;
  update scheduled_actions set status = 'sent', completed_at = v_now where id = v_action_id;
  return next throws_ok(
    format('update scheduled_actions set status = %L where id = %L', 'pending', v_action_id),
    'P0001',
    'A scheduled action cannot move from sent to pending',
    'a sent action can never go back into the queue'
  );
end;
$fn$;

create function tap.test_a_sending_message_is_scheduled_again_until_the_reset()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := gen_random_uuid()::text;
  v_person_id uuid;
  v_message_id uuid;
  v_now timestamptz := now();
  v_reset timestamptz := v_now + interval '6 hours';
  v_row messages%rowtype;
begin
  insert into people (first_name, email) values ('pgTAP', 'pgtap-defer-msg-' || v_seed || '@example.test')
  returning id into v_person_id;

  insert into messages (person_id, direction, to_address, subject, body, status, scheduled_for, send_claimed_at)
  values (v_person_id, 'outbound', 'pgtap@example.test', 'Hello', '<p>Hi</p>', 'sending', v_now, v_now)
  returning id into v_message_id;

  return next ok(
    defer_scheduled_message(v_message_id, v_reset, v_now),
    'a sending message can be deferred'
  );

  select * into v_row from messages where id = v_message_id;
  return next is(v_row.status, 'scheduled', 'it is scheduled again');
  return next is(v_row.scheduled_for, v_reset, 'for the new time');
  return next ok(v_row.send_claimed_at is null, 'with the claim cleared');

  return next ok(
    not defer_scheduled_message(v_message_id, v_reset, v_now),
    'a message that is not sending is left alone'
  );
end;
$fn$;

-- 0055: the backward step is the defer functions' alone. A hand-written UPDATE
-- that pushes a claimed row back would let it be sent twice, so it is refused,
-- and a defer earlier in the same transaction does not leave the door open.
create function tap.test_only_the_defer_functions_can_put_a_row_back()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := gen_random_uuid()::text;
  v_position_id uuid;
  v_person_id uuid;
  v_app_id uuid;
  v_deferred_action uuid;
  v_claimed_action uuid;
  v_deferred_message uuid;
  v_sending_message uuid;
  v_now timestamptz := now();
begin
  insert into positions (title, slug) values ('pgTAP defer guard', 'pgtap-defer-guard-' || v_seed)
  returning id into v_position_id;
  insert into people (first_name, email) values ('pgTAP', 'pgtap-defer-guard-' || v_seed || '@example.test')
  returning id into v_person_id;
  insert into applications (person_id, position_id) values (v_person_id, v_position_id)
  returning id into v_app_id;

  insert into scheduled_actions (application_id, scheduled_for, status, claimed_at)
  values (v_app_id, v_now, 'claimed', v_now) returning id into v_deferred_action;
  insert into scheduled_actions (application_id, scheduled_for, status, claimed_at)
  values (v_app_id, v_now, 'claimed', v_now) returning id into v_claimed_action;

  insert into messages (person_id, direction, to_address, subject, body, status, scheduled_for, send_claimed_at)
  values (v_person_id, 'outbound', 'pgtap@example.test', 'Hello', '<p>Hi</p>', 'sending', v_now, v_now)
  returning id into v_deferred_message;
  insert into messages (person_id, direction, to_address, subject, body, status, scheduled_for, send_claimed_at)
  values (v_person_id, 'outbound', 'pgtap@example.test', 'Hello', '<p>Hi</p>', 'sending', v_now, v_now)
  returning id into v_sending_message;

  perform defer_scheduled_action(v_deferred_action, v_now + interval '1 hour', v_now);
  perform defer_scheduled_message(v_deferred_message, v_now + interval '1 hour', v_now);

  return next throws_ok(
    format('update scheduled_actions set status = %L, claimed_at = null where id = %L',
           'pending', v_claimed_action),
    'P0001',
    'A scheduled action cannot move from claimed to pending',
    'a claimed action cannot be pushed back into the queue by hand'
  );

  return next throws_ok(
    format('update messages set status = %L, send_claimed_at = null where id = %L',
           'scheduled', v_sending_message),
    'P0001',
    'A message cannot move from sending to scheduled',
    'a sending message cannot be pushed back into the queue by hand'
  );
end;
$fn$;

create function tap.test_defer_functions_are_not_on_the_public_api()
returns setof text
language plpgsql
as $fn$
begin
  return next function_privs_are(
    'public'::name, 'defer_scheduled_action'::name,
    array['uuid', 'timestamp with time zone', 'timestamp with time zone']::name[],
    'anon'::name, array[]::name[],
    'anon cannot defer an automation'
  );
  return next function_privs_are(
    'public'::name, 'defer_scheduled_message'::name,
    array['uuid', 'timestamp with time zone', 'timestamp with time zone']::name[],
    'anon'::name, array[]::name[],
    'anon cannot defer a message'
  );
  return next is(
    (select count(*)::int
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('defer_scheduled_action', 'defer_scheduled_message')
        and coalesce(p.proconfig, array[]::text[]) @> array['search_path=public']),
    2,
    'both defer functions pin their search_path'
  );
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
