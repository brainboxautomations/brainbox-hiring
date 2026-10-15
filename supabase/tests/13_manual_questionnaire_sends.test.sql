-- L4 — the rules migrations 0032 and 0033 put in the database for a questionnaire
-- sent by hand to a board selection.
--
-- Three of them cannot be checked from the application, because the application
-- is exactly what they are there to constrain:
--
--   * a manual send anchors its reminder run to the stage the candidate was in,
--     so cancel-on-move still applies to it;
--   * a candidate cannot end up with two live manual questionnaires of the same
--     kind, however many times a bulk send is repeated or raced;
--   * `origin_stage_id` and `reminder_config` cannot be written onto a response
--     that is not a manual send, where nothing would ever read them.
begin;

create schema if not exists tap;

-- A pipeline template, a position snapshotted from it, a questionnaire, one
-- candidate sitting in stage one, and a Send Questionnaire action on that stage.
create function tap.mfixture()
returns table (
  position_id uuid, stage_one uuid, stage_two uuid,
  questionnaire_id uuid, person_id uuid, application_id uuid, action_id uuid
)
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_pipeline uuid;
begin
  insert into pipelines (name) values ('pgTAP manual pipeline ' || v_seed)
  returning id into v_pipeline;

  insert into positions (title, slug, status, assigned_pipeline_id)
  values ('pgTAP manual position', 'pgtap-man-' || v_seed, 'draft', v_pipeline)
  returning id into position_id;

  insert into position_stages (position_id, name, sort_order)
  values (position_id, 'Applied', 1) returning id into stage_one;
  insert into position_stages (position_id, name, sort_order)
  values (position_id, 'Interview', 2) returning id into stage_two;

  insert into questionnaire_templates (name)
  values ('pgTAP manual questionnaire') returning id into questionnaire_id;

  insert into people (first_name, email)
  values ('Pgtap', 'pgtap-man-' || v_seed || '@example.com') returning id into person_id;

  insert into applications (person_id, position_id, current_stage_id)
  values (person_id, position_id, stage_one) returning id into application_id;

  insert into stage_actions (position_stage_id, type, delay_minutes, questionnaire_template_id)
  values (stage_one, 'send_questionnaire', 0, questionnaire_id) returning id into action_id;

  return next;
end;
$fn$;

-- A manual send, as the bulk route writes it: no stage action, the stage the
-- candidate was in, and the schedule that was in force at that moment.
create function tap.manual_response(f record, p_now timestamptz, p_stage uuid)
returns uuid
language plpgsql
as $fn$
declare
  v_id uuid;
begin
  insert into questionnaire_responses (
    questionnaire_template_id, application_id, context, status, sent_at,
    origin_stage_id, reminder_config
  )
  values (
    f.questionnaire_id, f.application_id, 'manual_sent', 'pending', p_now,
    p_stage,
    '{"enabled":true,"interval_minutes":[2880],"max_count":3,"message_template_id":null}'::jsonb
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

-- The same schedule shape the worker hands over, n reminders one day apart.
create function tap.manual_schedule_of(p_count integer, p_from timestamptz)
returns jsonb
language sql
as $fn$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'reminder_number', n,
      'scheduled_for', p_from + make_interval(days => n)
    ) order by n),
    '[]'::jsonb
  )
  from generate_series(1, greatest(p_count, 0)) as n;
$fn$;


-- ── a manual send gets the same reminder run, anchored the same way ───────────────

create function tap.test_a_manual_send_queues_reminders_against_its_own_origin_stage()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_now timestamptz := now();
  v_queued integer;
begin
  select * into f from tap.mfixture();
  v_response := tap.manual_response(f, v_now, f.stage_one);

  v_queued := schedule_questionnaire_reminders(v_response, tap.manual_schedule_of(3, v_now), v_now);

  return next is(v_queued, 3, 'a manual send queues the schedule it was given');

  return next is(
    (select count(distinct origin_stage_id)::int from scheduled_actions
      where questionnaire_response_id = v_response and kind = 'reminder'),
    1,
    'every reminder in the run shares one origin stage'
  );

  return next is(
    (select distinct origin_stage_id from scheduled_actions
      where questionnaire_response_id = v_response and kind = 'reminder'),
    f.stage_one,
    'and it is the stage the candidate was in when the questionnaire went out'
  );

  return next is(
    (select count(*)::int from scheduled_actions
      where questionnaire_response_id = v_response
        and kind = 'reminder' and stage_action_id is not null),
    0,
    'no stage action is invented for a send that had none'
  );
end;
$fn$;

create function tap.test_leaving_the_stage_cancels_a_manual_send_s_reminders()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_now timestamptz := now();
begin
  select * into f from tap.mfixture();
  v_response := tap.manual_response(f, v_now, f.stage_one);
  perform schedule_questionnaire_reminders(v_response, tap.manual_schedule_of(3, v_now), v_now);

  -- The existing cancel-on-move canceller, unchanged. This is the whole point of
  -- storing an origin stage on the response: the "moved on" stop condition comes
  -- free.
  perform cancel_pending_stage_actions(f.application_id, f.stage_one, v_now);

  return next is(
    (select count(*)::int from scheduled_actions
      where questionnaire_response_id = v_response
        and kind = 'reminder' and status = 'pending'),
    0,
    'moving the candidate on stops the chase for a manual send too'
  );

  return next is(
    (select count(*)::int from scheduled_actions
      where questionnaire_response_id = v_response
        and kind = 'reminder' and status = 'cancelled'),
    3,
    'and every remaining reminder is recorded as cancelled rather than deleted'
  );
end;
$fn$;

create function tap.test_a_manual_send_with_no_origin_stage_queues_nothing()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_now timestamptz := now();
  v_queued integer;
begin
  select * into f from tap.mfixture();
  v_response := tap.manual_response(f, v_now, null);

  v_queued := schedule_questionnaire_reminders(v_response, tap.manual_schedule_of(3, v_now), v_now);

  return next is(v_queued, 0, 'a reminder run that could never be cancelled is not started');

  return next is(
    (select count(*)::int from scheduled_actions
      where questionnaire_response_id = v_response and kind = 'reminder'),
    0,
    'and nothing is left in the queue'
  );
end;
$fn$;

create function tap.test_a_manual_send_that_is_finished_or_stopped_is_never_chased()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_completed uuid;
  v_stopped uuid;
  v_now timestamptz := now();
begin
  select * into f from tap.mfixture();

  v_completed := tap.manual_response(f, v_now, f.stage_one);
  update questionnaire_responses
     set status = 'completed', completed_at = v_now
   where id = v_completed;

  return next is(
    schedule_questionnaire_reminders(v_completed, tap.manual_schedule_of(3, v_now), v_now),
    0,
    'a completed manual questionnaire is not chased'
  );

  -- The pending index only allows one live manual response per pair, so the
  -- second one can only exist once the first has left `pending`.
  v_stopped := tap.manual_response(f, v_now, f.stage_one);
  update questionnaire_responses set reminders_stopped_at = v_now where id = v_stopped;

  return next is(
    schedule_questionnaire_reminders(v_stopped, tap.manual_schedule_of(3, v_now), v_now),
    0,
    'nor is one a human has called off'
  );
end;
$fn$;


-- ── One live manual questionnaire per candidate per kind ─────────────────────

create function tap.test_a_candidate_cannot_hold_two_pending_manual_sends_of_one_questionnaire()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_now timestamptz := now();
begin
  select * into f from tap.mfixture();
  perform tap.manual_response(f, v_now, f.stage_one);

  return next throws_ok(
    format(
      $q$insert into questionnaire_responses
           (questionnaire_template_id, application_id, context, status, sent_at, origin_stage_id)
         values (%L, %L, 'manual_sent', 'pending', now(), %L)$q$,
      f.questionnaire_id, f.application_id, f.stage_one
    ),
    '23505',
    null,
    'a repeated bulk send cannot fork one questionnaire into two'
  );
end;
$fn$;

create function tap.test_a_completed_manual_send_does_not_block_asking_again()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_first uuid;
  v_second uuid;
  v_now timestamptz := now();
begin
  select * into f from tap.mfixture();
  v_first := tap.manual_response(f, v_now, f.stage_one);

  update questionnaire_responses
     set status = 'completed', completed_at = v_now
   where id = v_first;

  v_second := tap.manual_response(f, v_now, f.stage_one);

  return next isnt(v_second, v_first, 'history is kept whole; asking again writes a new response');

  return next is(
    (select count(*)::int from questionnaire_responses
      where application_id = f.application_id and context = 'manual_sent'),
    2,
    'and both responses remain on the candidate'
  );
end;
$fn$;

create function tap.test_a_stage_send_and_a_manual_send_do_not_collide()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_now timestamptz := now();
begin
  select * into f from tap.mfixture();

  insert into questionnaire_responses (
    questionnaire_template_id, application_id, context, status, sent_at, stage_action_id
  )
  values (f.questionnaire_id, f.application_id, 'stage_sent', 'pending', v_now, f.action_id);

  perform tap.manual_response(f, v_now, f.stage_one);

  return next is(
    (select count(*)::int from questionnaire_responses where application_id = f.application_id),
    2,
    'the two indexes constrain different things and do not fight'
  );
end;
$fn$;


-- ── The two new columns belong to a manual send and to nothing else ──────────

create function tap.test_the_manual_columns_are_refused_on_other_contexts()
returns setof text
language plpgsql
as $fn$
declare
  f record;
begin
  select * into f from tap.mfixture();

  return next throws_ok(
    format(
      $q$insert into questionnaire_responses
           (questionnaire_template_id, application_id, context, status, origin_stage_id)
         values (%L, %L, 'application_embedded', 'pending', %L)$q$,
      f.questionnaire_id, f.application_id, f.stage_one
    ),
    '23514',
    null,
    'an embedded application answer has no origin stage to carry'
  );

  return next throws_ok(
    format(
      $q$insert into questionnaire_responses
           (questionnaire_template_id, application_id, context, status, stage_action_id, reminder_config)
         values (%L, %L, 'stage_sent', 'pending', %L,
                 '{"enabled":true,"interval_minutes":[60],"max_count":2,"message_template_id":null}'::jsonb)$q$,
      f.questionnaire_id, f.application_id, f.action_id
    ),
    '23514',
    null,
    'a stage send reads its schedule from the stage action, never from itself'
  );
end;
$fn$;

create function tap.test_a_manual_reminder_schedule_is_validated_like_any_other()
returns setof text
language plpgsql
as $fn$
declare
  f record;
begin
  select * into f from tap.mfixture();

  return next throws_ok(
    format(
      $q$insert into questionnaire_responses
           (questionnaire_template_id, application_id, context, status, origin_stage_id, reminder_config)
         values (%L, %L, 'manual_sent', 'pending', %L, '{"max_count":3}'::jsonb)$q$,
      f.questionnaire_id, f.application_id, f.stage_one
    ),
    '23514',
    null,
    'a schedule the engine cannot read is refused at the door, not reinterpreted'
  );

  return next throws_ok(
    format(
      $q$insert into questionnaire_responses
           (questionnaire_template_id, application_id, context, status, origin_stage_id, reminder_config)
         values (%L, %L, 'manual_sent', 'pending', %L,
                 '{"enabled":true,"interval_minutes":[2880],"max_count":11,"message_template_id":null}'::jsonb)$q$,
      f.questionnaire_id, f.application_id, f.stage_one
    ),
    '23514',
    null,
    'and the ten-reminder ceiling is the same one stage actions are held to'
  );
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
