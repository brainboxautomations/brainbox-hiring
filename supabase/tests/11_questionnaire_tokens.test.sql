-- L4 — the hosted questionnaire token model.
--
-- Everything that makes this credential a credential lives in the database, so
-- everything that makes it safe is asserted here rather than through a browser:
--
--   * a token cannot be forged — a value nobody issued resolves to nothing;
--   * the stored value is a digest, so read access to this table is not the same
--     thing as access to a candidate's questionnaire;
--   * an expired token resolves to nothing, and the expiry cannot be argued with
--     by the caller, because the anon-facing functions take no clock parameter;
--   * a completed questionnaire cannot be replayed, so a leaked link cannot
--     overwrite answers that were already submitted;
--   * `answer_routing` never reaches the candidate being routed by it;
--   * completing through this path fires the existing triggers — reminders stop
--     and the routing evaluation is queued — because this path must not
--     reimplement either.
--
-- Role switching follows the L4 convention established in 04: seed as the
-- session role, switch to anon, capture into variables, `reset role`, and only
-- then assert.
begin;

create schema if not exists tap;

-- A pipeline template, a position snapshotted from it, a questionnaire whose
-- choice question routes "no" at the rejection stage, one candidate at stage
-- one, and a Send Questionnaire action — the same shape as 10's fixture,
-- because this is the same journey one step further on.
create function tap.tfixture()
returns table (
  position_id uuid, stage_one uuid, reject_stage uuid, template_stage_reject uuid,
  questionnaire_id uuid, question_id uuid, other_question_id uuid,
  person_id uuid, application_id uuid, action_id uuid
)
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_pipeline uuid;
  v_template_stage_one uuid;
  v_other_questionnaire uuid;
begin
  insert into pipelines (name) values ('pgTAP token pipeline ' || v_seed)
  returning id into v_pipeline;

  insert into pipeline_template_stages (pipeline_id, name, sort_order)
  values (v_pipeline, 'Applied', 1) returning id into v_template_stage_one;
  insert into pipeline_template_stages (pipeline_id, name, sort_order)
  values (v_pipeline, 'Rejected', 2) returning id into template_stage_reject;

  insert into positions (title, slug, status, assigned_pipeline_id)
  values ('pgTAP token position', 'pgtap-tok-' || v_seed, 'draft', v_pipeline)
  returning id into position_id;

  insert into position_stages (position_id, source_template_stage_id, name, sort_order)
  values (position_id, v_template_stage_one, 'Applied', 1) returning id into stage_one;
  insert into position_stages (position_id, source_template_stage_id, name, sort_order)
  values (position_id, template_stage_reject, 'Rejected', 2)
  returning id into reject_stage;

  insert into questionnaire_templates (name)
  values ('pgTAP token questionnaire') returning id into questionnaire_id;

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

  -- A question on a different questionnaire entirely. Nothing this token
  -- addresses may reach it, and no answer may be filed against it.
  insert into questionnaire_templates (name)
  values ('pgTAP other questionnaire') returning id into v_other_questionnaire;

  insert into questions (questionnaire_template_id, sort_order, type, prompt)
  values (v_other_questionnaire, 1, 'short_text', 'Somebody else''s question')
  returning id into other_question_id;

  insert into people (first_name, email)
  values ('Pgtap', 'pgtap-tok-' || v_seed || '@example.com') returning id into person_id;

  insert into applications (person_id, position_id, current_stage_id)
  values (person_id, position_id, stage_one) returning id into application_id;

  insert into stage_actions (position_stage_id, type, delay_minutes, questionnaire_template_id)
  values (stage_one, 'send_questionnaire', 0, questionnaire_id) returning id into action_id;

  return next;
end;
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


-- ── The digest ───────────────────────────────────────────────────────────────

create function tap.test_the_stored_value_is_a_digest_not_the_token()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_token text := 'pgtap-token-not-random-on-purpose';
  v_stored text;
begin
  select * into f from tap.tfixture();
  v_response := tap.pending_response(f, now());

  perform issue_questionnaire_access_token(v_response, v_token, now(), now() + interval '30 days');

  select access_token_hash into v_stored
    from questionnaire_responses where id = v_response;

  return next isnt(v_stored, v_token, 'the raw token is never what lands in the column');

  return next matches(v_stored, '^[0-9a-f]{64}$',
    'what is stored is 64 lower-case hex characters — a sha256 digest');

  -- A known-answer vector. If anybody ever "optimises" the hash, this fails
  -- rather than silently invalidating every link already in a candidate inbox.
  return next is(
    questionnaire_token_hash('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'questionnaire_token_hash is plain sha256 of the utf8 bytes, hex encoded'
  );

  return next is(
    questionnaire_token_hash(''), null::text,
    'a blank token hashes to NULL, so it can never match a stored digest'
  );

  return next is(
    questionnaire_token_hash(null), null::text,
    'and so does a null token'
  );
end;
$fn$;


-- ── Forgery ──────────────────────────────────────────────────────────────────

create function tap.test_a_token_nobody_issued_reaches_nothing()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_forged text := 'this-token-was-never-issued-by-anyone';
  v_state text;
  v_rows int;
  v_questions int;
  v_raised boolean := false;
begin
  select * into f from tap.tfixture();
  v_response := tap.pending_response(f, now());
  perform issue_questionnaire_access_token(
    v_response, 'the-real-token', now(), now() + interval '30 days'
  );

  set local role anon;
  select public_questionnaire_token_state(v_forged) into v_state;
  select count(*)::int into v_rows from public_questionnaire_by_token(v_forged);
  select count(*)::int into v_questions from public_questionnaire_questions_by_token(v_forged);
  reset role;

  -- Submitting is server-only since 0049, so it runs as the service role, as
  -- the route does. The refusal must come from the token, not from privileges.
  set local role service_role;
  begin
    perform submit_questionnaire_response(v_forged, '[]'::jsonb);
  exception when others then
    v_raised := true;
  end;
  reset role;

  return next is(v_state, 'unknown', 'a forged token is simply unknown — it names no response');
  return next is(v_rows, 0, 'and resolves to no questionnaire');
  return next is(v_questions, 0, 'and to no questions');
  return next ok(v_raised, 'and submitting with it is refused rather than silently accepted');

  -- The digest of the real token is what an attacker with read access to this
  -- table would hold. Passing it where the token goes must not work, or hashing
  -- would have bought nothing.
  set local role anon;
  select public_questionnaire_token_state(
    (select access_token_hash from questionnaire_responses where id = v_response)
  ) into v_state;
  reset role;

  return next is(v_state, 'unknown',
    'the stored digest is not itself a key — presenting it gets you nowhere');
end;
$fn$;


-- ── Expiry ───────────────────────────────────────────────────────────────────

create function tap.test_an_expired_token_resolves_to_nothing()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_token text := 'pgtap-expired-token';
  v_state text;
  v_rows int;
  v_questions int;
  v_raised boolean := false;
  v_answers int;
begin
  select * into f from tap.tfixture();
  v_response := tap.pending_response(f, now());
  perform issue_questionnaire_access_token(
    v_response, v_token, now() - interval '31 days', now() - interval '1 day'
  );

  set local role anon;
  select public_questionnaire_token_state(v_token) into v_state;
  select count(*)::int into v_rows from public_questionnaire_by_token(v_token);
  select count(*)::int into v_questions from public_questionnaire_questions_by_token(v_token);
  reset role;

  set local role service_role;
  begin
    perform submit_questionnaire_response(
      v_token, jsonb_build_array(jsonb_build_object('questionId', f.question_id, 'value', 'no'))
    );
  exception when others then
    v_raised := true;
  end;
  reset role;

  select count(*)::int into v_answers from answers where questionnaire_response_id = v_response;

  return next is(v_state, 'expired', 'the holder is told the link expired rather than left guessing');
  return next is(v_rows, 0, 'an expired token resolves to no questionnaire');
  return next is(v_questions, 0, 'and to no questions');
  return next ok(v_raised, 'and submitting past the expiry is refused');
  return next is(v_answers, 0, 'and no answer was written by the attempt');
end;
$fn$;

create function tap.test_expiry_is_on_the_boundary_and_cannot_be_argued_with()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_token text := 'pgtap-boundary-token';
  v_rows int;
begin
  select * into f from tap.tfixture();
  v_response := tap.pending_response(f, now());

  -- Exactly now: `> now()` means an expiry that has arrived is already past.
  update questionnaire_responses
     set access_token_hash = questionnaire_token_hash(v_token),
         access_token_issued_at = now() - interval '1 day',
         access_token_expires_at = now()
   where id = v_response;

  set local role anon;
  select count(*)::int into v_rows from public_questionnaire_by_token(v_token);
  reset role;

  return next is(v_rows, 0, 'an expiry of exactly now is expired, not still valid');

  -- The anon-facing functions take one argument, the token. There is no clock
  -- parameter an anonymous caller could set to a moment before the expiry.
  return next is(
    (select count(*)::int
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'public_questionnaire_token_state',
          'public_questionnaire_by_token',
          'public_questionnaire_questions_by_token'
        )
        and p.pronargs = 1),
    3,
    'no anon-facing resolver accepts a caller-supplied clock'
  );

  return next is(
    (select count(*)::int
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'submit_questionnaire_response'
        and p.pronargs = 2),
    1,
    'and neither does the submit path — it takes the token and the answers, nothing else'
  );
end;
$fn$;

create function tap.test_issuing_refuses_an_expiry_that_is_already_past()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_issued boolean;
  v_hash text;
begin
  select * into f from tap.tfixture();
  v_response := tap.pending_response(f, now());

  select issue_questionnaire_access_token(
    v_response, 'pgtap-dead-on-arrival', now(), now() - interval '1 second'
  ) into v_issued;

  select access_token_hash into v_hash from questionnaire_responses where id = v_response;

  return next is(v_issued, false, 'a token that would already be expired is not issued');
  return next is(v_hash, null::text, 'and nothing is written to the row');

  select issue_questionnaire_access_token(v_response, '   ', now(), now() + interval '30 days')
    into v_issued;

  return next is(v_issued, false, 'a blank token is refused rather than stored as an empty digest');
end;
$fn$;


-- ── Replay after completion ──────────────────────────────────────────────────

create function tap.test_a_completed_questionnaire_cannot_be_replayed()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_token text := 'pgtap-replay-token';
  v_state text;
  v_rows int;
  v_raised boolean := false;
  v_value jsonb;
  v_count int;
begin
  select * into f from tap.tfixture();
  v_response := tap.pending_response(f, now());
  perform issue_questionnaire_access_token(v_response, v_token, now(), now() + interval '30 days');

  set local role service_role;
  perform submit_questionnaire_response(
    v_token, jsonb_build_array(jsonb_build_object('questionId', f.question_id, 'value', 'yes'))
  );

  -- The same link, a second time, with a different answer.
  begin
    perform submit_questionnaire_response(
      v_token, jsonb_build_array(jsonb_build_object('questionId', f.question_id, 'value', 'no'))
    );
  exception when others then
    v_raised := true;
  end;
  reset role;

  set local role anon;
  select public_questionnaire_token_state(v_token) into v_state;
  select count(*)::int into v_rows from public_questionnaire_by_token(v_token);
  reset role;

  select value, count(*) over () into v_value, v_count
    from answers where questionnaire_response_id = v_response;

  return next ok(v_raised, 'the second submission is refused');
  return next is(v_value, '"yes"'::jsonb, 'and the original answer is untouched');
  return next is(v_count, 1, 'with no duplicate answer row left behind');
  return next is(v_state, 'completed', 'the holder is told it is already done');
  return next is(v_rows, 0, 'and the link resolves to nothing they could fill in again');

  return next ok(
    (select access_token_expires_at <= now() from questionnaire_responses where id = v_response),
    'completion also pulls the expiry back, so the link is dead twice over'
  );
end;
$fn$;


-- ── Single purpose ───────────────────────────────────────────────────────────

create function tap.test_a_token_reaches_exactly_one_response_and_no_further()
returns setof text
language plpgsql
as $fn$
declare
  f_one record;
  f_two record;
  v_response_one uuid;
  v_response_two uuid;
  v_token text := 'pgtap-single-purpose-token';
  v_title text;
  v_questions int;
  v_answers_here int;
  v_answers_elsewhere int;
begin
  select * into f_one from tap.tfixture();
  select * into f_two from tap.tfixture();

  v_response_one := tap.pending_response(f_one, now());
  v_response_two := tap.pending_response(f_two, now());

  perform issue_questionnaire_access_token(
    v_response_one, v_token, now(), now() + interval '30 days'
  );
  perform issue_questionnaire_access_token(
    v_response_two, 'pgtap-a-completely-different-token', now(), now() + interval '30 days'
  );

  set local role anon;
  select position_title into v_title from public_questionnaire_by_token(v_token);
  select count(*)::int into v_questions from public_questionnaire_questions_by_token(v_token);
  reset role;

  -- A tampered payload naming a question on somebody else's questionnaire.
  -- Submitted as the service role, as the route does since 0049.
  set local role service_role;
  perform submit_questionnaire_response(
    v_token,
    jsonb_build_array(
      jsonb_build_object('questionId', f_one.question_id, 'value', 'yes'),
      jsonb_build_object('questionId', f_one.other_question_id, 'value', 'smuggled')
    )
  );
  reset role;

  return next is(v_questions, 1, 'the token reaches only its own questionnaire''s questions');
  return next isnt(v_title, null, 'and does resolve the position it belongs to');

  select count(*)::int into v_answers_here
    from answers where questionnaire_response_id = v_response_one;
  select count(*)::int into v_answers_elsewhere
    from answers
   where questionnaire_response_id = v_response_one
     and question_id = f_one.other_question_id;

  return next is(v_answers_here, 1, 'only the answer that belongs to this questionnaire is stored');
  return next is(v_answers_elsewhere, 0,
    'a question smuggled in from another questionnaire is dropped, not filed');

  return next is(
    (select status::text from questionnaire_responses where id = v_response_two),
    'pending',
    'and the other candidate''s questionnaire is entirely unaffected'
  );
end;
$fn$;

create function tap.test_two_responses_cannot_share_a_token()
returns setof text
language plpgsql
as $fn$
declare
  f_one record;
  f_two record;
  v_one uuid;
  v_two uuid;
  v_token text := 'pgtap-collision-token';
  v_raised boolean := false;
begin
  select * into f_one from tap.tfixture();
  select * into f_two from tap.tfixture();
  v_one := tap.pending_response(f_one, now());
  v_two := tap.pending_response(f_two, now());

  perform issue_questionnaire_access_token(v_one, v_token, now(), now() + interval '30 days');

  begin
    perform issue_questionnaire_access_token(v_two, v_token, now(), now() + interval '30 days');
  exception when unique_violation then
    v_raised := true;
  end;

  return next ok(v_raised, 'one token cannot be made to address two questionnaires');
end;
$fn$;


-- ── What the candidate is allowed to see ─────────────────────────────────────

create function tap.test_answer_routing_never_reaches_the_candidate()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_token text := 'pgtap-routing-secrecy-token';
  v_direct int;
  v_columns int;
begin
  select * into f from tap.tfixture();
  v_response := tap.pending_response(f, now());
  perform issue_questionnaire_access_token(v_response, v_token, now(), now() + interval '30 days');

  set local role anon;
  select count(*)::int into v_direct from questions where id = f.question_id;
  reset role;

  return next is(v_direct, 0,
    'anon cannot read the questions table directly, so routing rules are not on the table surface');

  -- The function's own return type is the contract. Naming the columns rather
  -- than counting them means adding `answer_routing` to it fails here.
  select count(*)::int into v_columns
    from unnest(
      (select proargnames from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'public_questionnaire_questions_by_token')
    ) as column_name
   where column_name = 'answer_routing';

  return next is(v_columns, 0,
    'and public_questionnaire_questions_by_token does not return answer_routing either');

  -- The same rule for the questionnaire resolver: no ids, no candidate details.
  return next is(
    (select proargnames from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'public_questionnaire_by_token'),
    array['p_token', 'questionnaire_name', 'position_title', 'position_id', 'expires_at']::text[],
    'public_questionnaire_by_token returns only what the page renders and the uploads need'
  );
end;
$fn$;

create function tap.test_anon_cannot_read_the_response_table_at_all()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_rows int;
  v_any int;
begin
  select * into f from tap.tfixture();
  v_response := tap.pending_response(f, now());
  perform issue_questionnaire_access_token(
    v_response, 'pgtap-table-surface-token', now(), now() + interval '30 days'
  );

  set local role anon;
  select count(*)::int into v_rows from questionnaire_responses where id = v_response;
  -- The enumeration assertion, as in 04: not "our row is hidden" but "there is
  -- no query shape that returns a token hash".
  select count(*)::int into v_any
    from questionnaire_responses where access_token_hash is not null;
  reset role;

  return next is(v_rows, 0, 'anon cannot read a questionnaire response row');
  return next is(v_any, 0, 'and cannot sweep the table for issued token digests');
end;
$fn$;


-- ── The reminder and routing machinery must fire from this path ──────────────

create function tap.test_completing_through_the_token_fires_the_existing_triggers()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_token text := 'pgtap-triggers-token';
  v_cancelled int;
  v_pending int;
  v_routing int;
begin
  select * into f from tap.tfixture();
  v_response := tap.pending_response(f, now());
  perform issue_questionnaire_access_token(v_response, v_token, now(), now() + interval '30 days');

  -- A live reminder run, exactly as the worker would have written it.
  perform schedule_questionnaire_reminders(
    v_response,
    jsonb_build_array(
      jsonb_build_object('reminder_number', 1, 'scheduled_for', now() + interval '2 days'),
      jsonb_build_object('reminder_number', 2, 'scheduled_for', now() + interval '4 days')
    ),
    now()
  );

  set local role service_role;
  perform submit_questionnaire_response(
    v_token, jsonb_build_array(jsonb_build_object('questionId', f.question_id, 'value', 'no'))
  );
  reset role;

  select count(*)::int into v_cancelled
    from scheduled_actions
   where questionnaire_response_id = v_response and kind = 'reminder' and status = 'cancelled';
  select count(*)::int into v_pending
    from scheduled_actions
   where questionnaire_response_id = v_response and kind = 'reminder' and status = 'pending';
  select count(*)::int into v_routing
    from scheduled_actions
   where questionnaire_response_id = v_response and kind = 'answer_routing';

  return next is(v_cancelled, 2,
    'completing on the hosted page cancels the remaining reminders through 0022''s trigger');
  return next is(v_pending, 0, 'with nothing left pending to chase the candidate with');
  return next is(v_routing, 1,
    'and queues exactly one answer-routing evaluation through 0022''s trigger');

  -- This path must not have reimplemented either of these. Both are still triggers on
  -- the same table, which is what makes them fire whatever writes the row.
  return next has_trigger(
    'public'::name, 'questionnaire_responses'::name, 'questionnaire_responses_stop_reminders'::name,
    'the reminder canceller is still a trigger, not something the page remembers to call'
  );
  return next has_trigger(
    'public'::name, 'questionnaire_responses'::name, 'questionnaire_responses_answer_routing'::name,
    'and so is the answer-routing producer'
  );
end;
$fn$;

create function tap.test_a_token_cannot_be_issued_for_a_finished_questionnaire()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_issued boolean;
begin
  select * into f from tap.tfixture();
  v_response := tap.pending_response(f, now());

  update questionnaire_responses
     set status = 'completed', completed_at = now()
   where id = v_response;

  select issue_questionnaire_access_token(
    v_response, 'pgtap-too-late-token', now(), now() + interval '30 days'
  ) into v_issued;

  return next is(v_issued, false,
    'a completed questionnaire cannot be re-opened by issuing it a fresh link');

  select issue_questionnaire_access_token(
    gen_random_uuid(), 'pgtap-no-such-response', now(), now() + interval '30 days'
  ) into v_issued;

  return next is(v_issued, false, 'and neither can a response that does not exist');
end;
$fn$;


-- ── The column invariants ────────────────────────────────────────────────────

create function tap.test_the_token_columns_cannot_be_written_into_a_half_state()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_response uuid;
  v_hash_without_expiry boolean := false;
  v_bad_shape boolean := false;
begin
  select * into f from tap.tfixture();
  v_response := tap.pending_response(f, now());

  begin
    update questionnaire_responses
       set access_token_hash = repeat('a', 64)
     where id = v_response;
  exception when check_violation then
    v_hash_without_expiry := true;
  end;

  begin
    update questionnaire_responses
       set access_token_hash = 'not-a-digest',
           access_token_issued_at = now(),
           access_token_expires_at = now() + interval '1 day'
     where id = v_response;
  exception when check_violation then
    v_bad_shape := true;
  end;

  return next ok(v_hash_without_expiry, 'a token hash cannot be stored without an expiry');
  return next ok(v_bad_shape, 'and the column will not hold anything that is not a sha256 digest');
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
