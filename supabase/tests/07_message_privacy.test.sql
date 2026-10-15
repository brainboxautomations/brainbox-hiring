-- L4 — message and template privacy, plus the scheduled-send contract.
--
-- Two properties are asserted here, and both are silent if they break.
--
-- 1. `messages` and `message_templates` are internal-only. `anon` is the public
--    careers applicant; the anon key ships in the browser bundle, so anyone can
--    talk to PostgREST directly. If either table were readable by anon, every
--    candidate's private correspondence — and every rejection template the team
--    has drafted — would be enumerable by anyone who visits the careers site.
--    Neither table has any public code path, so `anon` must have nothing at all:
--    no select, no insert, no update, no delete.
--
-- 2. The scheduled-send state machine from migration 0015. Scheduled send is the
--    seam the automation worker consumes: it looks for outbound rows with status
--    'scheduled' and scheduled_for <= now(). Two ways that breaks quietly —
--    a row marked 'scheduled' with a null scheduled_for would never come due and
--    the email would silently never send; a row with a scheduled_for but some
--    other status would be picked up twice. Both are refused by check
--    constraints rather than by application code, because the worker will be a
--    second writer to this table and cannot rely on the Route Handler's care.
--
-- Role switching follows the L4 convention: seed as the session role, switch to
-- anon, capture results into variables, `reset role`, then assert — pgTAP's own
-- bookkeeping uses session temp tables that anon cannot write to.
--
-- Wrapped in a transaction that is rolled back; runtests() also savepoints each
-- test function, so no fixtures survive on the development database.
begin;

create schema if not exists tap;

create function tap.test_anon_cannot_touch_messages()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_person_id uuid;
  v_message_id uuid;
  v_visible int;
  v_any_visible int;
  v_inserted boolean := false;
  v_updated int;
  v_deleted int;
begin
  return next ok(
    (select relrowsecurity from pg_class where oid = 'public.messages'::regclass),
    'row level security is enabled on messages'
  );

  insert into people (first_name, last_name, email)
  values ('pgTAP', 'Candidate', ('pgtap-' || v_seed || '@example.com')::citext)
  returning id into v_person_id;

  insert into messages (person_id, direction, to_address, subject, body, status, sent_at)
  values (v_person_id, 'outbound', 'pgtap-' || v_seed || '@example.com',
          'pgTAP subject ' || v_seed, 'private correspondence', 'sent', now())
  returning id into v_message_id;

  set local role anon;

  select count(*)::int into v_visible from messages where id = v_message_id;
  select count(*)::int into v_any_visible from messages;

  begin
    insert into messages (person_id, direction, subject, status)
    values (v_person_id, 'inbound', 'forged', 'received');
    v_inserted := true;
  exception when insufficient_privilege or others then
    v_inserted := false;
  end;

  begin
    update messages set subject = 'tampered' where id = v_message_id;
    get diagnostics v_updated = row_count;
  exception when insufficient_privilege or others then
    v_updated := 0;
  end;

  begin
    delete from messages where id = v_message_id;
    get diagnostics v_deleted = row_count;
  exception when insufficient_privilege or others then
    v_deleted := 0;
  end;

  reset role;

  return next is(v_visible, 0, 'anon cannot read a specific message');
  return next is(v_any_visible, 0, 'anon cannot enumerate the messages table at all');
  return next ok(not v_inserted, 'anon cannot forge an inbound message');
  return next is(v_updated, 0, 'anon cannot rewrite a message');
  return next is(v_deleted, 0, 'anon cannot delete a message');
end;
$fn$;

create function tap.test_anon_cannot_touch_message_templates()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_template_id uuid;
  v_visible int;
  v_any_visible int;
  v_inserted boolean := false;
  v_deleted int;
begin
  return next ok(
    (select relrowsecurity from pg_class where oid = 'public.message_templates'::regclass),
    'row level security is enabled on message_templates'
  );

  insert into message_templates (name, subject, body)
  values ('pgTAP rejection ' || v_seed, 'Update on your application', 'Hi {{candidate.first_name}}')
  returning id into v_template_id;

  set local role anon;

  select count(*)::int into v_visible from message_templates where id = v_template_id;
  select count(*)::int into v_any_visible from message_templates;

  begin
    insert into message_templates (name) values ('forged ' || v_seed);
    v_inserted := true;
  exception when insufficient_privilege or others then
    v_inserted := false;
  end;

  begin
    delete from message_templates where id = v_template_id;
    get diagnostics v_deleted = row_count;
  exception when insufficient_privilege or others then
    v_deleted := 0;
  end;

  reset role;

  return next is(v_visible, 0, 'anon cannot read a message template');
  return next is(v_any_visible, 0, 'anon cannot enumerate the message_templates table at all');
  return next ok(not v_inserted, 'anon cannot create a message template');
  return next is(v_deleted, 0, 'anon cannot delete a message template');
end;
$fn$;

create function tap.test_scheduled_send_columns_exist()
returns setof text
language plpgsql
as $fn$
begin
  return next has_column('public'::name, 'messages'::name, 'scheduled_for'::name,
    'messages.scheduled_for exists — scheduled send');
  return next col_type_is('public'::name, 'messages'::name, 'scheduled_for'::name,
    'timestamp with time zone'::text,
    'scheduled_for is timestamptz, so a delay is absolute rather than server-local');
  return next has_column('public'::name, 'messages'::name, 'failure_reason'::name,
    'messages.failure_reason exists — a rejected send is recorded, not lost');
  return next has_index('public'::name, 'messages'::name, 'messages_due_outbound_idx'::name,
    'the partial index the worker scans for due messages exists');
end;
$fn$;

create function tap.test_scheduled_status_and_time_must_agree()
returns setof text
language plpgsql
as $fn$
declare
  v_person_id uuid;
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_scheduled_without_time boolean := false;
  v_sent_with_time boolean := false;
  v_bad_status boolean := false;
  v_good_scheduled boolean := false;
  v_good_sent boolean := false;
begin
  insert into people (first_name, email)
  values ('pgTAP', ('pgtap-' || v_seed || '@example.com')::citext)
  returning id into v_person_id;

  -- Would never come due: the worker looks for scheduled_for <= now().
  begin
    insert into messages (person_id, direction, status)
    values (v_person_id, 'outbound', 'scheduled');
    v_scheduled_without_time := true;
  exception when check_violation then
    v_scheduled_without_time := false;
  end;

  -- Would be picked up again after it had already gone out.
  begin
    insert into messages (person_id, direction, status, sent_at, scheduled_for)
    values (v_person_id, 'outbound', 'sent', now(), now() + interval '1 hour');
    v_sent_with_time := true;
  exception when check_violation then
    v_sent_with_time := false;
  end;

  begin
    insert into messages (person_id, direction, status)
    values (v_person_id, 'outbound', 'in_flight');
    v_bad_status := true;
  exception when check_violation then
    v_bad_status := false;
  end;

  begin
    insert into messages (person_id, direction, status, scheduled_for)
    values (v_person_id, 'outbound', 'scheduled', now() + interval '1 hour');
    v_good_scheduled := true;
  exception when check_violation then
    v_good_scheduled := false;
  end;

  begin
    insert into messages (person_id, direction, status, sent_at)
    values (v_person_id, 'outbound', 'sent', now());
    v_good_sent := true;
  exception when check_violation then
    v_good_sent := false;
  end;

  return next ok(not v_scheduled_without_time,
    'a scheduled message must carry a scheduled_for, or it would silently never send');
  return next ok(not v_sent_with_time,
    'a sent message cannot keep a scheduled_for, or the worker would send it twice');
  return next ok(not v_bad_status,
    'an unknown status is refused, so the worker never meets a state it cannot interpret');
  return next ok(v_good_scheduled, 'a well-formed scheduled message is accepted');
  return next ok(v_good_sent, 'a well-formed immediate send is accepted');
end;
$fn$;

create function tap.test_message_attachments_bucket_is_private()
returns setof text
language plpgsql
as $fn$
declare
  v_public boolean;
  v_limit bigint;
  v_anon_policies int;
begin
  select public, file_size_limit into v_public, v_limit
  from storage.buckets where id = 'message-attachments';

  return next ok(v_public is not null, 'the message-attachments bucket exists');
  return next ok(not v_public, 'the message-attachments bucket is private, like resumes and videos');
  -- Raised from 10 MB to 25 MB by migration 0017: inbound attachments share this
  -- bucket and their size is the sender's choice. Outbound is still capped at
  -- 10 MB in application code (utilities/message-attachments.ts).
  return next is(v_limit, 26214400::bigint, 'the bucket enforces a 25 MB per-object limit');

  -- Unlike the candidate buckets there is no public write path, so anon must not
  -- appear in any storage policy naming this bucket.
  select count(*)::int into v_anon_policies
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname like 'message attachments%'
    and 'anon' = any(roles);

  return next is(v_anon_policies, 0, 'no storage policy grants anon anything on message attachments');
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
