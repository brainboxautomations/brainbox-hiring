-- L4 — the reminder sub-engine and answer-based routing.
--
-- The two guarantees that matter most here cannot be checked by clicking:
--
--   * a reminder chain terminates — always, under retry, under concurrency, and
--     under a questionnaire nobody ever completes; and
--   * a routing target that no longer resolves leaves the candidate exactly where
--     they are, rather than being guessed at.
--
-- Both live in the database, so both are asserted against the real schema here.
-- As in 09, every helper takes the instant it should reason about, so a two-day
-- reminder interval is assertable without waiting two days.
begin;

create schema if not exists tap;

-- A pipeline template, a position snapshotted from it, a questionnaire whose
-- choice question routes "no" at the template's rejection stage, one candidate,
-- and a Send Questionnaire action on stage one.
create function tap.rfixture()
returns table (
  position_id uuid, stage_one uuid, stage_two uuid, reject_stage uuid,
  template_stage_two uuid, template_stage_reject uuid,
  questionnaire_id uuid, question_id uuid, person_id uuid,
  application_id uuid, action_id uuid
)
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_pipeline uuid;
  v_template_stage_one uuid;
begin
  insert into pipelines (name) values ('pgTAP routing pipeline ' || v_seed)
  returning id into v_pipeline;

  insert into pipeline_template_stages (pipeline_id, name, sort_order)
  values (v_pipeline, 'Applied', 1) returning id into v_template_stage_one;
  insert into pipeline_template_stages (pipeline_id, name, sort_order)
  values (v_pipeline, 'Interview', 2) returning id into template_stage_two;
  insert into pipeline_template_stages (pipeline_id, name, sort_order)
  values (v_pipeline, 'Rejected', 3) returning id into template_stage_reject;

  insert into positions (title, slug, status, assigned_pipeline_id)
  values ('pgTAP routing position', 'pgtap-rem-' || v_seed, 'draft', v_pipeline)
  returning id into position_id;

  insert into position_stages (position_id, source_template_stage_id, name, sort_order)
  values (position_id, v_template_stage_one, 'Applied', 1) returning id into stage_one;
  insert into position_stages (position_id, source_template_stage_id, name, sort_order)
  values (position_id, template_stage_two, 'Interview', 2) returning id into stage_two;
  insert into position_stages (position_id, source_template_stage_id, name, sort_order)
  values (position_id, template_stage_reject, 'Rejected', 3)
  returning id into reject_stage;

  insert into questionnaire_templates (name)
  values ('pgTAP routing questionnaire') returning id into questionnaire_id;

  insert into questions (
    questionnaire_template_id, sort_order, type, prompt, options, answer_routing
  )
  values (
    questionnaire_id, 1, 'single_choice', 'Do you have the right to work?',
    '[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('option_value', 'no', 'pipeline_template_stage_id', template_stage_reject)
    )
  )
  returning id into question_id;

  insert into people (first_name, email)
  values ('Pgtap', 'pgtap-rem-' || v_seed || '@example.com') returning id into person_id;

  insert into applications (person_id, position_id, current_stage_id)
  values (person_id, position_id, stage_one) returning id into application_id;

  insert into stage_actions (position_stage_id, type, delay_minutes, questionnaire_template_id)
  values (stage_one, 'send_questionnaire', 0, questionnaire_id) returning id into action_id;

  return next;
end;
$fn$;

-- A schedule of n reminders, one day apart, as the worker would hand it over.
create function tap.schedule_of(p_count integer, p_from timestamptz)
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

create function tap.pending_response(f record, p_now timestamptz)
returns uuid
language plpgsql
as $fn$
declare
  v_id uuid;
begin
  insert into questionnaire_responses (
    questionnaire_template_id, application_id, context, status, sent_at, stage_action_id
  )
  values (f.questionnaire_id, f.application_id, 'stage_sent', 'pending', p_now, f.action_id)
  returning id into v_id;

  return v_id;
end;
$fn$;


-- ── a reminder run is a finite set of queue rows ─────────────────────────────

create function tap.test_a_reminder_run_is_written_once_and_is_finite()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_now timestamptz := now();
  v_queued integer;
begin
  select * into f from tap.rfixture();
  v_response := tap.pending_response(f, v_now);

  v_queued := schedule_questionnaire_reminders(v_response, tap.schedule_of(3, v_now), v_now);

  return next is(v_queued, 3, 'the schedule handed over is what gets queued');

  return next is(
    (select count(*)::int from scheduled_actions
      where questionnaire_response_id = v_response and kind = 'reminder'),
    3,
    'each reminder is one row in the same queue every other action uses'
  );

  return next is(
    (select array_agg(reminder_number order by reminder_number)::int[]
       from scheduled_actions where questionnaire_response_id = v_response),
    array[1, 2, 3],
    'the reminders are numbered from one, in order'
  );

  return next is(
    (select count(distinct origin_stage_id)::int from scheduled_actions
      where questionnaire_response_id = v_response),
    1,
    'every reminder carries the stage that sent the questionnaire'
  );

  return next is(
    (select distinct origin_stage_id from scheduled_actions
      where questionnaire_response_id = v_response),
    f.stage_one,
    'and that stage is the one the Send Questionnaire action sits on'
  );

  -- The idempotency guarantee. A worker that crashed between sending and
  -- settling, or two workers overlapping, must not double-book a reminder.
  v_queued := schedule_questionnaire_reminders(v_response, tap.schedule_of(3, v_now), v_now);

  return next is(v_queued, 0, 'scheduling the same run twice queues nothing the second time');

  return next is(
    (select count(*)::int from scheduled_actions where questionnaire_response_id = v_response),
    3,
    'so a candidate cannot be chased twice for the same reminder'
  );
end;
$fn$;

create function tap.test_a_reminder_run_cannot_exceed_the_hard_cap()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_now timestamptz := now();
begin
  select * into f from tap.rfixture();
  v_response := tap.pending_response(f, v_now);

  -- 25 reminders offered. Ten is the ceiling, and it is enforced here rather than
  -- trusted to the caller: an unbounded reminder loop emails a candidate forever.
  perform schedule_questionnaire_reminders(v_response, tap.schedule_of(25, v_now), v_now);

  return next is(
    (select count(*)::int from scheduled_actions where questionnaire_response_id = v_response),
    10,
    'a reminder run stops at ten however many the caller asks for'
  );

  return next throws_ok(
    format(
      $q$insert into scheduled_actions
           (application_id, origin_stage_id, scheduled_for, kind, questionnaire_response_id, reminder_number)
         values (%L, %L, now(), 'reminder', %L, 11)$q$,
      f.application_id, f.stage_one, v_response
    ),
    '23514',
    null,
    'an eleventh reminder cannot be written by hand either'
  );

  return next throws_ok(
    format(
      $q$insert into scheduled_actions
           (application_id, origin_stage_id, scheduled_for, kind, questionnaire_response_id, reminder_number)
         values (%L, %L, now(), 'reminder', %L, 0)$q$,
      f.application_id, f.stage_one, v_response
    ),
    '23514',
    null,
    'and reminder numbering starts at one'
  );

  return next throws_ok(
    format(
      $q$insert into scheduled_actions
           (application_id, origin_stage_id, scheduled_for, kind, questionnaire_response_id)
         values (%L, %L, now(), 'reminder', %L)$q$,
      f.application_id, f.stage_one, v_response
    ),
    '23514',
    null,
    'a reminder with no place in the schedule is not a row this queue can hold'
  );

  return next throws_ok(
    format(
      $q$insert into scheduled_actions
           (application_id, origin_stage_id, scheduled_for, kind, reminder_number)
         values (%L, %L, now(), 'reminder', 1)$q$,
      f.application_id, f.stage_one
    ),
    '23514',
    null,
    'and a reminder that chases no questionnaire is not either'
  );
end;
$fn$;


-- ── all four stop conditions ─────────────────────────────────────────────────

create function tap.test_completing_the_questionnaire_stops_the_reminders()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_now timestamptz := now();
  v_claimed uuid;
begin
  select * into f from tap.rfixture();
  v_response := tap.pending_response(f, v_now);
  perform schedule_questionnaire_reminders(v_response, tap.schedule_of(3, v_now), v_now);

  -- One reminder has already gone out, and a second is in a worker's hands.
  update scheduled_actions set status = 'claimed', claimed_at = v_now
   where questionnaire_response_id = v_response and reminder_number = 1
  returning id into v_claimed;
  update scheduled_actions set status = 'sent', completed_at = v_now
   where id = v_claimed;

  update scheduled_actions set status = 'claimed', claimed_at = v_now
   where questionnaire_response_id = v_response and reminder_number = 2;

  update questionnaire_responses
     set status = 'completed', completed_at = now()
   where id = v_response;

  return next is(
    (select status::text from scheduled_actions
      where questionnaire_response_id = v_response and reminder_number = 3),
    'cancelled',
    'completing the questionnaire cancels the reminders still pending'
  );

  return next is(
    (select status::text from scheduled_actions
      where questionnaire_response_id = v_response and reminder_number = 1),
    'sent',
    'a reminder that has already gone out is not recalled'
  );

  return next is(
    (select status::text from scheduled_actions
      where questionnaire_response_id = v_response and reminder_number = 2),
    'claimed',
    'and one a worker has claimed is not stolen back mid-send'
  );
end;
$fn$;

create function tap.test_moving_stage_stops_the_reminders()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_now timestamptz := now();
begin
  select * into f from tap.rfixture();
  v_response := tap.pending_response(f, v_now);
  perform schedule_questionnaire_reminders(v_response, tap.schedule_of(3, v_now), v_now);

  update applications set current_stage_id = f.stage_two where id = f.application_id;

  return next is(
    (select count(*)::int from scheduled_actions
      where questionnaire_response_id = v_response and status = 'cancelled'),
    3,
    'leaving the stage cancels every reminder it scheduled (cancel-on-move covers this already)'
  );
end;
$fn$;

create function tap.test_a_user_can_stop_the_reminders_by_hand()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_now timestamptz := now();
begin
  select * into f from tap.rfixture();
  v_response := tap.pending_response(f, v_now);
  perform schedule_questionnaire_reminders(v_response, tap.schedule_of(4, v_now), v_now);

  update questionnaire_responses set reminders_stopped_at = now() where id = v_response;

  return next is(
    (select count(*)::int from scheduled_actions
      where questionnaire_response_id = v_response and status = 'cancelled'),
    4,
    'a manual stop cancels the whole remaining run'
  );

  -- And the producer will not undo it. A stop that a later send could reverse
  -- would not be a stop.
  return next is(
    schedule_questionnaire_reminders(v_response, tap.schedule_of(3, v_now), v_now),
    0,
    'and nothing can re-queue reminders for a stopped questionnaire'
  );
end;
$fn$;

create function tap.test_a_completed_questionnaire_is_never_chased()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_now timestamptz := now();
begin
  select * into f from tap.rfixture();

  insert into questionnaire_responses (
    questionnaire_template_id, application_id, context, status, sent_at, completed_at, stage_action_id
  )
  values (
    f.questionnaire_id, f.application_id, 'stage_sent', 'completed', v_now, v_now, f.action_id
  )
  returning id into v_response;

  return next is(
    schedule_questionnaire_reminders(v_response, tap.schedule_of(3, v_now), v_now),
    0,
    'a questionnaire that is already complete is never chased'
  );
end;
$fn$;

create function tap.test_deleting_the_questionnaire_action_stops_its_reminders()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_now timestamptz := now();
begin
  select * into f from tap.rfixture();
  v_response := tap.pending_response(f, v_now);
  perform schedule_questionnaire_reminders(v_response, tap.schedule_of(3, v_now), v_now);

  delete from stage_actions where id = f.action_id;

  return next is(
    (select count(*)::int from scheduled_actions
      where questionnaire_response_id = v_response and status = 'pending'),
    0,
    'deleting the action that sends a questionnaire leaves no reminders behind'
  );
end;
$fn$;


-- ── an unusable reminder configuration is unrepresentable ────────────────────

create function tap.test_a_reminder_configuration_is_checked_by_the_database()
returns setof text
language plpgsql
as $fn$
declare
  f record;
begin
  select * into f from tap.rfixture();

  return next lives_ok(
    format(
      $q$update stage_actions
            set reminder_config = '{"enabled":true,"interval_minutes":[2880],"max_count":3,"message_template_id":null}'::jsonb
          where id = %L$q$,
      f.action_id
    ),
    'a schedule of intervals and a maximum count is stored as configured'
  );

  return next throws_ok(
    format(
      $q$update stage_actions set reminder_config = '{"enabled":true,"interval_minutes":[2880],"max_count":50}'::jsonb where id = %L$q$,
      f.action_id
    ),
    '23514',
    null,
    'a maximum count past the hard cap is refused'
  );

  return next throws_ok(
    format(
      $q$update stage_actions set reminder_config = '{"enabled":true,"interval_minutes":[],"max_count":3}'::jsonb where id = %L$q$,
      f.action_id
    ),
    '23514',
    null,
    'a schedule with no intervals is refused'
  );

  return next throws_ok(
    format(
      $q$update stage_actions set reminder_config = '{"enabled":true,"interval_minutes":[0],"max_count":3}'::jsonb where id = %L$q$,
      f.action_id
    ),
    '23514',
    null,
    'an interval of zero minutes — which would fire the whole run at once — is refused'
  );

  return next throws_ok(
    format(
      $q$update stage_actions set reminder_config = '{"interval_minutes":[60],"max_count":3}'::jsonb where id = %L$q$,
      f.action_id
    ),
    '23514',
    null,
    'a configuration that does not say whether it is enabled is refused'
  );

  return next throws_ok(
    format(
      $q$insert into stage_actions (position_stage_id, type, message_template_id, reminder_config)
         values (%L, 'send_email', null, '{"enabled":true,"interval_minutes":[60],"max_count":1}'::jsonb)$q$,
      f.stage_one
    ),
    '23514',
    null,
    'a reminder block belongs to a Send Questionnaire action and to nothing else'
  );
end;
$fn$;


-- ── completing a questionnaire queues a routing evaluation ───────────────────

create function tap.test_completing_a_questionnaire_queues_a_routing_evaluation()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_now timestamptz := now();
begin
  select * into f from tap.rfixture();
  v_response := tap.pending_response(f, v_now);

  return next is(
    (select count(*)::int from scheduled_actions
      where questionnaire_response_id = v_response and kind = 'answer_routing'),
    0,
    'a questionnaire that has only been sent routes nobody'
  );

  update questionnaire_responses set status = 'completed', completed_at = now()
   where id = v_response;

  return next is(
    (select count(*)::int from scheduled_actions
      where questionnaire_response_id = v_response and kind = 'answer_routing'),
    1,
    'completing it queues exactly one routing evaluation'
  );

  return next is(
    (select origin_stage_id from scheduled_actions
      where questionnaire_response_id = v_response and kind = 'answer_routing'),
    f.stage_one,
    'queued against the stage the candidate is in, so a manual move cancels it'
  );

  -- Re-completing must not queue a second move. The unique index is what makes
  -- that true rather than the trigger being careful.
  update questionnaire_responses set status = 'pending' where id = v_response;
  update questionnaire_responses set status = 'completed' where id = v_response;

  return next is(
    (select count(*)::int from scheduled_actions
      where questionnaire_response_id = v_response and kind = 'answer_routing'),
    1,
    'and completing it again cannot move the candidate a second time'
  );
end;
$fn$;

create function tap.test_a_questionnaire_with_no_routing_queues_nothing()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_plain uuid;
  v_response uuid;
begin
  select * into f from tap.rfixture();

  insert into questionnaire_templates (name) values ('pgTAP plain questionnaire')
  returning id into v_plain;
  insert into questions (questionnaire_template_id, sort_order, type, prompt)
  values (v_plain, 1, 'short_text', 'Tell us about yourself');

  insert into questionnaire_responses (
    questionnaire_template_id, application_id, context, status, completed_at
  )
  values (v_plain, f.application_id, 'application_embedded', 'completed', now())
  returning id into v_response;

  return next is(
    (select count(*)::int from scheduled_actions where questionnaire_response_id = v_response),
    0,
    'a questionnaire that routes nowhere does not put work in the queue'
  );
end;
$fn$;

create function tap.test_the_public_application_path_routes_too()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_result jsonb;
  v_app uuid;
begin
  select * into f from tap.rfixture();

  update positions
     set status = 'open', publish_mode = 'listed', application_questionnaire_id = f.questionnaire_id
   where id = f.position_id;

  -- The public intake path: anon submits, the embedded questionnaire is recorded complete,
  -- and routing has to be queued from SQL that no Route Handler ever sees.
  v_result := submit_application(jsonb_build_object(
    'positionId', f.position_id,
    'firstName', 'Publicly',
    'email', 'pgtap-apply-' || v_seed || '@example.com',
    'formAnswers', '{}'::jsonb,
    'questionnaireAnswers', jsonb_build_array(
      jsonb_build_object('questionId', f.question_id, 'value', to_jsonb('no'::text))
    ),
    'documents', '[]'::jsonb
  ));

  v_app := (v_result->>'applicationId')::uuid;

  return next is(
    (select count(*)::int from scheduled_actions
      where application_id = v_app and kind = 'answer_routing'),
    1,
    'a public applicant who answers a routing question is queued for routing'
  );

  return next is(
    (select count(*)::int from application_stage_entries where application_id = v_app),
    1,
    'and the first stage still fired through the same producer'
  );
end;
$fn$;


-- ── resolving a routing target, and refusing to guess ────────────────────────

create function tap.test_the_on_completion_target_is_resolved_and_frozen()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
begin
  select * into f from tap.rfixture();

  update questionnaire_templates
     set on_completion_template_stage_id = f.template_stage_two
   where id = f.questionnaire_id;

  insert into questionnaire_responses (
    questionnaire_template_id, application_id, context, status
  )
  values (f.questionnaire_id, f.application_id, 'stage_sent', 'pending')
  returning id into v_response;

  return next is(
    (select on_completion_move_to_stage_id from questionnaire_responses where id = v_response),
    f.stage_two,
    'the on-completion stage is resolved to this position''s own stage when the response is created'
  );

  -- Editing the template afterwards must not redirect a questionnaire that is
  -- already with the candidate.
  update questionnaire_templates
     set on_completion_template_stage_id = f.template_stage_reject
   where id = f.questionnaire_id;

  return next is(
    (select on_completion_move_to_stage_id from questionnaire_responses where id = v_response),
    f.stage_two,
    'and it is frozen, so a later template edit does not redirect a questionnaire already sent'
  );
end;
$fn$;

create function tap.test_an_unresolvable_routing_target_resolves_to_nothing()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
begin
  select * into f from tap.rfixture();

  -- The link between a template stage and a position stage is
  -- `on delete set null`. Deleting the template stage severs it permanently.
  delete from pipeline_template_stages where id = f.template_stage_two;

  return next is(
    position_stage_for_template_stage(f.position_id, f.template_stage_two),
    null::uuid,
    'a severed template link resolves to nothing — never to the first or the next stage'
  );

  update questionnaire_templates
     set on_completion_template_stage_id = f.template_stage_reject
   where id = f.questionnaire_id;

  -- A template stage that belongs to another pipeline entirely is not this
  -- position's business either.
  return next is(
    position_stage_for_template_stage(
      f.position_id,
      (select id from pipeline_template_stages
         where pipeline_id <> (select assigned_pipeline_id from positions where id = f.position_id)
         limit 1)
    ),
    null::uuid,
    'and a template stage from another pipeline resolves to nothing'
  );

  insert into questionnaire_responses (
    questionnaire_template_id, application_id, context, status, completed_at
  )
  values (f.questionnaire_id, f.application_id, 'stage_sent', 'completed', now())
  returning id into v_response;

  -- The candidate must not be moved, and the attempt must not vanish: the queue
  -- row is where the worker records why nothing happened.
  return next is(
    (select count(*)::int from scheduled_actions
      where questionnaire_response_id = v_response and kind = 'answer_routing'),
    1,
    'a routing rule that cannot be resolved is still queued, so the reason gets recorded'
  );

  return next is(
    (select current_stage_id from applications where id = f.application_id),
    f.stage_one,
    'and the candidate has not been moved anywhere in the meantime'
  );
end;
$fn$;

create function tap.test_a_candidate_in_no_stage_is_not_queued_for_routing()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
begin
  select * into f from tap.rfixture();

  update applications set current_stage_id = null where id = f.application_id;

  insert into questionnaire_responses (
    questionnaire_template_id, application_id, context, status, completed_at
  )
  values (f.questionnaire_id, f.application_id, 'application_embedded', 'completed', now())
  returning id into v_response;

  return next is(
    (select count(*)::int from scheduled_actions where questionnaire_response_id = v_response),
    0,
    'a candidate who is in no stage has no stage to be routed out of'
  );
end;
$fn$;

create function tap.test_answer_routing_is_stored_as_a_list_of_rules()
returns setof text
language plpgsql
as $fn$
declare
  f record;
begin
  select * into f from tap.rfixture();

  return next is(
    (select answer_routing->0->>'pipeline_template_stage_id' from questions where id = f.question_id),
    f.template_stage_reject::text,
    'a routing rule names a pipeline template stage, never a position stage'
  );

  return next throws_ok(
    format($q$update questions set answer_routing = '{"option_value":"no"}'::jsonb where id = %L$q$,
           f.question_id),
    '23514',
    null,
    'answer routing is a list of rules, and anything else is refused'
  );
end;
$fn$;


-- ── The queue's own vocabulary ───────────────────────────────────────────────

create function tap.test_a_stage_action_row_carries_no_questionnaire_payload()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
begin
  select * into f from tap.rfixture();
  v_response := tap.pending_response(f, now());

  return next is(
    (select count(*)::int from scheduled_actions
      where application_id = f.application_id and kind = 'stage_action'
        and questionnaire_response_id is null and reminder_number is null),
    (select count(*)::int from scheduled_actions
      where application_id = f.application_id and kind = 'stage_action'),
    'every stage-action row carries no reminder or questionnaire payload'
  );

  return next throws_ok(
    format(
      $q$insert into scheduled_actions
           (application_id, origin_stage_id, scheduled_for, kind, questionnaire_response_id, reminder_number)
         values (%L, %L, now(), 'stage_action', %L, 1)$q$,
      f.application_id, f.stage_one, v_response
    ),
    '23514',
    null,
    'and one cannot be given a reminder number by hand'
  );

  return next throws_ok(
    format(
      $q$insert into scheduled_actions
           (application_id, origin_stage_id, scheduled_for, kind, questionnaire_response_id, reminder_number)
         values (%L, %L, now(), 'answer_routing', %L, 2)$q$,
      f.application_id, f.stage_one, v_response
    ),
    '23514',
    null,
    'a routing evaluation is not part of a reminder schedule either'
  );
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
