-- When a candidate entered their current stage.
--
-- The board's "12m in stage" was computed from `applications.updated_at`, which
-- the BEFORE UPDATE trigger from 0001 bumps on every write to the row — not
-- only a stage change. Opening a candidate (marking them seen), starring,
-- archiving or a same-position resubmission (0036) all reset a card's clock.
-- QA saw it as other cards' times jumping to match a card just moved: the
-- cards around it had been opened or starred moments before.
--
-- `application_stage_entries` (0019) cannot stand in: it records the *first*
-- entry into each stage, so a candidate moved out and back would show the
-- older time. A column the stage change itself sets is the only exact source.
alter table applications add column stage_entered_at timestamptz;


-- Backfill. The first entry into the current stage is the best record there
-- is: exact for anyone who has entered it once, and the earlier visit for the
-- few who left and came back. Candidates with no entry row (created before
-- 0019's ledger) fall back to when they applied.
--
-- The `updated_at` trigger is paused for the backfill: this is not activity on
-- the applications, and letting it fire would stamp every row with the time of
-- this migration — resetting the "last activity" filter for the whole board.
alter table applications disable trigger applications_updated_at;

update applications a
   set stage_entered_at = coalesce(
         (select e.first_entered_at
            from application_stage_entries e
           where e.application_id = a.id
             and e.position_stage_id = a.current_stage_id),
         a.applied_at
       );

alter table applications enable trigger applications_updated_at;

alter table applications
  alter column stage_entered_at set default now(),
  alter column stage_entered_at set not null;


-- Kept current by the database, so every writer (the board, bulk moves, the
-- automation worker's move_to_stage, answer routing, public intake) gets it
-- right without having to remember. Only a real change of stage resets it.
create or replace function set_application_stage_entered_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.stage_entered_at := coalesce(new.stage_entered_at, now());
  elsif new.current_stage_id is distinct from old.current_stage_id then
    new.stage_entered_at := now();
  else
    -- Nothing else may move it: a star or a "seen" flag is not a stage change.
    new.stage_entered_at := old.stage_entered_at;
  end if;
  return new;
end;
$$;

create trigger applications_stage_entered_at
  before insert or update on applications
  for each row execute function set_application_stage_entered_at();
