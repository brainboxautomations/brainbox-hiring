-- M6b — the second half of the automation engine: reminders (REM-1 … REM-5) and
-- answer-based routing (AUT-8 … AUT-10).
--
-- M6a built a queue, a producer trigger, a claim/settle pair and a cron
-- doorbell. Nothing here replaces any of that. A reminder and a routing
-- evaluation are both "a thing that must happen to one candidacy at one instant,
-- exactly once, and must leave a record when it does not happen" — which is the
-- exact shape of a `scheduled_actions` row. So both become rows in that queue and
-- inherit, unchanged:
--
--   * claiming (`for update skip locked`), so overlapping workers cannot double-send
--   * the status machine, so nothing settles without a terminal state
--   * the `failed`/`skipped` reason columns, so nothing disappears quietly
--   * cancel-on-move (AUT-6), because a cancelled row is any pending row whose
--     `origin_stage_id` the candidate has left — which is exactly stop condition
--     two of REM-3, for free
--
-- What this migration adds is: a discriminator on the queue row, the two new
-- payload columns those kinds need, the producers that write them, the cancellers
-- that enforce the remaining stop conditions, and the two columns the
-- questionnaire builder has been silently discarding since M5.
--
-- As in 0019, every function takes the instant it should reason about. Only the
-- triggers read `now()`.


-- ── The queue row learns what kind of work it is ─────────────────────────────
--
-- Until now every row meant "run this stage action", and its meaning was read
-- through `stage_actions.type`. Reminders and routing evaluations have no stage
-- action of their own (a reminder borrows the send_questionnaire action's
-- configuration; a routing evaluation has none at all), so the discriminator has
-- to live on the queue row.
create type scheduled_action_kind as enum ('stage_action', 'reminder', 'answer_routing');

alter table scheduled_actions
  -- Every row that already exists is a stage action, and the default keeps every
  -- existing producer — `schedule_stage_actions` from 0019 — correct untouched.
  add column kind scheduled_action_kind not null default 'stage_action',
  -- Which questionnaire this row is about. Reminders chase it; routing rows read
  -- its answers. `on delete cascade`: a reminder for a response that no longer
  -- exists is not history worth keeping, it is a row that can never be evaluated.
  add column questionnaire_response_id uuid references questionnaire_responses (id) on delete cascade,
  -- 1-based position in the reminder schedule. Null for everything else.
  add column reminder_number integer;

-- Columns follow the kind, so a nonsensical row cannot be written by any path.
-- Note what is NOT required: `stage_action_id` may be null on a reminder, because
-- it is `on delete set null` and deleting the questionnaire action severs it (the
-- 0019 delete trigger cancels those rows first, but a row that already fired
-- keeps its history).
alter table scheduled_actions
  add constraint scheduled_actions_kind_columns_check
  check (
    case kind
      when 'stage_action' then
        questionnaire_response_id is null and reminder_number is null
      when 'reminder' then
        questionnaire_response_id is not null
        and reminder_number is not null
        and reminder_number between 1 and 10
      when 'answer_routing' then
        questionnaire_response_id is not null and reminder_number is null
    end
  );

-- REM-3's third stop condition — "the maximum count is reached" — is not a
-- runtime check anywhere in this engine. It is this index plus the bound in the
-- constraint above.
--
-- A reminder schedule is written once, as one INSERT of a finite list. Nothing
-- in the system schedules a reminder from a reminder: there is no chain to run
-- away, only a fixed set of rows. This index makes that true under retry and
-- concurrency as well — a second scheduling pass for the same response cannot
-- add a duplicate, and cannot add an eleventh.
create unique index scheduled_actions_reminder_slot_idx
  on scheduled_actions (questionnaire_response_id, reminder_number)
  where kind = 'reminder';

-- One routing evaluation per completed response, ever. A worker retry, a
-- duplicate trigger fire, or two completions racing cannot move the candidate
-- twice off the back of one questionnaire.
create unique index scheduled_actions_routing_response_idx
  on scheduled_actions (questionnaire_response_id)
  where kind = 'answer_routing';

-- The worker reads reminders and routing rows through the same claim function as
-- everything else, so no new index is needed for pickup: 0019's partial index on
-- (scheduled_for) where status = 'pending' already covers them.


-- ── Reminder configuration (REM-1, REM-2) ────────────────────────────────────
--
-- `stage_actions.reminder_config` has existed since 0001 as an unconstrained
-- jsonb column that nothing wrote. It is a configuration block on a Send
-- Questionnaire action and on nothing else (REM-1).
--
-- Shape:
--   {
--     "enabled": true,
--     "interval_minutes": [2880, 5760],   -- gaps: first from the send, then from
--                                         -- the previous reminder
--     "max_count": 3,                     -- hard stop
--     "message_template_id": null         -- null = the built-in reminder message
--   }
--
-- Keys are snake_case because the database itself reads them (below, and in the
-- reminder producer). Everything crossing into the app is camelCase, converted in
-- the mappers as usual.
create or replace function is_valid_reminder_config(p_config jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
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
    );
$$;

alter table stage_actions
  add constraint stage_actions_reminder_config_check
  check (is_valid_reminder_config(reminder_config));

-- A reminder block belongs to a Send Questionnaire action and to nothing else
-- (REM-1). 0019's payload constraint already says which payload column each type
-- may carry; this is the same rule for the block M6b adds.
alter table stage_actions
  add constraint stage_actions_reminder_config_type_check
  check (reminder_config is null or type = 'send_questionnaire');


-- ── Answer routing configuration (AUT-8, D2) ─────────────────────────────────
--
-- `questions.answer_routing` has also existed since 0001 and has never been
-- written. Shape, per decision D2:
--
--   [{"option_value": "no", "pipeline_template_stage_id": "…"}]
--
-- The target is a *pipeline template* stage, not a position stage. Questionnaires
-- are global reusable templates (QST-1) and stages are per-position, so a
-- position stage id cannot be stored here at all. It is resolved through
-- `position_stages.source_template_stage_id` at fire time by
-- `position_stage_for_template_stage` (0019), which returns NULL when the link
-- has been severed — and a NULL target leaves the candidate exactly where they
-- are, with the reason recorded on the queue row. There is no fallback stage
-- anywhere in this engine.
--
-- Only the outer shape is constrained here. The entries are validated by Zod at
-- the Route Handler and normalized in `app/api/_mappers.ts`, which is where every
-- other jsonb column in this schema is made trustworthy.
alter table questions
  add constraint questions_answer_routing_is_array_check
  check (jsonb_typeof(answer_routing) = 'array');

-- AUT-10's "on completion, move to stage X", stored where the rule is authored:
-- on the reusable template, keyed on a template stage for the same reason as
-- above.
alter table questionnaire_templates
  add column on_completion_template_stage_id uuid
    references pipeline_template_stages (id) on delete set null;

-- `questionnaire_responses.on_completion_move_to_stage_id` (0001) is the
-- *resolved* target for one candidacy, and it is frozen when the response is
-- created. Editing the template afterwards must not silently change where a
-- questionnaire already in a candidate's inbox will send them.
--
-- A BEFORE INSERT trigger fills it, rather than the callers, because one of the
-- callers is `submit_application` — SECURITY DEFINER SQL that no Route Handler is
-- involved in. Same reasoning as the producer trigger in 0019.
create or replace function resolve_response_on_completion_stage()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_template_stage uuid;
  v_position_id uuid;
begin
  if new.on_completion_move_to_stage_id is not null then
    return new;
  end if;

  select qt.on_completion_template_stage_id into v_template_stage
    from questionnaire_templates qt
   where qt.id = new.questionnaire_template_id;

  if v_template_stage is null then
    return new;
  end if;

  select a.position_id into v_position_id
    from applications a
   where a.id = new.application_id;

  if v_position_id is null then
    return new;
  end if;

  new.on_completion_move_to_stage_id :=
    position_stage_for_template_stage(v_position_id, v_template_stage);

  return new;
end;
$$;

create trigger questionnaire_responses_resolve_on_completion_stage
  before insert on questionnaire_responses
  for each row execute function resolve_response_on_completion_stage();


-- ── REM-3's fourth stop condition: a human says stop ─────────────────────────
--
-- Nullable timestamp rather than a boolean, because "who stopped chasing this
-- candidate, and when" is the question anyone actually asks later.
alter table questionnaire_responses
  add column reminders_stopped_at timestamptz;

-- Which Send Questionnaire action produced this response. Null for the embedded
-- application-form context, which is never "sent" and so is never chased.
-- `on delete set null` matches every other pointer at `stage_actions`.
alter table questionnaire_responses
  add column stage_action_id uuid references stage_actions (id) on delete set null;


-- ── Scheduling a reminder run (REM-2, REM-4) ─────────────────────────────────
--
-- The interval arithmetic is deliberately NOT here. It lives in
-- `frontend/utilities/reminder-plan.ts` as a pure function that takes the send
-- instant as a parameter, next to `scheduled-action-plan.ts`, so every boundary
-- case is a unit test rather than something to be provoked through a live queue.
-- This function takes the computed schedule and writes it down.
--
-- p_schedule: [{"reminder_number": 1, "scheduled_for": "2026-08-08T09:00:00Z"}, …]
--
-- Three things make this safe to call twice:
--   * `on conflict do nothing` against the unique index above
--   * the hard cap of 10 rows, applied here regardless of what the caller sent
--   * `where reminder_number between 1 and 10`, so a malformed entry is dropped
--     rather than raising and losing the whole run
--
-- Returns the number of reminders actually queued.
create or replace function schedule_questionnaire_reminders(
  p_questionnaire_response_id uuid,
  p_schedule jsonb,
  p_now timestamptz
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_response questionnaire_responses%rowtype;
  v_origin_stage uuid;
  v_queued integer;
begin
  select * into v_response
    from questionnaire_responses
   where id = p_questionnaire_response_id;

  if not found then
    return 0;
  end if;

  -- Never chase a questionnaire that is already finished, or one a human has
  -- already called off. The producer must not be able to undo a stop condition.
  if v_response.status = 'completed' or v_response.reminders_stopped_at is not null then
    return 0;
  end if;

  if v_response.stage_action_id is null then
    return 0;
  end if;

  -- Reminders belong to the stage that sent the questionnaire, which is what
  -- makes cancel-on-move (AUT-6, and REM-3's second stop condition) apply to them
  -- without a line of new code.
  select sa.position_stage_id into v_origin_stage
    from stage_actions sa
   where sa.id = v_response.stage_action_id;

  if v_origin_stage is null then
    return 0;
  end if;

  insert into scheduled_actions (
    application_id, stage_action_id, origin_stage_id, scheduled_for,
    kind, questionnaire_response_id, reminder_number
  )
  select
    v_response.application_id,
    v_response.stage_action_id,
    v_origin_stage,
    (entry->>'scheduled_for')::timestamptz,
    'reminder',
    v_response.id,
    (entry->>'reminder_number')::integer
  from jsonb_array_elements(coalesce(p_schedule, '[]'::jsonb)) as entry
  where (entry->>'scheduled_for') is not null
    and (entry->>'reminder_number')::integer between 1 and 10
  order by (entry->>'reminder_number')::integer
  limit 10
  on conflict do nothing;

  get diagnostics v_queued = row_count;
  return v_queued;
end;
$$;


-- ── Stopping a reminder run (REM-3) ──────────────────────────────────────────
--
-- Cancels every reminder still pending for one questionnaire. Rows a worker has
-- already claimed are left alone, exactly as in `cancel_pending_stage_actions`:
-- once a worker owns a row it is about to call the mail relay, and an email that
-- has gone out cannot be recalled.
create or replace function cancel_pending_questionnaire_reminders(
  p_questionnaire_response_id uuid,
  p_now timestamptz
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_cancelled integer;
begin
  update scheduled_actions
     set status = 'cancelled',
         completed_at = p_now
   where questionnaire_response_id = p_questionnaire_response_id
     and kind = 'reminder'
     and status = 'pending';

  get diagnostics v_cancelled = row_count;
  return v_cancelled;
end;
$$;

-- Two of REM-3's four stop conditions are events on this row: the questionnaire
-- is completed, and a user manually stops reminders. Both cancel the remainder
-- here, in the database, so no writer can forget — the hosted questionnaire page
-- (M5) will complete responses without going anywhere near this code.
--
-- The other two are already covered: leaving the stage is AUT-6's existing
-- canceller, and the maximum count is the unique index above.
create or replace function stop_reminders_on_response_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform cancel_pending_questionnaire_reminders(new.id, now());
    return new;
  end if;

  if new.reminders_stopped_at is not null and old.reminders_stopped_at is null then
    perform cancel_pending_questionnaire_reminders(new.id, now());
  end if;

  return new;
end;
$$;

create trigger questionnaire_responses_stop_reminders
  after update on questionnaire_responses
  for each row execute function stop_reminders_on_response_change();


-- ── The answer-routing producer (AUT-8) ──────────────────────────────────────
--
-- Completing a questionnaire is the event; the routing decision is work.
--
-- The decision itself is NOT made here. Which option wins (AUT-9) and whether
-- answers beat the on-completion rule (AUT-10) are decided by
-- `frontend/utilities/answer-routing.ts`, a pure function, and the resulting move
-- is made by the worker. That split is deliberate:
--
--   * The producer must be in the database, because the only completion path
--     that exists today is `submit_application` — SECURITY DEFINER SQL called by
--     anon, which no Route Handler sees. A producer in the API layer would mean
--     the public application form silently never routes anybody.
--   * The decision must be in the queue-consuming worker, because an
--     unresolvable target has to be *recorded with a reason* (D2), and a queue
--     row settled `skipped` is the only durable, inspectable place this system
--     has to record it. A trigger that finds a severed template link can only do
--     nothing, silently.
--
-- The row is queued for `p_now`, so it comes due on the next doorbell.
create or replace function enqueue_answer_routing(
  p_questionnaire_response_id uuid,
  p_now timestamptz
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_response questionnaire_responses%rowtype;
  v_current_stage uuid;
  v_has_routing boolean;
  v_id uuid;
begin
  select * into v_response
    from questionnaire_responses
   where id = p_questionnaire_response_id;

  if not found or v_response.status <> 'completed' then
    return null;
  end if;

  select a.current_stage_id into v_current_stage
    from applications a
   where a.id = v_response.application_id;

  -- A candidate who is in no stage cannot be moved out of one, and cancel-on-move
  -- has nothing to key on. Nothing to do.
  if v_current_stage is null then
    return null;
  end if;

  -- Queue only when something was actually configured. The third arm matters:
  -- an on-completion rule whose template stage has been deleted resolves to NULL
  -- on the response, and we still want a queue row so the skip reason is written
  -- down rather than the rule vanishing.
  select
    exists (
      select 1 from questions q
       where q.questionnaire_template_id = v_response.questionnaire_template_id
         and jsonb_array_length(q.answer_routing) > 0
    )
    or v_response.on_completion_move_to_stage_id is not null
    or exists (
      select 1 from questionnaire_templates qt
       where qt.id = v_response.questionnaire_template_id
         and qt.on_completion_template_stage_id is not null
    )
  into v_has_routing;

  if not v_has_routing then
    return null;
  end if;

  insert into scheduled_actions (
    application_id, origin_stage_id, scheduled_for, kind, questionnaire_response_id
  )
  values (
    v_response.application_id, v_current_stage, p_now, 'answer_routing', v_response.id
  )
  on conflict do nothing
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function enqueue_answer_routing_on_completion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'completed' then
      perform enqueue_answer_routing(new.id, now());
    end if;
    return null;
  end if;

  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform enqueue_answer_routing(new.id, now());
  end if;

  return null;
end;
$$;

create trigger questionnaire_responses_answer_routing
  after insert or update of status on questionnaire_responses
  for each row execute function enqueue_answer_routing_on_completion();


-- ── Access ───────────────────────────────────────────────────────────────────
--
-- The complete rule, learned the hard way in 0021: a new function in `public`
-- carries Supabase's default-privileges grant to anon and authenticated *and*
-- Postgres's own implicit grant to PUBLIC. Revoke from PUBLIC as well as by name,
-- or the function is on the anonymous API.
revoke execute on function public.resolve_response_on_completion_stage()
  from public, anon, authenticated;
revoke execute on function public.stop_reminders_on_response_change()
  from public, anon, authenticated;
revoke execute on function public.enqueue_answer_routing_on_completion()
  from public, anon, authenticated;

revoke execute on function public.is_valid_reminder_config(jsonb) from public, anon;
revoke execute on function public.schedule_questionnaire_reminders(uuid, jsonb, timestamptz)
  from public, anon;
revoke execute on function public.cancel_pending_questionnaire_reminders(uuid, timestamptz)
  from public, anon;
revoke execute on function public.enqueue_answer_routing(uuid, timestamptz)
  from public, anon;

grant execute on function public.is_valid_reminder_config(jsonb) to authenticated, service_role;
grant execute on function public.schedule_questionnaire_reminders(uuid, jsonb, timestamptz)
  to authenticated, service_role;
grant execute on function public.cancel_pending_questionnaire_reminders(uuid, timestamptz)
  to authenticated, service_role;
grant execute on function public.enqueue_answer_routing(uuid, timestamptz)
  to authenticated, service_role;
