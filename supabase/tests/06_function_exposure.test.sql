-- L4 — what the database exposes on the public API, and how safely.
--
-- Two classes of finding, both raised by the Supabase security advisor:
--
--   1. EXECUTE grants. PostgREST publishes every function in `public` that the
--      caller may execute at /rest/v1/rpc/<name>. `handle_new_user` is a trigger
--      function: calling it directly errors on NEW rather than doing damage, so
--      the severity is low — but a SECURITY DEFINER function on the anonymous
--      API surface is a standing invitation, and the grant buys nothing. Since
--      0049 neither public submit function is anon-callable either: the apply
--      form and the hosted questionnaire submit through the server, behind a
--      captcha and rate limits, so a direct call could go around both. These
--      tests state the list so a future migration cannot widen it by accident.
--
--   2. Mutable search_path. A function with no `set search_path` resolves
--      unqualified names against whatever the caller's search_path happens to
--      be. Combined with SECURITY DEFINER that is a privilege-escalation
--      primitive; even on a SECURITY INVOKER function it makes behaviour depend
--      on the caller, which for a trigger fired inside someone else's session is
--      not a property you want.
begin;

create schema if not exists tap;

create function tap.test_only_the_public_intake_is_anon_callable()
returns setof text
language plpgsql
as $fn$
begin
  return next function_privs_are(
    'public'::name, 'handle_new_user'::name, array[]::name[],
    'anon'::name, array[]::name[],
    'handle_new_user is not callable by anon — a trigger function has no business on the public API'
  );

  return next function_privs_are(
    'public'::name, 'handle_new_user'::name, array[]::name[],
    'authenticated'::name, array[]::name[],
    'handle_new_user is not callable by an authenticated user either'
  );

  return next function_privs_are(
    'public'::name, 'handle_new_user'::name, array[]::name[],
    'public'::name, array[]::name[],
    'handle_new_user carries no PUBLIC execute grant, which is where the anon grant came from'
  );

  -- The public intake is server-only since 0049. /api/apply checks the captcha
  -- and the rate limits, then calls this with the service role; a grant to
  -- anon (or authenticated, or PUBLIC) would let anyone holding the public key
  -- call it directly and skip both.
  return next function_privs_are(
    'public'::name, 'submit_application'::name, array['jsonb']::name[],
    'anon'::name, array[]::name[],
    'submit_application is not anon-callable — applications go through /api/apply (0049)'
  );

  return next function_privs_are(
    'public'::name, 'submit_application'::name, array['jsonb']::name[],
    'public'::name, array[]::name[],
    'submit_application carries no PUBLIC execute grant, which anon would inherit'
  );

  return next function_privs_are(
    'public'::name, 'submit_application'::name, array['jsonb']::name[],
    'authenticated'::name, array[]::name[],
    'submit_application is not callable by a signed-in user directly either'
  );

  -- The counterweight: the route needs it. Revoke this and the careers site
  -- stops accepting applications.
  return next function_privs_are(
    'public'::name, 'submit_application'::name, array['jsonb']::name[],
    'service_role'::name, array['EXECUTE']::name[],
    'submit_application stays callable by the service role — /api/apply uses it'
  );

  -- The rate-limit ledger behind those routes (0048) is server-only too: an
  -- anonymous caller who could write to it could clear their own history.
  return next function_privs_are(
    'public'::name, 'register_public_submission'::name,
    array['text', 'text', 'text', 'timestamptz']::name[],
    'anon'::name, array[]::name[],
    'register_public_submission is not anon-callable'
  );

  return next function_privs_are(
    'public'::name, 'register_public_submission'::name,
    array['text', 'text', 'text', 'timestamptz']::name[],
    'authenticated'::name, array[]::name[],
    'register_public_submission is not callable by a signed-in user'
  );

  return next function_privs_are(
    'public'::name, 'register_public_submission'::name,
    array['text', 'text', 'text', 'timestamptz']::name[],
    'service_role'::name, array['EXECUTE']::name[],
    'register_public_submission is callable by the service role, which the routes use'
  );
end;
$fn$;

-- The four functions written before 0021's rule existed, closed in 0037.
--
-- 0001, 0002 and 0005 predate the discovery that a function in `public` carries
-- Postgres's implicit EXECUTE grant to PUBLIC on top of the named grants
-- Supabase's default privileges hand out. Every function from 0019 onwards was
-- revoked from both; these four never were, and nothing in this suite looked at
-- them, which is why it went unnoticed rather than being decided.
--
-- None of them was exploitable — `set_updated_at` errors on NEW when called
-- directly and the other two are SECURITY INVOKER, so anon's RLS view applies —
-- and that is the point. The boundary is asserted where it is cheap, not only
-- where a breach would be expensive.
create function tap.test_the_functions_written_before_the_rule_are_also_shut()
returns setof text
language plpgsql
as $fn$
declare
  v_name name;
  v_args name[];
  v_legacy constant text[][] := array[
    array['set_updated_at', ''],
    array['snapshot_pipeline_to_position', 'uuid,uuid'],
    array['first_stage_for_position', 'uuid']
  ];
  v_internal constant text[][] := array[
    array['snapshot_pipeline_to_position', 'uuid,uuid'],
    array['first_stage_for_position', 'uuid']
  ];
  v_row text[];
begin
  foreach v_row slice 1 in array v_legacy loop
    v_name := v_row[1]::name;
    v_args := case
                when v_row[2] = '' then array[]::name[]
                else string_to_array(v_row[2], ',')::name[]
              end;

    return next function_privs_are(
      'public'::name, v_name, v_args, 'anon'::name, array[]::name[],
      format('%s is not callable by anon', v_name)
    );

    return next function_privs_are(
      'public'::name, v_name, v_args, 'public'::name, array[]::name[],
      format('%s carries no PUBLIC execute grant either, which is where anon would inherit one', v_name)
    );
  end loop;

  -- A trigger function is off the surface in every direction: nothing calls it
  -- by name, and the triggers that use it do not need the grant (asserted as
  -- behaviour below).
  return next function_privs_are(
    'public'::name, 'set_updated_at'::name, array[]::name[],
    'authenticated'::name, array[]::name[],
    'set_updated_at is not callable by a signed-in user either — it is a trigger function'
  );

  -- The counterweight. `snapshot_pipeline_to_position` is the stage freeze
  -- and is called by POST /api/positions and PATCH /api/positions/[id] with a
  -- signed-in session; revoking it would break creating a position.
  foreach v_row slice 1 in array v_internal loop
    v_name := v_row[1]::name;
    v_args := string_to_array(v_row[2], ',')::name[];

    return next function_privs_are(
      'public'::name, v_name, v_args, 'authenticated'::name, array['EXECUTE']::name[],
      format('%s stays callable by a signed-in user — the internal app calls it', v_name)
    );

    return next function_privs_are(
      'public'::name, v_name, v_args, 'service_role'::name, array['EXECUTE']::name[],
      format('%s stays callable by the service role', v_name)
    );
  end loop;
end;
$fn$;

-- Same shape as the `handle_new_user` case below: EXECUTE is checked when a
-- trigger is created, not each time it fires, so revoking the grant must not
-- stop six tables maintaining their `updated_at`. Asserted rather than assumed,
-- because getting it wrong would be silent — a stale timestamp is not an error.
create function tap.test_updated_at_still_fires_without_the_grant()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_pipeline uuid;
  v_before timestamptz;
  v_after timestamptz;
begin
  -- Seeded a day stale, because `now()` is fixed for the whole transaction: a
  -- row inserted and updated in one test would carry the same timestamp either
  -- way and the assertion would prove nothing.
  insert into pipelines (name, updated_at)
  values ('pgTAP updated_at ' || v_seed, now() - interval '1 day')
  returning id, updated_at into v_pipeline, v_before;

  update pipelines set name = 'pgTAP updated_at renamed ' || v_seed where id = v_pipeline;
  select updated_at into v_after from pipelines where id = v_pipeline;

  return next ok(
    v_after > v_before,
    'set_updated_at still stamps a row on update after its EXECUTE grant was revoked'
  );
end;
$fn$;

-- The automation engine added eleven functions to `public` and the reminder
-- engine seven more, and the
-- automation engine is the one
-- subsystem where an anonymous caller reaching a function is not theoretical:
-- these decide which candidates get emailed and when.
--
-- The trap this suite exists to hold shut is the one 0021 had to clean up.
-- A function carries TWO default EXECUTE grants — the named ones Supabase's
-- default privileges hand to anon and authenticated (0014), and Postgres's own
-- implicit grant to PUBLIC. Revoking only the first leaves the function on the
-- anonymous API anyway, which is why every case below checks `public` as well
-- as `anon`.
create function tap.test_the_automation_engine_is_off_the_anonymous_surface()
returns setof text
language plpgsql
as $fn$
declare
  v_name name;
  v_args name[];
  v_engine constant text[][] := array[
    array['dispatch_due_scheduled_actions', 'timestamptz'],
    array['claim_due_scheduled_actions', 'timestamptz,integer'],
    array['complete_scheduled_action', 'uuid,scheduled_action_status,timestamptz,text,uuid'],
    array['schedule_stage_actions', 'uuid,uuid,timestamptz'],
    array['cancel_pending_stage_actions', 'uuid,uuid,timestamptz'],
    array['record_first_stage_entry', 'uuid,uuid,timestamptz'],
    array['position_stage_for_template_stage', 'uuid,uuid'],
    array['apply_stage_automation', ''],
    array['guard_scheduled_action_status', ''],
    array['guard_stage_action_target', ''],
    array['cancel_pending_actions_for_deleted_stage_action', ''],
    array['is_valid_reminder_config', 'jsonb'],
    array['schedule_questionnaire_reminders', 'uuid,jsonb,timestamptz'],
    array['cancel_pending_questionnaire_reminders', 'uuid,timestamptz'],
    array['enqueue_answer_routing', 'uuid,timestamptz'],
    array['resolve_response_on_completion_stage', ''],
    array['stop_reminders_on_response_change', ''],
    array['enqueue_answer_routing_on_completion', '']
  ];
  v_row text[];
begin
  foreach v_row slice 1 in array v_engine loop
    v_name := v_row[1]::name;
    v_args := case
                when v_row[2] = '' then array[]::name[]
                else string_to_array(v_row[2], ',')::name[]
              end;

    return next function_privs_are(
      'public'::name, v_name, v_args, 'anon'::name, array[]::name[],
      format('%s is not callable by anon', v_name)
    );

    return next function_privs_are(
      'public'::name, v_name, v_args, 'public'::name, array[]::name[],
      format('%s carries no PUBLIC execute grant either, which is where anon would inherit one', v_name)
    );
  end loop;

  -- The doorbell is the one that genuinely matters: SECURITY DEFINER, and it
  -- makes the database open an outbound HTTP connection. Only the cron job's
  -- role and the service role may ring it.
  return next function_privs_are(
    'public'::name, 'dispatch_due_scheduled_actions'::name, array['timestamptz']::name[],
    'authenticated'::name, array[]::name[],
    'dispatch_due_scheduled_actions is not callable by a signed-in user either'
  );

  -- The counterweight, so a future hardening pass cannot silently break the
  -- worker: the queue RPCs stay callable by the roles that run it.
  return next function_privs_are(
    'public'::name, 'claim_due_scheduled_actions'::name,
    array['timestamptz', 'integer']::name[],
    'service_role'::name, array['EXECUTE']::name[],
    'claim_due_scheduled_actions stays callable by the service role — the worker runs as it'
  );

  return next function_privs_are(
    'public'::name, 'complete_scheduled_action'::name,
    array['uuid', 'scheduled_action_status', 'timestamptz', 'text', 'uuid']::name[],
    'service_role'::name, array['EXECUTE']::name[],
    'complete_scheduled_action stays callable by the service role'
  );
end;
$fn$;

-- Hosted questionnaires added six functions. Three of them are deliberately on the anonymous API —
-- they read the hosted questionnaire for its page — and two must never be,
-- because between them they are the hashing oracle and the thing that mints a
-- credential. The sixth, `submit_questionnaire_response`, was anonymous until
-- 0049 and is now server-only: /api/questionnaire-submissions checks the
-- captcha and rate limit, then calls it with the service role.
--
-- Getting this wrong in either direction is a real failure: revoke the reads
-- and no candidate can open a questionnaire; grant the last two and anyone on
-- the internet can issue themselves a link to any questionnaire.
create function tap.test_the_questionnaire_token_surface_is_exactly_as_intended()
returns setof text
language plpgsql
as $fn$
declare
  v_name name;
  v_args name[];
  v_private constant text[][] := array[
    array['questionnaire_token_hash', 'text'],
    array['issue_questionnaire_access_token', 'uuid,text,timestamptz,timestamptz']
  ];
  v_public constant text[][] := array[
    array['public_questionnaire_token_state', 'text'],
    array['public_questionnaire_by_token', 'text'],
    array['public_questionnaire_questions_by_token', 'text']
  ];
  v_row text[];
begin
  foreach v_row slice 1 in array v_private loop
    v_name := v_row[1]::name;
    v_args := string_to_array(v_row[2], ',')::name[];

    return next function_privs_are(
      'public'::name, v_name, v_args, 'anon'::name, array[]::name[],
      format('%s is not callable by anon — issuing a link is never anonymous', v_name)
    );

    return next function_privs_are(
      'public'::name, v_name, v_args, 'public'::name, array[]::name[],
      format('%s carries no PUBLIC execute grant either, which is where anon would inherit one', v_name)
    );
  end loop;

  foreach v_row slice 1 in array v_public loop
    v_name := v_row[1]::name;
    v_args := string_to_array(v_row[2], ',')::name[];

    return next function_privs_are(
      'public'::name, v_name, v_args, 'anon'::name, array['EXECUTE']::name[],
      format('%s stays anon-callable — it is the hosted questionnaire', v_name)
    );
  end loop;

  return next function_privs_are(
    'public'::name, 'submit_questionnaire_response'::name, array['text', 'jsonb']::name[],
    'anon'::name, array[]::name[],
    'submit_questionnaire_response is not anon-callable — answers go through the server route (0049)'
  );

  return next function_privs_are(
    'public'::name, 'submit_questionnaire_response'::name, array['text', 'jsonb']::name[],
    'service_role'::name, array['EXECUTE']::name[],
    'submit_questionnaire_response stays callable by the service role, which the route uses'
  );

  -- Same search_path rule as the automation engine, and it matters more here:
  -- four of these are SECURITY DEFINER functions an anonymous caller invokes.
  return next is(
    (select count(*)::int
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'questionnaire_token_hash', 'issue_questionnaire_access_token',
          'public_questionnaire_token_state', 'public_questionnaire_by_token',
          'public_questionnaire_questions_by_token', 'submit_questionnaire_response'
        )
        and coalesce(p.proconfig, array[]::text[]) @> array['search_path=public']),
    6,
    'all six questionnaire token functions pin their search_path'
  );
end;
$fn$;

-- Slack notifications added three functions, and they divide the Slack bot token from everyone
-- who must not see it.
--
-- The one that matters is `slack_delivery_config`, which returns the token in
-- clear. It is granted to `service_role` and nothing else, because the only
-- caller is the inbound-email webhook. If a future migration hands it to
-- `authenticated`, the token becomes one /rest/v1/rpc/slack_delivery_config away
-- from any signed-in browser session — so that grant is asserted in both
-- directions here.
--
-- The other two are the settings screen's whole interface to the credential:
-- `set_slack_bot_token` writes it and `slack_bot_token_state` reports only
-- whether one exists. Neither returns the token, and both are meant to stay
-- callable by `authenticated` under the shared access level (USR-2).
create function tap.test_the_slack_credential_surface_is_exactly_as_intended()
returns setof text
language plpgsql
as $fn$
declare
  v_name name;
  v_args name[];
  v_settings constant text[][] := array[
    array['set_slack_bot_token', 'text'],
    array['slack_bot_token_state', '']
  ];
  v_row text[];
begin
  -- Nothing Slack-related is on the anonymous surface, ever.
  foreach v_row slice 1 in array (v_settings || array[array['slack_delivery_config', '']]) loop
    v_name := v_row[1]::name;
    v_args := case
                when v_row[2] = '' then array[]::name[]
                else string_to_array(v_row[2], ',')::name[]
              end;

    return next function_privs_are(
      'public'::name, v_name, v_args, 'anon'::name, array[]::name[],
      format('%s is not callable by anon', v_name)
    );

    return next function_privs_are(
      'public'::name, v_name, v_args, 'public'::name, array[]::name[],
      format('%s carries no PUBLIC execute grant either, which is where anon would inherit one', v_name)
    );
  end loop;

  -- The token's one exit from the database. Service role only.
  return next function_privs_are(
    'public'::name, 'slack_delivery_config'::name, array[]::name[],
    'authenticated'::name, array[]::name[],
    'slack_delivery_config is NOT callable by a signed-in user — it returns the bot token in clear'
  );

  return next function_privs_are(
    'public'::name, 'slack_delivery_config'::name, array[]::name[],
    'service_role'::name, array['EXECUTE']::name[],
    'slack_delivery_config stays callable by the service role — the inbound webhook runs as it'
  );

  -- The counterweight: revoke these two and the settings screen cannot configure
  -- Slack at all.
  foreach v_row slice 1 in array v_settings loop
    v_name := v_row[1]::name;
    v_args := case
                when v_row[2] = '' then array[]::name[]
                else string_to_array(v_row[2], ',')::name[]
              end;

    return next function_privs_are(
      'public'::name, v_name, v_args, 'authenticated'::name, array['EXECUTE']::name[],
      format('%s stays callable by a signed-in user — it is the settings screen (USR-2)', v_name)
    );
  end loop;

  return next is(
    (select count(*)::int
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'set_slack_bot_token', 'slack_bot_token_state', 'slack_delivery_config'
        )
        and coalesce(p.proconfig, array[]::text[]) @> array['search_path=public']),
    3,
    'all three Slack functions pin their search_path'
  );
end;
$fn$;

-- The credential table itself, not just the functions over it. `slack_config` is
-- ordinary configuration and every internal user may read it; `slack_credentials`
-- holds the bearer token and gets the `automation_worker_config` treatment from
-- 0020 — RLS on with no policy, and the table grants revoked so it is off the
-- PostgREST surface entirely rather than merely returning zero rows.
create function tap.test_the_bot_token_table_is_off_the_api_entirely()
returns setof text
language plpgsql
as $fn$
begin
  return next is(
    (select relrowsecurity from pg_class where oid = 'public.slack_credentials'::regclass),
    true,
    'slack_credentials has row level security enabled'
  );

  return next is(
    (select count(*)::int from pg_policies
      where schemaname = 'public' and tablename = 'slack_credentials'),
    0,
    'slack_credentials has no policy at all, which denies every role that does not bypass RLS'
  );

  return next table_privs_are(
    'public'::name, 'slack_credentials'::name, 'anon'::name, array[]::name[],
    'anon holds no grant on slack_credentials'
  );

  return next table_privs_are(
    'public'::name, 'slack_credentials'::name, 'authenticated'::name, array[]::name[],
    'authenticated holds no grant on slack_credentials either — the token never reaches a browser'
  );

  -- The counterweight. The settings screen reads the channel through the ordinary
  -- table, so this grant must survive.
  return next ok(
    has_table_privilege('authenticated', 'public.slack_config', 'SELECT'),
    'authenticated can still read slack_config — the channel is not a secret'
  );

  return next ok(
    has_table_privilege('authenticated', 'public.slack_config', 'UPDATE'),
    'authenticated can still update slack_config — that IS the settings screen'
  );

  -- The ledger is an audit trail, so signed-in users read it and only the webhook
  -- writes it.
  return next ok(
    has_table_privilege('authenticated', 'public.slack_notifications', 'SELECT'),
    'authenticated can read the Slack notification ledger'
  );

  return next is(
    (select count(*)::int from pg_policies
      where schemaname = 'public' and tablename = 'slack_notifications'
        and cmd <> 'SELECT'),
    0,
    'no policy lets a signed-in user write the Slack notification ledger'
  );

  return next table_privs_are(
    'public'::name, 'slack_notifications'::name, 'anon'::name, array[]::name[],
    'anon holds no grant on slack_notifications'
  );
end;
$fn$;

-- The write-only contract, exercised rather than asserted from the grants alone.
--
-- `set_slack_bot_token` returns a boolean and `slack_bot_token_state` returns a
-- flag and a timestamp. Between them there is no path that returns the token to
-- a caller, and this test states that as behaviour: store a known token, then
-- check that nothing the settings screen can call gives it back.
create function tap.test_the_bot_token_is_write_only()
returns setof text
language plpgsql
as $fn$
declare
  v_token constant text := 'xoxb-pgtap-0000000000-1111111111-doesnotexist';
  v_state record;
begin
  return next ok(
    not set_slack_bot_token('xoxp-pgtap-a-user-token-not-a-bot-token'),
    'a user token (xoxp-) is refused — it cannot post as the app'
  );

  return next ok(
    not set_slack_bot_token('xapp-1-A0000-0000-deadbeef'),
    'an app-level token (xapp-) is refused too'
  );

  return next ok(set_slack_bot_token(v_token), 'a bot token (xoxb-) is stored');

  select * into v_state from slack_bot_token_state();

  return next ok(v_state.configured, 'slack_bot_token_state reports that a token exists');
  return next ok(
    v_state.token_set_at is not null,
    'slack_bot_token_state reports when it was set, so the screen can show a rotation date'
  );

  -- The whole point: the state function's result carries no column that could
  -- hold the token, masked or otherwise.
  return next is(
    (select count(*)::int
       from information_schema.routines r
       join information_schema.parameters p
         on p.specific_name = r.specific_name
      where r.routine_schema = 'public'
        and r.routine_name = 'slack_bot_token_state'
        and p.parameter_mode = 'OUT'
        and p.parameter_name in ('bot_token', 'token', 'secret')),
    0,
    'slack_bot_token_state returns no column that could carry the token'
  );

  return next ok(set_slack_bot_token(null), 'passing null clears the token');

  select * into v_state from slack_bot_token_state();
  return next ok(not v_state.configured, 'clearing really removes it');
  return next ok(
    v_state.token_set_at is null,
    'clearing removes the timestamp too, so the screen cannot report a stale rotation date'
  );
end;
$fn$;

-- The two invariants 0026 added to `slack_config`, asserted because both exist to
-- stop the notifier ever seeing a half-configured row.
create function tap.test_slack_config_cannot_be_enabled_with_nowhere_to_post()
returns setof text
language plpgsql
as $fn$
begin
  return next throws_ok(
    $$update slack_config set channel_id = null, enabled = true where id$$,
    '23514',
    null,
    'enabling notifications with no channel is refused by the database'
  );

  return next throws_ok(
    $$update slack_config set channel_id = '#candidate-inbox' where id$$,
    '23514',
    null,
    'a channel NAME pasted into the channel ID column is refused — Slack addresses channels by id'
  );

  return next lives_ok(
    $$update slack_config set channel_id = 'C0123ABCD' where id$$,
    'a real-looking channel id is accepted'
  );

  return next is(
    (select count(*)::int from slack_config),
    1,
    'slack_config is a singleton, so there is exactly one row to configure'
  );

  return next is(
    (select count(*)::int from slack_credentials),
    1,
    'slack_credentials is a singleton too'
  );
end;
$fn$;

create function tap.test_profile_provisioning_still_fires_without_the_grant()
returns setof text
language plpgsql
as $fn$
declare
  v_id uuid := gen_random_uuid();
  v_profiles int;
  v_full_name text;
begin
  return next has_trigger(
    'auth'::name, 'users'::name, 'on_auth_user_created'::name,
    'on_auth_user_created is still attached to auth.users'
  );

  -- EXECUTE is checked when a trigger is created, not each time it fires, so
  -- revoking the grant must not stop provisioning. This asserts that rather
  -- than assuming it.
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    created_at, updated_at, raw_user_meta_data
  )
  values (
    v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'pgtap-' || replace(v_id::text, '-', '') || '@example.test', 'not-a-real-password',
    now(), now(), jsonb_build_object('full_name', 'pgTAP User')
  );

  select count(*)::int into v_profiles from profiles where id = v_id;
  select full_name into v_full_name from profiles where id = v_id;

  return next is(v_profiles, 1, 'a new auth user is still auto-provisioned a profile row');
  return next is(v_full_name, 'pgTAP User', 'the trigger still reads full_name out of the auth metadata');
end;
$fn$;

create function tap.test_every_public_function_pins_its_search_path()
returns setof text
language plpgsql
as $fn$
begin
  return next is(
    (select proconfig from pg_proc where oid = 'public.set_updated_at()'::regprocedure),
    array['search_path=public']::text[],
    'set_updated_at pins its search_path'
  );

  return next is(
    (select proconfig from pg_proc where oid = 'public.first_stage_for_position(uuid)'::regprocedure),
    array['search_path=public']::text[],
    'first_stage_for_position pins its search_path'
  );

  -- The three that were already correct, asserted so the property is stated for
  -- the whole set rather than only for the two that were fixed.
  return next is(
    (select proconfig from pg_proc where oid = 'public.handle_new_user()'::regprocedure),
    array['search_path=public']::text[],
    'handle_new_user pins its search_path'
  );

  return next is(
    (select proconfig from pg_proc where oid = 'public.submit_application(jsonb)'::regprocedure),
    array['search_path=public']::text[],
    'submit_application pins its search_path'
  );

  return next is(
    (select proconfig
       from pg_proc
      where oid = 'public.snapshot_pipeline_to_position(uuid, uuid)'::regprocedure),
    array['search_path=public']::text[],
    'snapshot_pipeline_to_position pins its search_path'
  );

  -- The functions added for the public careers surface are SECURITY DEFINER and
  -- read tables anon cannot see, so an unpinned search_path on one of these is
  -- the dangerous case, not a cosmetic advisor warning.
  return next is(
    (select proconfig from pg_proc where oid = 'public.public_position_by_slug(text)'::regprocedure),
    array['search_path=public']::text[],
    'public_position_by_slug pins its search_path'
  );

  return next is(
    (select proconfig from pg_proc where oid = 'public.public_position_questions(uuid)'::regprocedure),
    array['search_path=public']::text[],
    'public_position_questions pins its search_path'
  );

  return next is(
    (select proconfig from pg_proc where oid = 'public.public_position_is_open(uuid)'::regprocedure),
    array['search_path=public']::text[],
    'public_position_is_open pins its search_path'
  );

  return next is(
    (select proconfig
       from pg_proc
      where oid = 'public.anon_may_upload_application_object(text)'::regprocedure),
    array['search_path=public']::text[],
    'anon_may_upload_application_object pins its search_path'
  );

  return next is(
    (select proconfig
       from pg_proc
      where oid = 'public.orphaned_application_uploads(interval)'::regprocedure),
    array['search_path=public']::text[],
    'orphaned_application_uploads pins its search_path'
  );

  -- Every automation engine function, asserted as a set rather than one by one, so a new one
  -- added without `set search_path` fails here rather than in an advisor report
  -- somebody reads a month later.
  return next is(
    (select count(*)::int
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'dispatch_due_scheduled_actions', 'claim_due_scheduled_actions',
          'complete_scheduled_action', 'schedule_stage_actions',
          'cancel_pending_stage_actions', 'record_first_stage_entry',
          'position_stage_for_template_stage', 'apply_stage_automation',
          'guard_scheduled_action_status', 'guard_stage_action_target',
          'cancel_pending_actions_for_deleted_stage_action',
          'is_valid_reminder_config', 'schedule_questionnaire_reminders',
          'cancel_pending_questionnaire_reminders', 'enqueue_answer_routing',
          'resolve_response_on_completion_stage', 'stop_reminders_on_response_change',
          'enqueue_answer_routing_on_completion'
        )
        and coalesce(p.proconfig, array[]::text[]) @> array['search_path=public']),
    18,
    'all eighteen automation engine functions pin their search_path'
  );
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
