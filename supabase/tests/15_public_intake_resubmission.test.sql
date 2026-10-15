-- L4 — what a second submission to the same (person, position) may touch.
--
-- `submit_application` is the one function `anon` may call that writes. Identity
-- on the public intake path is an email address, and an email address is not a
-- secret: anyone who knows a candidate's address and a public position id can
-- send one unauthenticated POST to /api/apply naming them.
--
-- That is inherent to a public careers form and is not what these tests are
-- about. What they pin down is the boundary: such a request may create a NEW
-- candidacy, and it may never rewrite an EXISTING one. Before 0036 it could —
-- it replaced `application_form_answers`, deleted the embedded
-- `questionnaire_responses` row and inserted a fresh 'completed' one in its
-- place, and appended `documents` rows, all with no audit trail.
--
-- The questionnaire half is the one that escalates. Inserting a replacement
-- response with status 'completed' fires `questionnaire_responses_answer_routing`
-- (0022), so on any position whose application-embedded questionnaire carries
-- `answer_routing`, a visitor could pick the answer that routes a named
-- candidate to a terminal stage and have this system send the rejection. The
-- fixture below configures exactly that routing rule, so the escalation is
-- exercised rather than argued about.
begin;

create schema if not exists tap;

-- An open, listed position with an embedded questionnaire whose only question
-- routes the answer 'no' at the pipeline's rejection stage.
create function tap.ifixture()
returns table (
  position_id uuid, stage_one uuid, reject_stage uuid,
  questionnaire_id uuid, question_id uuid, email text
)
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_pipeline uuid;
  v_template_stage_one uuid;
  v_template_stage_reject uuid;
begin
  insert into pipelines (name) values ('pgTAP intake pipeline ' || v_seed)
  returning id into v_pipeline;

  insert into pipeline_template_stages (pipeline_id, name, sort_order)
  values (v_pipeline, 'Applied', 1) returning id into v_template_stage_one;
  insert into pipeline_template_stages (pipeline_id, name, sort_order)
  values (v_pipeline, 'Rejected', 2) returning id into v_template_stage_reject;

  insert into questionnaire_templates (name)
  values ('pgTAP intake questionnaire ' || v_seed) returning id into questionnaire_id;

  insert into questions (
    questionnaire_template_id, sort_order, type, prompt, options, answer_routing
  )
  values (
    questionnaire_id, 1, 'single_choice', 'Do you have the right to work?',
    '[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]'::jsonb,
    jsonb_build_array(
      jsonb_build_object(
        'option_value', 'no',
        'pipeline_template_stage_id', v_template_stage_reject
      )
    )
  )
  returning id into question_id;

  insert into positions (title, slug, status, publish_mode, assigned_pipeline_id,
                         application_questionnaire_id)
  values ('pgTAP intake position', 'pgtap-intake-' || v_seed, 'open', 'listed',
          v_pipeline, questionnaire_id)
  returning id into position_id;

  insert into position_stages (position_id, source_template_stage_id, name, sort_order)
  values (position_id, v_template_stage_one, 'Applied', 1) returning id into stage_one;
  insert into position_stages (position_id, source_template_stage_id, name, sort_order)
  values (position_id, v_template_stage_reject, 'Rejected', 2)
  returning id into reject_stage;

  email := 'pgtap-intake-' || v_seed || '@example.com';

  return next;
end;
$fn$;

-- One submission, expressed the way /api/apply builds it.
create function tap.intake(
  p_position_id uuid,
  p_email text,
  p_first text,
  p_form jsonb,
  p_question_id uuid,
  p_answer text,
  p_document text
)
returns uuid
language sql
as $fn$
  select (submit_application(jsonb_build_object(
    'positionId', p_position_id,
    'firstName', p_first,
    'email', p_email,
    'formAnswers', p_form,
    'questionnaireAnswers', jsonb_build_array(
      jsonb_build_object('questionId', p_question_id, 'value', to_jsonb(p_answer))
    ),
    'documents', jsonb_build_array(
      jsonb_build_object('kind', 'resume', 'storagePath', p_document, 'filename', 'cv.pdf')
    )
  ))->>'applicationId')::uuid;
$fn$;


-- ── The finding: a second submission must not rewrite the first ──────────────

create function tap.test_a_second_submission_cannot_rewrite_the_first()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_app uuid;
  v_app_again uuid;
  v_response uuid;
  v_response_after uuid;
begin
  select * into f from tap.ifixture();

  v_app := tap.intake(
    f.position_id, f.email, 'Genuine',
    jsonb_build_object('why_this_role', 'Because I want the job'),
    f.question_id, 'yes', 'applications/' || f.position_id || '/genuine-cv.pdf'
  );

  select id into v_response
    from questionnaire_responses
   where application_id = v_app and context = 'application_embedded';

  -- The attack: same email, same position, everything else the attacker's.
  v_app_again := tap.intake(
    f.position_id, f.email, 'Impostor',
    jsonb_build_object('why_this_role', 'I withdraw my application'),
    f.question_id, 'no', 'applications/' || f.position_id || '/impostor.pdf'
  );

  return next is(
    v_app_again, v_app,
    'a resubmission still resolves to the same candidacy — identity is unchanged'
  );

  return next is(
    (select application_form_answers->>'why_this_role' from applications where id = v_app),
    'Because I want the job',
    'the first submission''s application answers survive a second submission'
  );

  select id into v_response_after
    from questionnaire_responses
   where application_id = v_app and context = 'application_embedded';

  return next is(
    (select count(*)::int from questionnaire_responses
      where application_id = v_app and context = 'application_embedded'),
    1,
    'there is still exactly one embedded response on the application'
  );

  return next is(
    v_response_after, v_response,
    'and it is the SAME row — the public intake path never deletes or replaces a questionnaire response'
  );

  return next is(
    (select value #>> '{}' from answers where questionnaire_response_id = v_response),
    'yes',
    'the candidate''s own questionnaire answer is untouched'
  );

  return next is(
    (select count(*)::int from answers where questionnaire_response_id = v_response),
    1,
    'and no second answer was stacked onto their response'
  );

  return next is(
    (select count(*)::int from documents where application_id = v_app),
    1,
    'no attacker-supplied document was appended to the existing candidacy'
  );

  return next is(
    (select first_name from people where email = f.email),
    'Genuine',
    'the established identity keeps its own name'
  );
end;
$fn$;

-- The escalation, exercised directly.
--
-- Completing an embedded questionnaire enqueues an `answer_routing` row, and the
-- worker reads the answers off the referenced response at fire time. The fixture
-- routes the answer 'no' at the terminal stage, so the attack is: replace the
-- response, and the queue row the worker is about to act on now carries somebody
-- else's answer.
--
-- Counting the queue rows is not enough to see this — deleting the old response
-- cascades its queue row away, so the count is 1 either way. What has to hold is
-- that the pending routing decision is still the SAME row, still pointing at the
-- response the genuine applicant filled in.
create function tap.test_a_second_submission_cannot_redirect_a_routing_decision()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_app uuid;
  v_response uuid;
  v_routing uuid;
  v_routing_after uuid;
begin
  select * into f from tap.ifixture();

  v_app := tap.intake(
    f.position_id, f.email, 'Genuine', '{}'::jsonb,
    f.question_id, 'yes', 'applications/' || f.position_id || '/genuine-cv.pdf'
  );

  select id into v_response
    from questionnaire_responses
   where application_id = v_app and context = 'application_embedded';

  select id into v_routing
    from scheduled_actions where application_id = v_app and kind = 'answer_routing';

  return next isnt(
    v_routing, null,
    'the genuine applicant''s own answer did queue a routing decision — the trigger is live'
  );

  perform tap.intake(
    f.position_id, f.email, 'Impostor', '{}'::jsonb,
    f.question_id, 'no', 'applications/' || f.position_id || '/impostor.pdf'
  );

  select id into v_routing_after
    from scheduled_actions where application_id = v_app and kind = 'answer_routing';

  return next is(
    v_routing_after, v_routing,
    'a resubmission does not replace the pending routing decision — no visitor can redirect one'
  );

  return next is(
    (select questionnaire_response_id from scheduled_actions where id = v_routing),
    v_response,
    'and it still reads the response the genuine applicant filled in'
  );

  return next is(
    (select count(*)::int from scheduled_actions
      where application_id = v_app and kind = 'answer_routing'),
    1,
    'exactly one routing decision is pending, not a second one from the attacker'
  );

  return next is(
    (select current_stage_id from applications where id = v_app),
    f.stage_one,
    'and the candidate is still standing where their own application put them'
  );
end;
$fn$;

-- The counterweight. Everything above is worthless if it was bought by breaking
-- the intake itself, so the ordinary first-time path is asserted whole.
create function tap.test_a_first_time_applicant_is_recorded_in_full()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_app uuid;
  v_response uuid;
begin
  select * into f from tap.ifixture();

  v_app := tap.intake(
    f.position_id, f.email, 'Genuine',
    jsonb_build_object('why_this_role', 'Because I want the job'),
    f.question_id, 'no', 'applications/' || f.position_id || '/genuine-cv.pdf'
  );

  return next isnt(v_app, null, 'a first-time applicant gets an application');

  return next is(
    (select current_stage_id from applications where id = v_app),
    f.stage_one,
    'at the position''s first stage'
  );

  return next is(
    (select application_form_answers->>'why_this_role' from applications where id = v_app),
    'Because I want the job',
    'with their application-form answers stored'
  );

  select id into v_response
    from questionnaire_responses
   where application_id = v_app and context = 'application_embedded';

  return next isnt(v_response, null, 'and an embedded questionnaire response');

  return next is(
    (select status::text from questionnaire_responses where id = v_response),
    'completed',
    'recorded as completed, because they answered it as part of applying'
  );

  return next is(
    (select value #>> '{}' from answers where questionnaire_response_id = v_response),
    'no',
    'carrying the answer they actually gave'
  );

  return next is(
    (select count(*)::int from documents where application_id = v_app),
    1,
    'and their uploaded CV is linked to the candidacy'
  );

  return next is(
    (select count(*)::int from scheduled_actions
      where application_id = v_app and kind = 'answer_routing'),
    1,
    'answer routing still fires for a genuine public applicant'
  );
end;
$fn$;

-- A different applicant is a different candidacy, so the no-op above must be
-- keyed on the pair and not on the position.
create function tap.test_a_different_email_still_opens_its_own_candidacy()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_first uuid;
  v_second uuid;
begin
  select * into f from tap.ifixture();

  v_first := tap.intake(
    f.position_id, f.email, 'First', '{}'::jsonb,
    f.question_id, 'yes', 'applications/' || f.position_id || '/first.pdf'
  );

  v_second := tap.intake(
    f.position_id, 'other-' || f.email, 'Second',
    jsonb_build_object('why_this_role', 'Mine'),
    f.question_id, 'yes', 'applications/' || f.position_id || '/second.pdf'
  );

  return next isnt(v_second, v_first, 'a second person applying to the same role gets their own application');

  return next is(
    (select application_form_answers->>'why_this_role' from applications where id = v_second),
    'Mine',
    'and their own answers are recorded'
  );
end;
$fn$;

-- Stated as a database fact rather than as a property of the function, so a
-- future writer of `application_embedded` rows inherits it.
create function tap.test_an_application_can_hold_only_one_embedded_response()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_app uuid;
begin
  select * into f from tap.ifixture();

  v_app := tap.intake(
    f.position_id, f.email, 'Genuine', '{}'::jsonb,
    f.question_id, 'yes', 'applications/' || f.position_id || '/genuine-cv.pdf'
  );

  return next throws_ok(
    format(
      $q$insert into questionnaire_responses
           (questionnaire_template_id, application_id, context, status)
         select questionnaire_template_id, application_id, context, 'pending'
           from questionnaire_responses
          where application_id = %L and context = 'application_embedded'$q$,
      v_app
    ),
    '23505',
    null,
    'a second application_embedded response on one application is refused by the database'
  );
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
