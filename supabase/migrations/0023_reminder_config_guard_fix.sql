-- M6b follow-up: two holes in 0022, both found by the pgTAP suite.
--
-- 1. `is_valid_reminder_config` returned NULL rather than false for a
--    configuration that was missing a key entirely — `jsonb_typeof(NULL)` is
--    NULL, NULL propagates through AND, and a CHECK constraint *passes* on NULL.
--    So `{"interval_minutes":[60],"max_count":3}`, with no `enabled` key at all,
--    was accepted and would have been read as disabled by the mapper. Anything
--    unparseable has to be rejected at the door, not silently reinterpreted.
--
--    `coalesce(..., false)` is the whole fix: a config the function cannot make
--    sense of is invalid, full stop.
--
-- 2. The worker creates one `questionnaire_responses` row per Send Questionnaire
--    action, and re-uses it if it is already there. A select-then-insert is a
--    race, and this engine's whole idempotency story is "the database decides,
--    not the worker's care" (0019's ledger, 0022's reminder slot index). So the
--    pair gets a unique index too. Partial, because the embedded
--    application-form context has no stage action and there may be many of those
--    per candidacy.

create or replace function is_valid_reminder_config(p_config jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(
    p_config is null
    or (
      jsonb_typeof(p_config) = 'object'
      and jsonb_typeof(p_config->'enabled') = 'boolean'
      and jsonb_typeof(p_config->'max_count') = 'number'
      and (p_config->>'max_count')::numeric = floor((p_config->>'max_count')::numeric)
      and (p_config->>'max_count')::numeric between 1 and 10
      and jsonb_typeof(p_config->'interval_minutes') = 'array'
      and jsonb_array_length(p_config->'interval_minutes') between 1 and 10
      and not exists (
        select 1
          from jsonb_array_elements(p_config->'interval_minutes') as gap
         where jsonb_typeof(gap) <> 'number'
            or gap::text::numeric <> floor(gap::text::numeric)
            or gap::text::numeric < 1
            or gap::text::numeric > 129600
      )
      and (
        p_config->'message_template_id' is null
        or jsonb_typeof(p_config->'message_template_id') = 'null'
        or jsonb_typeof(p_config->'message_template_id') = 'string'
      )
    ),
    false
  );
$$;

create unique index questionnaire_responses_stage_action_idx
  on questionnaire_responses (application_id, stage_action_id)
  where stage_action_id is not null;

revoke execute on function public.is_valid_reminder_config(jsonb) from public, anon;
grant execute on function public.is_valid_reminder_config(jsonb) to authenticated, service_role;
