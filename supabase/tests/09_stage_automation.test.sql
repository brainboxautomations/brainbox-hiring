-- L4 — the automation engine: stage actions, their queue, and public intake.
--
-- This subsystem cannot be validated by clicking around. It is time-delayed, it
-- is cancellable, and its worst failure — sending a candidate the wrong stage's
-- email, or the same email twice — is invisible from the UI and irreversible
-- once it happens. So every guarantee that lives in the database is asserted
-- here, against the real schema, rather than being described in a comment.
--
-- Every helper takes the instant it should reason about, which is why these
-- tests can assert an hour's delay without waiting an hour.
--
-- Wrapped in a transaction that is rolled back; runtests() also savepoints each
-- test function, so no fixtures survive on the development database.
begin;

create schema if not exists tap;

-- One position with three stages, one message template, and one candidate
-- sitting outside the pipeline. Returns the ids as a single row so each test can
-- build its own isolated world.
create function tap.fixture()
returns table (position_id uuid, stage_one uuid, stage_two uuid, stage_three uuid,
               template_id uuid, person_id uuid)
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
begin
  insert into positions (title, slug, status)
  values ('pgTAP automation position', 'pgtap-aut-' || v_seed, 'draft')
  returning id into position_id;

  insert into position_stages (position_id, name, sort_order)
  values (position_id, 'Applied', 1) returning id into stage_one;
  insert into position_stages (position_id, name, sort_order)
  values (position_id, 'Interview', 2) returning id into stage_two;
  insert into position_stages (position_id, name, sort_order)
  values (position_id, 'Hired', 3) returning id into stage_three;

  insert into message_templates (name, subject, body)
  values ('pgTAP automation template', 'Hello', 'Body') returning id into template_id;

  insert into people (first_name, email)
  values ('Pgtap', 'pgtap-aut-' || v_seed || '@example.com') returning id into person_id;

  return next;
end;
$fn$;


-- ── entering a stage queues its enabled actions on their own delays ───────────

create function tap.test_entering_a_stage_queues_its_enabled_actions()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_app uuid;
  v_entered timestamptz;
begin
  select * into f from tap.fixture();

  insert into stage_actions (position_stage_id, type, delay_minutes, message_template_id)
  values (f.stage_one, 'send_email', 60, f.template_id);
  insert into stage_actions (position_stage_id, type, delay_minutes, target_position_stage_id)
  values (f.stage_one, 'move_to_stage', 1440, f.stage_two);
  -- A disabled action is configuration, not work.
  insert into stage_actions (position_stage_id, type, delay_minutes, message_template_id, enabled)
  values (f.stage_one, 'send_email', 0, f.template_id, false);
  -- An action on a stage the candidate never enters must stay put.
  insert into stage_actions (position_stage_id, type, delay_minutes, message_template_id)
  values (f.stage_two, 'send_email', 5, f.template_id);

  insert into applications (person_id, position_id, current_stage_id)
  values (f.person_id, f.position_id, f.stage_one)
  returning id into v_app;

  return next is(
    (select count(*)::int from scheduled_actions where application_id = v_app),
    2,
    'both enabled actions on the entered stage are queued, and only those'
  );

  return next is(
    (select count(*)::int from scheduled_actions
      where application_id = v_app and status = 'pending'),
    2,
    'every queued row starts pending'
  );

  select first_entered_at into v_entered
    from application_stage_entries
   where application_id = v_app and position_stage_id = f.stage_one;

  return next is(
    (select array_agg(round(extract(epoch from (scheduled_for - v_entered)) / 60)::int
                      order by scheduled_for)
       from scheduled_actions where application_id = v_app),
    array[60, 1440],
    'each action is due at entry time plus its own delay, independently'
  );

  return next is(
    (select count(*)::int from scheduled_actions
      where application_id = v_app and origin_stage_id = f.stage_one),
    2,
    'every queued row records the stage it originated from'
  );
end;
$fn$;

-- The producer must be reachable from the public intake path, which is SQL
-- and never touches a Route Handler. This is the test that would catch a
-- producer implemented in the API layer instead of the database.
create function tap.test_a_public_application_fires_the_first_stage()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_result jsonb;
  v_app uuid;
begin
  select * into f from tap.fixture();

  insert into stage_actions (position_stage_id, type, delay_minutes, message_template_id)
  values (f.stage_one, 'send_email', 60, f.template_id);

  update positions set status = 'open', publish_mode = 'listed' where id = f.position_id;

  v_result := submit_application(jsonb_build_object(
    'positionId', f.position_id,
    'firstName', 'Publicly',
    'email', 'pgtap-pub6-' || replace(gen_random_uuid()::text, '-', '') || '@example.com'
  ));

  v_app := (v_result->>'applicationId')::uuid;

  return next is(
    (select current_stage_id from applications where id = v_app),
    f.stage_one,
    'a public application lands at the first stage'
  );

  return next is(
    (select count(*)::int from scheduled_actions
      where application_id = v_app and status = 'pending'),
    1,
    'landing at the first stage fires that stage''s actions, through the same producer'
  );
end;
$fn$;


-- ── 0054: the automation safety delay ────────────────────────────────────────

create function tap.test_emails_wait_at_least_the_safety_delay()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_app uuid;
  v_entered timestamptz;
begin
  select * into f from tap.fixture();
  update email_timing_settings set automation_safety_delay_minutes = 20;

  insert into stage_actions (position_stage_id, type, delay_minutes, message_template_id)
  values (f.stage_one, 'send_email', 1, f.template_id);
  insert into stage_actions (position_stage_id, type, delay_minutes, target_position_stage_id)
  values (f.stage_one, 'move_to_stage', 0, f.stage_two);
  insert into stage_actions (position_stage_id, type, delay_minutes, message_template_id)
  values (f.stage_one, 'send_email', 90, f.template_id);

  insert into applications (person_id, position_id, current_stage_id)
  values (f.person_id, f.position_id, f.stage_one)
  returning id into v_app;

  select first_entered_at into v_entered
    from application_stage_entries
   where application_id = v_app and position_stage_id = f.stage_one;

  return next is(
    (select array_agg(round(extract(epoch from (scheduled_for - v_entered)) / 60)::int
                      order by scheduled_for)
       from scheduled_actions where application_id = v_app),
    array[0, 20, 90],
    'an email set to 1 minute waits the 20-minute safety delay; a move is not held; a longer delay is kept'
  );
end;
$fn$;

create function tap.test_a_safety_delay_of_zero_turns_it_off()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_app uuid;
  v_entered timestamptz;
begin
  select * into f from tap.fixture();
  update email_timing_settings set automation_safety_delay_minutes = 0;

  insert into stage_actions (position_stage_id, type, delay_minutes, message_template_id)
  values (f.stage_one, 'send_email', 1, f.template_id);

  insert into applications (person_id, position_id, current_stage_id)
  values (f.person_id, f.position_id, f.stage_one)
  returning id into v_app;

  select first_entered_at into v_entered
    from application_stage_entries
   where application_id = v_app and position_stage_id = f.stage_one;

  return next is(
    (select round(extract(epoch from (scheduled_for - v_entered)) / 60)::int
       from scheduled_actions where application_id = v_app),
    1,
    'with the safety delay set to 0, the action keeps its own delay'
  );
end;
$fn$;

-- ── fire on first entry only ─────────────────────────────────────────────────

create function tap.test_re_entering_a_stage_does_not_re_fire()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_app uuid;
begin
  select * into f from tap.fixture();

  insert into stage_actions (position_stage_id, type, delay_minutes, message_template_id)
  values (f.stage_one, 'send_email', 60, f.template_id);

  insert into applications (person_id, position_id, current_stage_id)
  values (f.person_id, f.position_id, f.stage_one)
  returning id into v_app;

  update applications set current_stage_id = f.stage_two where id = v_app;
  update applications set current_stage_id = f.stage_one where id = v_app;

  -- 0054: the first visit's email was cancelled before it ran (they left), so
  -- an accidental visit no longer uses up the stage. Coming back queues it again.
  return next is(
    (select count(*)::int from scheduled_actions
      where application_id = v_app and origin_stage_id = f.stage_one and status = 'pending'),
    1,
    're-entering queues an action that never ran, once'
  );

  -- One that did run is never repeated.
  update scheduled_actions set status = 'claimed', claimed_at = now()
   where application_id = v_app and origin_stage_id = f.stage_one and status = 'pending';
  update scheduled_actions set status = 'sent', completed_at = now()
   where application_id = v_app and origin_stage_id = f.stage_one and status = 'claimed';

  update applications set current_stage_id = f.stage_two where id = v_app;
  update applications set current_stage_id = f.stage_one where id = v_app;

  return next is(
    (select count(*)::int from scheduled_actions
      where application_id = v_app and origin_stage_id = f.stage_one and status = 'pending'),
    0,
    'an action that already ran is not queued again on a later visit'
  );

  -- A stage first reached after its actions were added queues them like any
  -- first visit; leaving it cancels them. The ledger still records the visit,
  -- which reporting and time-in-stage read.
  insert into stage_actions (position_stage_id, type, delay_minutes, message_template_id)
  values (f.stage_three, 'send_email', 5, f.template_id);

  update applications set current_stage_id = f.stage_three where id = v_app;
  update applications set current_stage_id = f.stage_two where id = v_app;

  return next is(
    (select count(*)::int from scheduled_actions
      where application_id = v_app and origin_stage_id = f.stage_three),
    1,
    'a stage first reached after its actions were added queues them once'
  );

  return next is(
    (select count(*)::int from application_stage_entries where application_id = v_app),
    3,
    'the ledger holds one row per stage the candidacy has ever reached'
  );

  return next throws_ok(
    format(
      $q$insert into application_stage_entries (application_id, position_stage_id)
         values (%L::uuid, %L::uuid)$q$,
      v_app, f.stage_one
    ),
    '23505'::char(5),
    null::text,
    'the ledger is unique per (application, stage), so two concurrent moves cannot both be first'
  );
end;
$fn$;


-- ── cancel on move, and never recall what has gone out ───────────────────────

create function tap.test_leaving_a_stage_cancels_only_its_pending_actions()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_app uuid;
  v_pending uuid;
  v_sent uuid;
  v_claimed uuid;
  v_now timestamptz := timestamptz '2026-03-01 09:00:00+00';
begin
  select * into f from tap.fixture();

  insert into applications (person_id, position_id, current_stage_id)
  values (f.person_id, f.position_id, f.stage_one)
  returning id into v_app;

  insert into scheduled_actions (application_id, origin_stage_id, scheduled_for)
  values (v_app, f.stage_one, v_now + interval '1 hour') returning id into v_pending;

  insert into scheduled_actions (application_id, origin_stage_id, scheduled_for,
                                 status, claimed_at, completed_at)
  values (v_app, f.stage_one, v_now, 'sent', v_now, v_now) returning id into v_sent;

  insert into scheduled_actions (application_id, origin_stage_id, scheduled_for,
                                 status, claimed_at)
  values (v_app, f.stage_one, v_now, 'claimed', v_now) returning id into v_claimed;

  update applications set current_stage_id = f.stage_two where id = v_app;

  return next is(
    (select status::text from scheduled_actions where id = v_pending),
    'cancelled',
    'leaving the stage cancels the action that had not fired yet'
  );

  return next isnt(
    (select completed_at from scheduled_actions where id = v_pending),
    null::timestamptz,
    'a cancelled row records when it was settled'
  );

  return next is(
    (select status::text from scheduled_actions where id = v_sent),
    'sent',
    'an email that has already gone out is not recalled by a later move'
  );

  -- Cancel-on-move must not reach into a row a worker already owns. That worker
  -- may be mid-call to the mail relay, and an email in flight cannot be undone.
  return next is(
    (select status::text from scheduled_actions where id = v_claimed),
    'claimed',
    'a row a worker has claimed is not stolen back by a move'
  );

  return next is(
    (select count(*)::int from scheduled_actions
      where application_id = v_app and origin_stage_id = f.stage_two),
    0,
    'the stage the candidate moved into had no actions, so nothing was queued'
  );
end;
$fn$;

create function tap.test_deleting_a_stage_action_cancels_its_pending_work()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_app uuid;
  v_action uuid;
  v_now timestamptz := timestamptz '2026-03-01 09:00:00+00';
  v_sent uuid;
begin
  select * into f from tap.fixture();

  insert into stage_actions (position_stage_id, type, delay_minutes, message_template_id)
  values (f.stage_one, 'send_email', 60, f.template_id) returning id into v_action;

  insert into applications (person_id, position_id, current_stage_id)
  values (f.person_id, f.position_id, f.stage_one)
  returning id into v_app;

  insert into scheduled_actions (application_id, stage_action_id, origin_stage_id,
                                 scheduled_for, status, claimed_at, completed_at)
  values (v_app, v_action, f.stage_one, v_now, 'sent', v_now, v_now)
  returning id into v_sent;

  delete from stage_actions where id = v_action;

  return next is(
    (select count(*)::int from scheduled_actions
      where application_id = v_app and status = 'pending'),
    0,
    'deleting a stage action cancels the queued work that no longer describes anything'
  );

  return next is(
    (select status::text from scheduled_actions where id = v_sent),
    'sent',
    'deleting a stage action does not rewrite the history of what it already sent'
  );

  -- `on delete set null` keeps the history row; the guard trigger must let that
  -- update through or deleting an action would fail once anything had fired.
  return next is(
    (select stage_action_id from scheduled_actions where id = v_sent),
    null::uuid,
    'the settled row survives with its link severed rather than being deleted'
  );
end;
$fn$;


-- ── claiming is exactly once, and only a claimed row settles ─────────────────

create function tap.test_a_due_action_is_claimed_exactly_once()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_app uuid;
  v_due uuid;
  v_early uuid;
  v_now timestamptz := timestamptz '2026-03-01 09:00:00+00';
begin
  select * into f from tap.fixture();

  insert into applications (person_id, position_id, current_stage_id)
  values (f.person_id, f.position_id, f.stage_one)
  returning id into v_app;

  insert into scheduled_actions (application_id, origin_stage_id, scheduled_for)
  values (v_app, f.stage_one, v_now) returning id into v_due;

  insert into scheduled_actions (application_id, origin_stage_id, scheduled_for)
  values (v_app, f.stage_one, v_now + interval '1 hour') returning id into v_early;

  return next is(
    (select count(*)::int from claim_due_scheduled_actions(v_now - interval '1 second', 10)),
    0,
    'nothing is claimable before its scheduled_for'
  );

  return next results_eq(
    format($q$select * from claim_due_scheduled_actions(%L::timestamptz, 10)$q$, v_now),
    array[v_due],
    'the due action is claimed and the one an hour out is left alone'
  );

  return next is(
    (select count(*)::int from claim_due_scheduled_actions(v_now, 10)),
    0,
    'a second worker pass over the same instant claims nothing — the row is gone from the queue'
  );

  return next is(
    (select status::text from scheduled_actions where id = v_due),
    'claimed',
    'the claimed row carries the claimed status'
  );

  return next isnt(
    (select claimed_at from scheduled_actions where id = v_due),
    null::timestamptz,
    'the claim is stamped, so a worker that dies leaves a dated forensic record'
  );

  return next is(
    (select status::text from scheduled_actions where id = v_early),
    'pending',
    'the action that is not due yet is untouched'
  );

  return next ok(
    complete_scheduled_action(v_due, 'sent', v_now, null, null),
    'a claimed row settles as sent'
  );

  return next ok(
    not complete_scheduled_action(v_due, 'sent', v_now, null, null),
    'settling the same row twice reports false instead of sending again'
  );

  return next ok(
    not complete_scheduled_action(v_early, 'sent', v_now, null, null),
    'a row that was never claimed cannot be settled at all'
  );

  return next throws_ok(
    format(
      $q$select complete_scheduled_action(%L::uuid, 'cancelled', now(), null, null)$q$,
      v_early
    ),
    'P0001'::char(5),
    'complete_scheduled_action only settles a row as sent, failed or skipped',
    'the settle RPC refuses to be used as a general status setter'
  );
end;
$fn$;

create function tap.test_a_failure_is_never_silent()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_app uuid;
  v_failed uuid;
  v_skipped uuid;
  v_now timestamptz := timestamptz '2026-03-01 09:00:00+00';
begin
  select * into f from tap.fixture();

  insert into applications (person_id, position_id, current_stage_id)
  values (f.person_id, f.position_id, f.stage_one)
  returning id into v_app;

  insert into scheduled_actions (application_id, origin_stage_id, scheduled_for)
  values (v_app, f.stage_one, v_now) returning id into v_failed;
  insert into scheduled_actions (application_id, origin_stage_id, scheduled_for)
  values (v_app, f.stage_one, v_now) returning id into v_skipped;

  perform claim_due_scheduled_actions(v_now, 10);

  return next ok(
    complete_scheduled_action(v_failed, 'failed', v_now, 'the relay refused the message', null),
    'a failed send settles as failed'
  );

  return next is(
    (select failure_reason from scheduled_actions where id = v_failed),
    'the relay refused the message',
    'the reason survives on the row, so a broken send is inspectable long afterwards'
  );

  return next throws_ok(
    format(
      $q$select complete_scheduled_action(%L::uuid, 'failed', now(), null, null)$q$,
      v_skipped
    ),
    '23514'::char(5),
    null::text,
    'a failure with no reason is rejected by the database — silence is not a state this queue has'
  );

  return next throws_ok(
    format(
      $q$select complete_scheduled_action(%L::uuid, 'skipped', now(), null, null)$q$,
      v_skipped
    ),
    '23514'::char(5),
    null::text,
    'the same holds for a skip: it must say what precondition failed'
  );

  return next ok(
    complete_scheduled_action(
      v_skipped, 'skipped', v_now,
      'The candidate is no longer in the stage that scheduled this action', null
    ),
    'a skip with a reason settles'
  );

  return next is(
    (select count(*)::int from stalled_scheduled_actions where application_id = v_app),
    0,
    'nothing is left stalled once every claimed row has been settled'
  );
end;
$fn$;

create function tap.test_a_worker_that_dies_leaves_a_visible_row()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_app uuid;
  v_abandoned uuid;
  v_now timestamptz := now() - interval '2 hours';
begin
  select * into f from tap.fixture();

  insert into applications (person_id, position_id, current_stage_id)
  values (f.person_id, f.position_id, f.stage_one)
  returning id into v_app;

  insert into scheduled_actions (application_id, origin_stage_id, scheduled_for)
  values (v_app, f.stage_one, v_now) returning id into v_abandoned;

  perform claim_due_scheduled_actions(v_now, 10);

  -- The worker process ends here. Nothing settles the row.
  return next is(
    (select count(*)::int from claim_due_scheduled_actions(now(), 10)),
    0,
    'an abandoned claim is never re-claimed, so the candidate cannot receive it twice'
  );

  return next is(
    (select count(*)::int from stalled_scheduled_actions where id = v_abandoned),
    1,
    'the abandoned row shows up in stalled_scheduled_actions rather than vanishing'
  );

  return next ok(
    (select claimed_for from stalled_scheduled_actions where id = v_abandoned) > interval '1 hour',
    'the view says how long it has been stuck'
  );
end;
$fn$;


-- ── The state machine is total, and illegal moves are impossible ────────────

create function tap.test_illegal_state_transitions_are_refused()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_app uuid;
  v_pending uuid;
  v_claimed uuid;
  v_sent uuid;
  v_cancelled uuid;
  v_now timestamptz := timestamptz '2026-03-01 09:00:00+00';
begin
  select * into f from tap.fixture();

  insert into applications (person_id, position_id, current_stage_id)
  values (f.person_id, f.position_id, f.stage_one)
  returning id into v_app;

  insert into scheduled_actions (application_id, origin_stage_id, scheduled_for)
  values (v_app, f.stage_one, v_now) returning id into v_pending;

  insert into scheduled_actions (application_id, origin_stage_id, scheduled_for,
                                 status, claimed_at)
  values (v_app, f.stage_one, v_now, 'claimed', v_now) returning id into v_claimed;

  insert into scheduled_actions (application_id, origin_stage_id, scheduled_for,
                                 status, claimed_at, completed_at)
  values (v_app, f.stage_one, v_now, 'sent', v_now, v_now) returning id into v_sent;

  insert into scheduled_actions (application_id, origin_stage_id, scheduled_for,
                                 status, completed_at)
  values (v_app, f.stage_one, v_now, 'cancelled', v_now) returning id into v_cancelled;

  -- Skipping the claim is the double-send bug in its purest form: it is exactly
  -- what a worker that "just sends the due rows" would do.
  return next throws_ok(
    format($q$update scheduled_actions set status = 'sent', claimed_at = now(),
              completed_at = now() where id = %L::uuid$q$, v_pending),
    'P0001'::char(5),
    'A scheduled action cannot move from pending to sent',
    'a pending row cannot be marked sent without being claimed first'
  );

  return next throws_ok(
    format($q$update scheduled_actions set status = 'cancelled', completed_at = now()
              where id = %L::uuid$q$, v_claimed),
    'P0001'::char(5),
    'A scheduled action cannot move from claimed to cancelled',
    'cancel-on-move cannot cancel a row a worker already owns'
  );

  return next throws_ok(
    format($q$update scheduled_actions set status = 'pending', claimed_at = null,
              completed_at = null where id = %L::uuid$q$, v_sent),
    'P0001'::char(5),
    'A scheduled action cannot move from sent to pending',
    'a sent action cannot be put back on the queue and sent again'
  );

  return next throws_ok(
    format($q$update scheduled_actions set status = 'cancelled' where id = %L::uuid$q$, v_sent),
    'P0001'::char(5),
    'A scheduled action cannot move from sent to cancelled',
    'sent is terminal — there is no unsending'
  );

  return next throws_ok(
    format($q$update scheduled_actions set status = 'claimed', claimed_at = now(),
              completed_at = null where id = %L::uuid$q$, v_cancelled),
    'P0001'::char(5),
    'A scheduled action cannot move from cancelled to claimed',
    'a cancelled action cannot be revived'
  );

  return next lives_ok(
    format($q$update scheduled_actions set status = 'cancelled', completed_at = now()
              where id = %L::uuid$q$, v_pending),
    'the one legal exit from pending without a worker is cancellation'
  );
end;
$fn$;

create function tap.test_the_columns_and_the_status_cannot_disagree()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_app uuid;
  v_now timestamptz := timestamptz '2026-03-01 09:00:00+00';
begin
  select * into f from tap.fixture();

  insert into applications (person_id, position_id, current_stage_id)
  values (f.person_id, f.position_id, f.stage_one)
  returning id into v_app;

  return next throws_ok(
    format(
      $q$insert into scheduled_actions (application_id, origin_stage_id, scheduled_for,
                                        status, claimed_at)
         values (%L::uuid, %L::uuid, now(), 'pending', now())$q$,
      v_app, f.stage_one
    ),
    '23514'::char(5),
    null::text,
    'a pending row cannot claim to have been claimed'
  );

  return next throws_ok(
    format(
      $q$insert into scheduled_actions (application_id, origin_stage_id, scheduled_for, status)
         values (%L::uuid, %L::uuid, now(), 'claimed')$q$,
      v_app, f.stage_one
    ),
    '23514'::char(5),
    null::text,
    'a claimed row must say when it was claimed'
  );

  return next throws_ok(
    format(
      $q$insert into scheduled_actions (application_id, origin_stage_id, scheduled_for,
                                        status, claimed_at, completed_at)
         values (%L::uuid, %L::uuid, now(), 'sent', now(), null)$q$,
      v_app, f.stage_one
    ),
    '23514'::char(5),
    null::text,
    'a settled row must say when it settled'
  );
end;
$fn$;


-- ── Stage action configuration ───────────────────────────────────────────────

create function tap.test_a_stage_action_cannot_be_misconfigured()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_other_stage uuid;
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_other_position uuid;
begin
  select * into f from tap.fixture();

  insert into positions (title, slug, status)
  values ('pgTAP other position', 'pgtap-other-' || v_seed, 'draft')
  returning id into v_other_position;
  insert into position_stages (position_id, name, sort_order)
  values (v_other_position, 'Screening', 1) returning id into v_other_stage;

  return next throws_ok(
    format(
      $q$insert into stage_actions (position_stage_id, type, target_position_stage_id, delay_minutes)
         values (%L::uuid, 'move_to_stage', %L::uuid, 0)$q$,
      f.stage_one, v_other_stage
    ),
    'P0001'::char(5),
    'A stage action can only move a candidate to a stage on its own position',
    'an action cannot move a candidate into another position''s pipeline'
  );

  return next throws_ok(
    format(
      $q$insert into stage_actions (position_stage_id, type, message_template_id, delay_minutes)
         values (%L::uuid, 'send_email', %L::uuid, -5)$q$,
      f.stage_one, f.template_id
    ),
    '23514'::char(5),
    null::text,
    'a negative delay is refused, because the delay is the undo window'
  );

  return next throws_ok(
    format(
      $q$insert into stage_actions (position_stage_id, type, message_template_id,
                                    target_position_stage_id, delay_minutes)
         values (%L::uuid, 'send_email', %L::uuid, %L::uuid, 0)$q$,
      f.stage_one, f.template_id, f.stage_two
    ),
    '23514'::char(5),
    null::text,
    'a send_email action cannot also carry a move target'
  );

  return next lives_ok(
    format(
      $q$insert into stage_actions (position_stage_id, type, target_position_stage_id, delay_minutes)
         values (%L::uuid, 'move_to_stage', %L::uuid, 0)$q$,
      f.stage_one, f.stage_two
    ),
    'a move to a stage on the same position is accepted'
  );
end;
$fn$;

-- Deleting a stage once anything has fired from it must not fail. The status
-- guard is a BEFORE UPDATE trigger and `scheduled_actions.origin_stage_id` is
-- `on delete set null`, so a guard written to freeze whole rows rather than just
-- the status column would make this raise.
create function tap.test_a_stage_with_settled_history_can_still_be_deleted()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_app uuid;
  v_sent uuid;
  v_now timestamptz := timestamptz '2026-03-01 09:00:00+00';
begin
  select * into f from tap.fixture();

  insert into applications (person_id, position_id, current_stage_id)
  values (f.person_id, f.position_id, f.stage_two)
  returning id into v_app;

  insert into scheduled_actions (application_id, origin_stage_id, scheduled_for,
                                 status, claimed_at, completed_at)
  values (v_app, f.stage_three, v_now, 'sent', v_now, v_now) returning id into v_sent;

  return next lives_ok(
    format($q$delete from position_stages where id = %L::uuid$q$, f.stage_three),
    'a stage that has already sent something can still be deleted'
  );

  return next is(
    (select origin_stage_id from scheduled_actions where id = v_sent),
    null::uuid,
    'the settled row keeps its history with the stage link severed'
  );
end;
$fn$;


-- ── resolving a template stage to a position's own stage ────────────────────

create function tap.test_an_unresolvable_routing_target_returns_null()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_pipeline uuid;
  v_template_stage uuid;
  v_position uuid;
  v_position_stage uuid;
begin
  insert into pipelines (name) values ('pgTAP routing pipeline') returning id into v_pipeline;
  insert into pipeline_template_stages (pipeline_id, name, sort_order)
  values (v_pipeline, 'Offer', 1) returning id into v_template_stage;

  insert into positions (title, slug, status)
  values ('pgTAP routing position', 'pgtap-route-' || v_seed, 'draft')
  returning id into v_position;

  insert into position_stages (position_id, source_template_stage_id, name, sort_order)
  values (v_position, v_template_stage, 'Offer', 1) returning id into v_position_stage;

  return next is(
    position_stage_for_template_stage(v_position, v_template_stage),
    v_position_stage,
    'a template stage resolves to the position''s own copy of it'
  );

  return next is(
    position_stage_for_template_stage(v_position, gen_random_uuid()),
    null::uuid,
    'a template stage this position never snapshotted resolves to nothing'
  );

  -- `source_template_stage_id` is `on delete set null`, so deleting the template
  -- stage severs the link permanently. The engine must answer "I do not know"
  -- rather than guessing a stage — a silent wrong move is worse than no move.
  delete from pipeline_template_stages where id = v_template_stage;

  return next is(
    position_stage_for_template_stage(v_position, v_template_stage),
    null::uuid,
    'once the template stage is deleted the link is severed and nothing resolves'
  );

  return next is(
    (select count(*)::int from position_stages where id = v_position_stage),
    1,
    'the position keeps its own stage; only the link back to the template is lost'
  );
end;
$fn$;


-- ── The cron plumbing ────────────────────────────────────────────────────────

create function tap.test_the_cron_job_and_its_config_are_installed()
returns setof text
language plpgsql
as $fn$
begin
  return next is(
    (select count(*)::int from cron.job where jobname = 'brainbox-scheduled-actions'),
    1,
    'the pg_cron job that wakes the worker is scheduled'
  );

  return next is(
    (select schedule from cron.job where jobname = 'brainbox-scheduled-actions'),
    '* * * * *',
    'it runs every minute, the finest resolution a per-minute delay can express'
  );

  return next is(
    (select count(*)::int from automation_worker_config),
    1,
    'the worker endpoint config is a single row'
  );

  -- It ships disabled: a freshly restored database must not start POSTing to
  -- whatever endpoint the last one happened to be pointed at.
  return next is(
    dispatch_due_scheduled_actions(now()),
    null::bigint,
    'with no endpoint configured the doorbell does nothing rather than erroring'
  );
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
