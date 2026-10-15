-- L4 — the guarantees migrations 0034 and 0035 put in the database for
-- scheduled and delayed send.
--
-- These are the properties the application cannot be trusted to hold, because
-- there are two writers to `messages` — the Route Handler a recruiter drives and
-- the pg_cron-woken worker — and they run concurrently by design:
--
--   * a due message is claimable exactly once, however many workers ask;
--   * the state machine is total, so no code path can invent a transition;
--   * a cancelled message is out of the queue for good and never sends;
--   * a message a worker has already claimed cannot be cancelled out from under
--     an in-flight relay call;
--   * a failed send always says why.
--
-- Everything takes its instant as a parameter, so a "due" message is one whose
-- scheduled_for is in the past relative to the `p_now` the test passes — no test
-- here waits for a clock.
--
-- Wrapped in a transaction that is rolled back; runtests() also savepoints each
-- test function, so nothing survives on the development database. Fixture email
-- addresses are @example.com so that a stray real send could never reach a live
-- inbox.
begin;

create schema if not exists tap;

-- One candidate and one outbound message scheduled `p_offset` from now.
create function tap.schedule_message(p_offset interval)
returns uuid
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_person_id uuid;
  v_message_id uuid;
begin
  insert into people (first_name, email)
  values ('Pgtap', ('pgtap-sched-' || v_seed || '@example.com')::citext)
  returning id into v_person_id;

  insert into messages (person_id, direction, to_address, subject, body, status, scheduled_for)
  values (v_person_id, 'outbound', 'pgtap-sched-' || v_seed || '@example.com',
          'pgTAP scheduled subject', '<p>later</p>', 'scheduled', now() + p_offset)
  returning id into v_message_id;

  return v_message_id;
end;
$fn$;


-- ── The claim is the exactly-once mechanism ──────────────────────────────────

create function tap.test_a_due_message_is_claimed_exactly_once()
returns setof text
language plpgsql
as $fn$
declare
  v_message_id uuid;
  v_first int;
  v_second int;
  v_status text;
  v_claimed_at timestamptz;
begin
  v_message_id := tap.schedule_message('-1 minute');

  select count(*)::int into v_first
  from claim_due_messages(now(), 100) as claimed(id)
  where claimed.id = v_message_id;

  -- A second run a full minute later. Overlapping pg_cron invocations look
  -- exactly like this, and the second must find nothing left to take.
  select count(*)::int into v_second
  from claim_due_messages(now() + interval '1 minute', 100) as claimed(id)
  where claimed.id = v_message_id;

  select status, send_claimed_at into v_status, v_claimed_at
  from messages where id = v_message_id;

  return next is(v_first, 1, 'the first worker claims the due message');
  return next is(v_second, 0, 'a second worker cannot claim the same message again');
  return next is(v_status, 'sending', 'the claim moved the row out of the due predicate');
  return next ok(v_claimed_at is not null,
    'the claim is stamped, so a worker that dies mid-batch is visible rather than silent');
end;
$fn$;

create function tap.test_a_message_that_is_not_yet_due_is_left_alone()
returns setof text
language plpgsql
as $fn$
declare
  v_message_id uuid;
  v_claimed int;
  v_status text;
begin
  v_message_id := tap.schedule_message('1 hour');

  select count(*)::int into v_claimed
  from claim_due_messages(now(), 100) as claimed(id)
  where claimed.id = v_message_id;

  select status into v_status from messages where id = v_message_id;

  return next is(v_claimed, 0, 'a message an hour out is not claimed now');
  return next is(v_status, 'scheduled', 'and it is still waiting in the queue');
end;
$fn$;

create function tap.test_claiming_respects_the_batch_limit()
returns setof text
language plpgsql
as $fn$
declare
  v_first uuid;
  v_second uuid;
  v_claimed int;
begin
  v_first := tap.schedule_message('-10 minutes');
  v_second := tap.schedule_message('-5 minutes');

  select count(*)::int into v_claimed
  from claim_due_messages(now(), 1) as claimed(id)
  where claimed.id in (v_first, v_second);

  return next is(v_claimed, 1, 'a batch of one takes one of the two due messages');
end;
$fn$;

create function tap.test_only_outbound_messages_are_claimed()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_person_id uuid;
  v_message_id uuid;
  v_claimed int;
begin
  insert into people (first_name, email)
  values ('Pgtap', ('pgtap-in-' || v_seed || '@example.com')::citext)
  returning id into v_person_id;

  -- An inbound row can never carry a scheduled_for, so this is really a test
  -- that the constraint says so before the claim ever has to care.
  begin
    insert into messages (person_id, direction, status, scheduled_for)
    values (v_person_id, 'inbound', 'received', now() - interval '1 minute')
    returning id into v_message_id;
  exception when check_violation then
    v_message_id := null;
  end;

  select count(*)::int into v_claimed
  from claim_due_messages(now(), 100) as claimed(id)
  where claimed.id is not distinct from v_message_id;

  return next ok(v_message_id is null,
    'an inbound message cannot be given a scheduled_for at all');
  return next is(v_claimed, 0, 'so nothing inbound can reach the outbound send queue');
end;
$fn$;


-- ── The state machine is total ───────────────────────────────────────────────

create function tap.test_illegal_transitions_are_refused()
returns setof text
language plpgsql
as $fn$
declare
  v_message_id uuid;
  v_scheduled_to_sent boolean := false;
  v_scheduled_to_received boolean := false;
  v_sending_to_scheduled boolean := false;
  v_sent_to_scheduled boolean := false;
begin
  v_message_id := tap.schedule_message('-1 minute');

  -- Skipping the claim is the transition that would let two workers both send.
  begin
    update messages set status = 'sent', scheduled_for = null, sent_at = now()
     where id = v_message_id;
    v_scheduled_to_sent := true;
  exception when others then
    v_scheduled_to_sent := false;
  end;

  begin
    update messages set status = 'received', scheduled_for = null where id = v_message_id;
    v_scheduled_to_received := true;
  exception when others then
    v_scheduled_to_received := false;
  end;

  perform claim_due_messages(now(), 100);

  -- Putting a claimed row back in the queue would re-send it.
  begin
    update messages set status = 'scheduled', send_claimed_at = null where id = v_message_id;
    v_sending_to_scheduled := true;
  exception when others then
    v_sending_to_scheduled := false;
  end;

  perform complete_scheduled_message(v_message_id, 'sent', now());

  begin
    update messages
       set status = 'scheduled', scheduled_for = now() + interval '1 hour'
     where id = v_message_id;
    v_sent_to_scheduled := true;
  exception when others then
    v_sent_to_scheduled := false;
  end;

  return next ok(not v_scheduled_to_sent,
    'a scheduled message cannot jump straight to sent without being claimed');
  return next ok(not v_scheduled_to_received,
    'an outbound message cannot be relabelled as inbound mail');
  return next ok(not v_sending_to_scheduled,
    'a claimed message cannot be pushed back into the queue and sent twice');
  return next ok(not v_sent_to_scheduled,
    'a message that has gone out cannot be rescheduled — it cannot be recalled');
end;
$fn$;

create function tap.test_the_legal_path_is_walkable()
returns setof text
language plpgsql
as $fn$
declare
  v_message_id uuid;
  v_settled boolean;
  v_status text;
  v_scheduled_for timestamptz;
  v_sent_at timestamptz;
  v_relay text;
begin
  v_message_id := tap.schedule_message('-1 minute');
  perform claim_due_messages(now(), 100);

  v_settled := complete_scheduled_message(
    v_message_id, 'sent', now(), null, 'Talent <talent@example.com>', 'relay-123', 'rfc-123'
  );

  select status, scheduled_for, sent_at, relay_message_id
    into v_status, v_scheduled_for, v_sent_at, v_relay
  from messages where id = v_message_id;

  return next ok(v_settled, 'settling a claimed message reports that it settled');
  return next is(v_status, 'sent', 'and the row is sent');
  return next ok(v_scheduled_for is null,
    'the queue field is cleared, so the row is out of the due predicate for good');
  return next ok(v_sent_at is not null, 'the send is timestamped');
  return next is(v_relay, 'relay-123', 'the relay id is recorded for reconciliation');
end;
$fn$;

create function tap.test_settling_a_row_nobody_claimed_does_nothing()
returns setof text
language plpgsql
as $fn$
declare
  v_message_id uuid;
  v_settled boolean;
  v_status text;
begin
  v_message_id := tap.schedule_message('-1 minute');

  v_settled := complete_scheduled_message(v_message_id, 'sent', now());
  select status into v_status from messages where id = v_message_id;

  return next ok(not v_settled,
    'a confused worker cannot settle a message it never claimed');
  return next is(v_status, 'scheduled', 'and the message is still waiting where it was');
end;
$fn$;

create function tap.test_a_failed_send_must_say_why()
returns setof text
language plpgsql
as $fn$
declare
  v_message_id uuid;
  v_reasonless boolean := false;
  v_settled boolean;
  v_reason text;
  v_hand_written boolean := false;
begin
  v_message_id := tap.schedule_message('-1 minute');
  perform claim_due_messages(now(), 100);

  begin
    perform complete_scheduled_message(v_message_id, 'failed', now());
    v_reasonless := true;
  exception when others then
    v_reasonless := false;
  end;

  begin
    update messages set status = 'failed', scheduled_for = null where id = v_message_id;
    v_hand_written := true;
  exception when others then
    v_hand_written := false;
  end;

  v_settled := complete_scheduled_message(
    v_message_id, 'failed', now(), 'the relay is unreachable'
  );
  select failure_reason into v_reason from messages where id = v_message_id;

  return next ok(not v_reasonless, 'a failure with no reason is refused');
  return next ok(not v_hand_written,
    'and a hand-written UPDATE cannot sneak a reasonless failure past it either');
  return next ok(v_settled, 'a failure with a reason settles');
  return next is(v_reason, 'the relay is unreachable',
    'and the reason is durable on the row, not only in a log');
end;
$fn$;

create function tap.test_complete_refuses_a_status_that_is_not_an_outcome()
returns setof text
language plpgsql
as $fn$
declare
  v_message_id uuid;
  v_cancelled boolean := false;
begin
  v_message_id := tap.schedule_message('-1 minute');
  perform claim_due_messages(now(), 100);

  begin
    perform complete_scheduled_message(v_message_id, 'cancelled', now(), 'changed my mind');
    v_cancelled := true;
  exception when others then
    v_cancelled := false;
  end;

  return next ok(not v_cancelled,
    'the settle function only ever writes sent or failed, never a queue state');
end;
$fn$;


-- ── Cancelling ───────────────────────────────────────────────────────────────

create function tap.test_a_cancelled_message_never_sends()
returns setof text
language plpgsql
as $fn$
declare
  v_message_id uuid;
  v_cancelled boolean;
  v_status text;
  v_cancelled_at timestamptz;
  v_claimed int;
begin
  v_message_id := tap.schedule_message('-1 minute');

  v_cancelled := cancel_scheduled_message(v_message_id, now());

  select status, cancelled_at into v_status, v_cancelled_at
  from messages where id = v_message_id;

  -- The whole point: it is past due, and the worker still never sees it.
  select count(*)::int into v_claimed
  from claim_due_messages(now() + interval '1 hour', 100) as claimed(id)
  where claimed.id = v_message_id;

  return next ok(v_cancelled, 'a scheduled message can be cancelled');
  return next is(v_status, 'cancelled', 'and the row says so');
  return next ok(v_cancelled_at is not null, 'and records when');
  return next is(v_claimed, 0,
    'a cancelled message is never claimed, however long past due it is');
end;
$fn$;

create function tap.test_a_claimed_message_cannot_be_cancelled()
returns setof text
language plpgsql
as $fn$
declare
  v_message_id uuid;
  v_cancelled boolean;
  v_status text;
begin
  v_message_id := tap.schedule_message('-1 minute');
  perform claim_due_messages(now(), 100);

  v_cancelled := cancel_scheduled_message(v_message_id, now());
  select status into v_status from messages where id = v_message_id;

  return next ok(not v_cancelled,
    'a cancel loses the race against a worker that already holds the row');
  return next is(v_status, 'sending',
    'because the relay call is in flight and an email cannot be recalled');
end;
$fn$;

create function tap.test_cancelling_is_idempotent_and_scoped()
returns setof text
language plpgsql
as $fn$
declare
  v_message_id uuid;
  v_first boolean;
  v_second boolean;
  v_missing boolean;
begin
  v_message_id := tap.schedule_message('-1 minute');

  v_first := cancel_scheduled_message(v_message_id, now());
  v_second := cancel_scheduled_message(v_message_id, now());
  v_missing := cancel_scheduled_message(gen_random_uuid(), now());

  return next ok(v_first, 'the first cancel takes');
  return next ok(not v_second,
    'the second reports false rather than rewriting a settled row');
  return next ok(not v_missing, 'cancelling a message that does not exist reports false');
end;
$fn$;


-- ── Shape and exposure ───────────────────────────────────────────────────────

create function tap.test_scheduled_send_columns_and_view_exist()
returns setof text
language plpgsql
as $fn$
begin
  return next has_column('public'::name, 'messages'::name, 'send_claimed_at'::name,
    'messages.send_claimed_at exists — the claim is recorded, not merely implied');
  return next has_column('public'::name, 'messages'::name, 'cancelled_at'::name,
    'messages.cancelled_at exists — a cancel is a fact with a time');
  return next has_view('public'::name, 'stalled_scheduled_messages'::name,
    'the stalled-send view exists, so a worker that died mid-batch is visible');
end;
$fn$;

create function tap.test_anon_cannot_reach_the_send_queue_functions()
returns setof text
language plpgsql
as $fn$
declare
  v_claim boolean;
  v_complete boolean;
  v_cancel boolean;
  v_view int;
begin
  v_claim := has_function_privilege('anon',
    'public.claim_due_messages(timestamptz, integer)', 'execute');
  v_complete := has_function_privilege('anon',
    'public.complete_scheduled_message(uuid, text, timestamptz, text, text, text, text)',
    'execute');
  v_cancel := has_function_privilege('anon',
    'public.cancel_scheduled_message(uuid, timestamptz)', 'execute');

  select count(*)::int into v_view
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'stalled_scheduled_messages'
    and grantee = 'anon';

  return next ok(not v_claim, 'anon cannot claim a due message');
  return next ok(not v_complete, 'anon cannot settle one');
  return next ok(not v_cancel, 'anon cannot cancel a candidate''s scheduled email');
  return next is(v_view, 0, 'anon has no grant on the stalled-send view');
end;
$fn$;

create function tap.test_the_doorbell_knocks_for_a_due_message()
returns setof text
language plpgsql
as $fn$
declare
  v_message_id uuid;
  v_source text;
begin
  v_message_id := tap.schedule_message('-1 minute');

  -- The worker is only ever woken when something is due. 0035 widened that
  -- predicate to cover `messages`; assert the widened half is present rather
  -- than firing a real pg_net POST from a test.
  select pg_get_functiondef(p.oid) into v_source
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'dispatch_due_scheduled_actions';

  return next ok(v_source like '%from messages%',
    'the cron doorbell looks at the message queue as well as the action queue');
  return next ok(
    exists (
      select 1 from messages
       where id = v_message_id
         and direction = 'outbound'
         and status = 'scheduled'
         and scheduled_for <= now()
    ),
    'and the fixture matches the predicate it scans for');
  return next ok(
    not has_function_privilege('authenticated',
      'public.dispatch_due_scheduled_actions(timestamptz)', 'execute'),
    'the doorbell stays off the API surface after 0035 replaced it');
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
