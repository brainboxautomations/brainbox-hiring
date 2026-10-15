-- M7c, part 2 of 2: a questionnaire sent by hand to a board selection (BLK-2,
-- BLK-4), and the reminder run that must follow it.
--
-- The send itself needs no new machinery: the worker already knows how to mint a
-- token, email the link and queue a reminder run, and M7c extracts that routine
-- so a Route Handler can call the same one. What the *database* is missing is
-- two facts that a stage-sent questionnaire gets for free from its stage action:
--
--   1. Which stage the candidate was in when the questionnaire went out. This is
--      what makes cancel-on-move (AUT-6, and REM-3's second stop condition)
--      apply. A stage-sent response reads it from
--      `stage_actions.position_stage_id`; a manual send has no stage action.
--   2. How often to chase, and how many times. A stage-sent response reads it
--      from `stage_actions.reminder_config`; a manual send has no stage action.
--
-- Both become columns on the response. Note what is NOT duplicated: there is no
-- second scheduler, no second queue and no second reminder table. The rows are
-- still `scheduled_actions (kind = 'reminder')`, still written by
-- `schedule_questionnaire_reminders`, still capped by
-- `scheduled_actions_reminder_slot_idx`, and still cancelled by every one of the
-- four stop conditions in 0022. Only the *lookup* of the two facts above forks.


-- ── Where the candidate was when we sent it ──────────────────────────────────
--
-- `on delete set null` matches every other pointer at `position_stages`. A null
-- here after a stage deletion means the reminder producer can no longer resolve
-- an origin, so it queues nothing — which is the same "never guess a stage"
-- rule the rest of this engine follows. Rows already queued keep their own
-- `origin_stage_id`, and 0019's delete trigger cancels those.
alter table questionnaire_responses
  add column origin_stage_id uuid references position_stages (id) on delete set null;

-- The chase schedule for this one send, in the same shape and validated by the
-- same function as `stage_actions.reminder_config` (0022/0023). Storing it on
-- the response rather than reading a default at fire time matters: a reminder
-- that comes due in six days must be judged against the schedule that was in
-- force when it was created, not against whatever the code's default has become
-- since. `planScheduledAction` re-checks `reminder_number` against this on every
-- fire, exactly as it does against the stage action's block.
alter table questionnaire_responses
  add column reminder_config jsonb;

alter table questionnaire_responses
  add constraint questionnaire_responses_reminder_config_check
  check (is_valid_reminder_config(reminder_config));

-- Neither column means anything for the two pre-existing contexts, and a stray
-- value on one of those rows is not harmless — it is a schedule nothing will
-- ever read, or an origin stage that contradicts the stage action's own. Same
-- rule as 0024's per-question-type column constraints.
alter table questionnaire_responses
  add constraint questionnaire_responses_manual_columns_check
  check (
    context = 'manual_sent'
    or (origin_stage_id is null and reminder_config is null)
  );


-- ── One live manual send per candidate per questionnaire ─────────────────────
--
-- What a second bulk send to the same candidate does is a product decision, and
-- this index is where it is enforced rather than left to the caller's care —
-- the same reasoning as `questionnaire_responses_stage_action_idx` in 0023.
--
-- At most one *pending* manual response may exist for (application,
-- questionnaire). A second send therefore re-uses the row that is already
-- there: a fresh token is minted (which invalidates the previous link, exactly
-- as a reminder does) and the invitation is re-sent. It does NOT create a
-- second questionnaire for the candidate to fill in, and it does not start a
-- second reminder run — `schedule_questionnaire_reminders` conflicts against
-- the reminder-slot index and adds nothing.
--
-- The predicate is `status = 'pending'` and not merely `context = 'manual_sent'`
-- so that a *completed* response never blocks anything: history is kept whole,
-- and asking the same candidate again later is possible. The application layer
-- refuses that case with a per-candidate reason instead of silently re-asking.
create unique index questionnaire_responses_manual_pending_idx
  on questionnaire_responses (application_id, questionnaire_template_id)
  where context = 'manual_sent' and status = 'pending';


-- ── The reminder producer learns the second lookup ───────────────────────────
--
-- Unchanged from 0022 except for how the origin stage is resolved. Every
-- guarantee that made the original defensible is still here and still in the
-- same order: refuse a completed response, refuse a response someone has
-- stopped, cap at ten, drop malformed entries rather than raising,
-- `on conflict do nothing` against the unique slot index.
--
-- The origin is now: the stage action's stage if there is a stage action, else
-- the response's own `origin_stage_id`. Never `applications.current_stage_id`
-- read at this moment — the caller passes the stage it observed at send time,
-- because a candidate who has already moved on between the send and this call
-- must not have their reminders re-anchored to the new stage.
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

  if v_response.stage_action_id is not null then
    -- Reminders belong to the stage that sent the questionnaire, which is what
    -- makes cancel-on-move (AUT-6, and REM-3's second stop condition) apply to
    -- them without a line of new code.
    select sa.position_stage_id into v_origin_stage
      from stage_actions sa
     where sa.id = v_response.stage_action_id;
  else
    -- A manual send has no stage action, so the response carries the stage the
    -- candidate was in when it went out. Same role, same cancel-on-move.
    v_origin_stage := v_response.origin_stage_id;
  end if;

  -- No origin means no cancel-on-move, and a reminder run that cannot be
  -- cancelled by a stage move is one this engine will not start.
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


-- ── Access ───────────────────────────────────────────────────────────────────
--
-- `create or replace` keeps the existing ACL, but the rule from 0014/0021 is
-- worth restating rather than assumed: revoke from PUBLIC *and* from anon, then
-- grant by name.
revoke execute on function public.schedule_questionnaire_reminders(uuid, jsonb, timestamptz)
  from public, anon;
grant execute on function public.schedule_questionnaire_reminders(uuid, jsonb, timestamptz)
  to authenticated, service_role;
