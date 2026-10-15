-- L4 — inbound email, threading and quarantine (migration 0017).
--
-- Four properties are asserted here, and every one of them fails silently if it
-- regresses.
--
-- 1. Idempotency is a database guarantee, not a handler convention. The inbound
--    webhook is retried by Resend on any non-2xx and on a timeout, so the same
--    email_id WILL arrive twice. The handler checks first, but a check-then-act
--    pair has a race in the middle. The unique index on
--    messages.inbound_email_id is what actually stops the duplicate row, and it
--    is the only thing that stops it under concurrency.
--
-- 2. Thread resolution is idempotent for the same reason. Two deliveries that
--    both fall back to subject matching must converge on one thread; the unique
--    index on (person_id, normalized_subject) is what makes the "select, else
--    insert, else re-select" in ensureThread safe.
--
-- 3. rfc_message_id is unique. Threading joins a reply's In-Reply-To against
--    this column; two rows sharing a Message-ID would make the join
--    non-deterministic, which is worse than failing.
--
-- 4. Neither new table is reachable by anon. `message_threads` exposes who is
--    talking to whom, and `unmatched_inbound_emails` holds whole email bodies
--    from senders we could not identify. The anon key ships in the browser
--    bundle, so "no public code path" is not protection on its own.
--
-- Role switching follows the L4 convention: seed as the session role, switch to
-- anon, capture into variables, `reset role`, then assert.
begin;

create schema if not exists tap;

create function tap.test_inbound_columns_exist()
returns setof text
language plpgsql
as $fn$
begin
  return next has_column('public'::name, 'messages'::name, 'rfc_message_id'::name,
    'messages.rfc_message_id exists — relay_message_id is not the RFC Message-ID a reply quotes');
  return next has_column('public'::name, 'messages'::name, 'inbound_email_id'::name,
    'messages.inbound_email_id exists — the webhook idempotency key');
  return next has_column('public'::name, 'messages'::name, 'headers'::name,
    'messages.headers exists — In-Reply-To and References are kept verbatim');
  return next col_type_is('public'::name, 'messages'::name, 'headers'::name, 'jsonb'::text,
    'headers is jsonb, and is normalized at the mapper border');
  return next col_type_is('public'::name, 'messages'::name, 'thread_id'::name, 'uuid'::text,
    'thread_id is a uuid foreign key, not the bare text column 0001 shipped');
  return next has_index('public'::name, 'messages'::name, 'messages_inbound_email_id_key'::name,
    'the unique index that makes a webhook retry a no-op exists');
  return next has_index('public'::name, 'messages'::name, 'messages_rfc_message_id_key'::name,
    'the unique index threading joins against exists');
end;
$fn$;

create function tap.test_a_retried_webhook_cannot_duplicate_a_message()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_person_id uuid;
  v_email_id text := 'email_' || v_seed;
  v_second_insert boolean := false;
  v_two_nulls boolean := false;
begin
  insert into people (first_name, email)
  values ('pgTAP', ('pgtap-' || v_seed || '@example.com')::citext)
  returning id into v_person_id;

  insert into messages (person_id, direction, status, inbound_email_id, subject)
  values (v_person_id, 'inbound', 'received', v_email_id, 'first delivery');

  -- Resend redelivers the same notification.
  begin
    insert into messages (person_id, direction, status, inbound_email_id, subject)
    values (v_person_id, 'inbound', 'received', v_email_id, 'retry');
    v_second_insert := true;
  exception when unique_violation then
    v_second_insert := false;
  end;

  -- The index is partial: outbound rows carry no inbound_email_id and must not
  -- collide with each other on null.
  begin
    insert into messages (person_id, direction, status, sent_at)
    values (v_person_id, 'outbound', 'sent', now());
    insert into messages (person_id, direction, status, sent_at)
    values (v_person_id, 'outbound', 'sent', now());
    v_two_nulls := true;
  exception when unique_violation then
    v_two_nulls := false;
  end;

  return next ok(not v_second_insert,
    'a redelivered email_id cannot create a second message row');
  return next ok(v_two_nulls,
    'the index is partial, so any number of outbound rows may carry no inbound_email_id');
end;
$fn$;

create function tap.test_rfc_message_id_is_unique()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_person_id uuid;
  v_message_id text := v_seed || '@ap-northeast-1.amazonses.com';
  v_duplicate boolean := false;
begin
  insert into people (first_name, email)
  values ('pgTAP', ('pgtap-' || v_seed || '@example.com')::citext)
  returning id into v_person_id;

  insert into messages (person_id, direction, status, sent_at, rfc_message_id)
  values (v_person_id, 'outbound', 'sent', now(), v_message_id);

  begin
    insert into messages (person_id, direction, status, sent_at, rfc_message_id)
    values (v_person_id, 'outbound', 'sent', now(), v_message_id);
    v_duplicate := true;
  exception when unique_violation then
    v_duplicate := false;
  end;

  return next ok(not v_duplicate,
    'two messages cannot share an RFC Message-ID, so threading stays deterministic');
end;
$fn$;

create function tap.test_one_thread_per_person_and_subject()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_person_a uuid;
  v_person_b uuid;
  v_thread_id uuid;
  v_duplicate boolean := false;
  v_other_person boolean := false;
  v_other_subject boolean := false;
begin
  insert into people (first_name, email)
  values ('pgTAP A', ('pgtap-a-' || v_seed || '@example.com')::citext)
  returning id into v_person_a;

  insert into people (first_name, email)
  values ('pgTAP B', ('pgtap-b-' || v_seed || '@example.com')::citext)
  returning id into v_person_b;

  insert into message_threads (person_id, subject, normalized_subject)
  values (v_person_a, 'Your interview at Acme', 'your interview at acme')
  returning id into v_thread_id;

  -- Two concurrent inbound deliveries both falling back to subject matching.
  begin
    insert into message_threads (person_id, subject, normalized_subject)
    values (v_person_a, 'Re: Your interview at Acme', 'your interview at acme');
    v_duplicate := true;
  exception when unique_violation then
    v_duplicate := false;
  end;

  -- Threads are per person, so the same subject to someone else is a new thread.
  begin
    insert into message_threads (person_id, subject, normalized_subject)
    values (v_person_b, 'Your interview at Acme', 'your interview at acme');
    v_other_person := true;
  exception when unique_violation then
    v_other_person := false;
  end;

  begin
    insert into message_threads (person_id, subject, normalized_subject)
    values (v_person_a, 'Offer', 'offer');
    v_other_subject := true;
  exception when unique_violation then
    v_other_subject := false;
  end;

  return next ok(not v_duplicate,
    'one person plus one normalized subject is one thread, however many replies race');
  return next ok(v_other_person,
    'the same subject to a different person opens its own thread');
  return next ok(v_other_subject,
    'a different subject to the same person opens its own thread');
  return next ok(v_thread_id is not null, 'the seed thread was created');
end;
$fn$;

create function tap.test_deleting_a_thread_takes_its_messages()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_person_id uuid;
  v_thread_id uuid;
  v_remaining int;
begin
  insert into people (first_name, email)
  values ('pgTAP', ('pgtap-' || v_seed || '@example.com')::citext)
  returning id into v_person_id;

  insert into message_threads (person_id, normalized_subject)
  values (v_person_id, 'cascade ' || v_seed)
  returning id into v_thread_id;

  insert into messages (person_id, thread_id, direction, status, sent_at)
  values (v_person_id, v_thread_id, 'outbound', 'sent', now());

  delete from message_threads where id = v_thread_id;

  select count(*)::int into v_remaining from messages where thread_id = v_thread_id;

  return next is(v_remaining, 0,
    'deleting a thread takes its messages with it — no orphaned correspondence');
end;
$fn$;

create function tap.test_unmatched_inbound_reason_is_constrained()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_bad_reason boolean := false;
  v_duplicate boolean := false;
begin
  insert into unmatched_inbound_emails (relay_email_id, from_address, reason)
  values ('email_' || v_seed, 'stranger@example.com', 'no_matching_person');

  begin
    insert into unmatched_inbound_emails (relay_email_id, from_address, reason)
    values ('email_other_' || v_seed, 'stranger@example.com', 'because i said so');
    v_bad_reason := true;
  exception when check_violation then
    v_bad_reason := false;
  end;

  -- The quarantine has its own idempotency key, so a retried delivery of an
  -- unmatched email does not pile up duplicates either.
  begin
    insert into unmatched_inbound_emails (relay_email_id, from_address, reason)
    values ('email_' || v_seed, 'stranger@example.com', 'no_matching_person');
    v_duplicate := true;
  exception when unique_violation then
    v_duplicate := false;
  end;

  return next ok(not v_bad_reason, 'an unrecognised quarantine reason is refused');
  return next ok(not v_duplicate, 'a retried unmatched delivery cannot be quarantined twice');
end;
$fn$;

create function tap.test_anon_cannot_touch_threads_or_quarantine()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_person_id uuid;
  v_thread_id uuid;
  v_unmatched_id uuid;
  v_threads_visible int;
  v_unmatched_visible int;
  v_thread_insert boolean := false;
  v_unmatched_insert boolean := false;
  v_thread_updated int;
  v_unmatched_deleted int;
begin
  return next ok(
    (select relrowsecurity from pg_class where oid = 'public.message_threads'::regclass),
    'row level security is enabled on message_threads'
  );
  return next ok(
    (select relrowsecurity from pg_class where oid = 'public.unmatched_inbound_emails'::regclass),
    'row level security is enabled on unmatched_inbound_emails'
  );

  insert into people (first_name, email)
  values ('pgTAP', ('pgtap-' || v_seed || '@example.com')::citext)
  returning id into v_person_id;

  insert into message_threads (person_id, subject, normalized_subject)
  values (v_person_id, 'Private correspondence', 'private correspondence ' || v_seed)
  returning id into v_thread_id;

  insert into unmatched_inbound_emails (relay_email_id, from_address, subject, body_text, reason)
  values ('email_' || v_seed, 'stranger@example.com', 'Quarantined',
          'the whole body of an unidentified email', 'no_matching_person')
  returning id into v_unmatched_id;

  set local role anon;

  select count(*)::int into v_threads_visible from message_threads;
  select count(*)::int into v_unmatched_visible from unmatched_inbound_emails;

  begin
    insert into message_threads (person_id, normalized_subject)
    values (v_person_id, 'forged ' || v_seed);
    v_thread_insert := true;
  exception when insufficient_privilege or others then
    v_thread_insert := false;
  end;

  begin
    insert into unmatched_inbound_emails (relay_email_id, from_address, reason)
    values ('forged_' || v_seed, 'forger@example.com', 'no_matching_person');
    v_unmatched_insert := true;
  exception when insufficient_privilege or others then
    v_unmatched_insert := false;
  end;

  begin
    update message_threads set read_at = now() where id = v_thread_id;
    get diagnostics v_thread_updated = row_count;
  exception when insufficient_privilege or others then
    v_thread_updated := 0;
  end;

  begin
    delete from unmatched_inbound_emails where id = v_unmatched_id;
    get diagnostics v_unmatched_deleted = row_count;
  exception when insufficient_privilege or others then
    v_unmatched_deleted := 0;
  end;

  reset role;

  return next is(v_threads_visible, 0, 'anon cannot enumerate message_threads');
  return next is(v_unmatched_visible, 0,
    'anon cannot read quarantined inbound email, which is whole message bodies');
  return next ok(not v_thread_insert, 'anon cannot open a thread');
  return next ok(not v_unmatched_insert, 'anon cannot write to the quarantine');
  return next is(v_thread_updated, 0, 'anon cannot mark a thread read');
  return next is(v_unmatched_deleted, 0, 'anon cannot destroy quarantined mail');
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
