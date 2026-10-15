-- Remove stage_type, and rebuild reporting around stage names instead.
--
-- stage_type (0001) classified every stage as active / success / terminal /
-- neutral. It existed to answer two questions the app could not otherwise
-- answer: which stage means "hired" for the Reports cards, and which stages to
-- fold away on the board. It never affected emails, automations, or anything a
-- recruiter does day to day.
--
-- Both of those questions are being withdrawn rather than answered:
--
--   Reports no longer classifies anyone. A stage is a name and a count, and the
--   reader decides what "Doesn't meet hiring criteria" means — which they always
--   did anyway. No hired / rejected / in-pipeline totals exist to be marked up.
--
--   The board no longer folds anything. Every stage is a plain column. The
--   closed/rejected drawer is gone with the type that drove it.
--
-- The change this unlocks is bigger than the deletion. report_monthly_stages
-- grouped by (stage_name, stage_type) across every position at once, so the
-- "Applied" of ten positions merged into one bar and two unrelated pipelines
-- were added together. Counts are now grouped per position, which is the only
-- grouping that cannot merge stages that were never the same stage:
-- position_stages is a per-position snapshot, so a stage id belongs to exactly
-- one position and one pipeline.
--
-- Ordering: within a position, stages come back in the position's own pipeline
-- order (sort_order), never alphabetically or by size. A report that reorders a
-- hiring process is telling the reader something untrue about it.


-- ── The functions that name stage_type have to go first ──────────────────────
--
-- Three functions reference the type — verified against the live catalogue, not
-- inferred from the migration files. report_month_applications and
-- report_monthly_stages return it in their signatures, so `create or replace`
-- cannot narrow them; they must be dropped. snapshot_pipeline_to_position only
-- copies the column, so it is replaced in place.
--
-- report_monthly_totals and report_monthly_positions do not name the type, but
-- both read the `outcome` column that stage_type produced, so both are rebuilt
-- here too. report_monthly_weeks and report_available_months are untouched.

drop function if exists public.report_monthly_stages(date);
drop function if exists public.report_monthly_totals(date);
drop function if exists public.report_monthly_positions(date);
drop function if exists public.report_month_applications(date);


-- ── The cohort, with no verdict attached ─────────────────────────────────────
--
-- One row per application received in the month, carrying where that application
-- stands now. Same window as before: [month 00:00 UTC, next month 00:00 UTC).
--
-- What changed is what is absent. There is no `outcome` column, because there is
-- no longer any rule in this database for what a stage means. stage_id joins
-- through, so counts can group on identity rather than on a name that two
-- positions might share.
--
-- is_archived replaces the old 'archived' outcome branch. It stays a flag rather
-- than becoming a bucket, which is what it always was on the board: archiving
-- never moves a candidate out of their stage.
--
-- day_of_month is read in UTC for the same reason the window is — the weekly bars
-- must bucket by the same clock that decided which month a row belongs to.

create function report_month_applications(p_month date)
returns table (
  application_id uuid,
  position_id uuid,
  position_title text,
  applied_at timestamptz,
  day_of_month integer,
  stage_id uuid,
  stage_name text,
  stage_sort_order integer,
  is_archived boolean
)
language sql
stable
set search_path = public
as $$
  select
    a.id,
    p.id,
    p.title,
    a.applied_at,
    extract(day from (a.applied_at at time zone 'UTC'))::integer,
    s.id,
    coalesce(s.name, 'No stage'),
    s.sort_order,
    a.status = 'archived'
  from applications a
  join positions p on p.id = a.position_id
  left join position_stages s on s.id = a.current_stage_id
  where a.applied_at >= report_month_start(p_month)
    and a.applied_at < report_month_end(p_month);
$$;


-- ── The headline figures ─────────────────────────────────────────────────────
--
-- Two numbers now, where there were five. applications_received is the only
-- cross-position total that survives the removal of stage meanings: every other
-- card asked "how many were hired" and nothing in the schema can answer that any
-- more, by design.
--
-- archived is returned so the screen can print its footnote. Archived
-- applications are counted here but excluded from the per-stage counts below,
-- matching the board, which hides them by default. The alternative — counting
-- them in their stage — would have the report claim twelve in "Applied" where the
-- board shows nine, and sending someone to hunt a phantom bug is worse than a
-- sum that needs one line of explanation.
--
-- A month with no applications returns one row of zeroes, never zero rows:
-- count(*) over an empty set is 0 and there is no GROUP BY to collapse it. That
-- is what keeps a new account rendering zeroes rather than an undefined figure.

create function report_monthly_totals(p_month date)
returns table (
  applications_received integer,
  archived integer
)
language sql
stable
set search_path = public
as $$
  select
    count(*)::integer,
    count(*) filter (where c.is_archived)::integer
  from report_month_applications(p_month) c;
$$;


-- ── Applications received, by position (RPT-2) ───────────────────────────────
--
-- Only positions that received at least one application in the month appear.
-- Listing every draft at zero would bury the ones that matter; the month filter
-- is meant to narrow the page, not pad it.
--
-- Busiest first, then alphabetically, so two loads of the same month agree.

create function report_monthly_positions(p_month date)
returns table (
  position_id uuid,
  position_title text,
  applications_received integer
)
language sql
stable
set search_path = public
as $$
  select
    c.position_id,
    c.position_title,
    count(*)::integer
  from report_month_applications(p_month) c
  group by c.position_id, c.position_title
  order by count(*) desc, c.position_title;
$$;


-- ── Candidate counts by stage, within each position (RPT-1) ──────────────────
--
-- Replaces report_monthly_stages. The old function grouped by (stage_name,
-- stage_type) with no position in the key, which merged every position's
-- "Applied" into a single bar and silently added unrelated pipelines together.
-- Grouping by position_id and stage_id cannot do that: a position_stages row
-- belongs to exactly one position.
--
-- Archived applications are excluded here and only here — see the note on
-- report_monthly_totals. Consequence, stated so nobody has to derive it: a
-- position's stage counts sum to its applications_received minus its archived
-- applications, not to applications_received.
--
-- Applications with no current stage are grouped under 'No stage' with a null
-- stage_id rather than dropped, which happens when a position has no pipeline
-- assigned or a stage was deleted underneath a candidate. Dropping them would
-- make a position's bars quietly fail to account for people who exist.
--
-- Order is (position title, then the position's own sort_order). 'No stage' has
-- no sort_order and sorts last within its position. Only the ordering *within* a
-- position is load-bearing: the screen walks positions in the order
-- report_monthly_positions returns them (busiest first) and looks up each one's
-- stages here, so this function does not need to reproduce that ranking.

create function report_monthly_position_stages(p_month date)
returns table (
  position_id uuid,
  position_title text,
  stage_id uuid,
  stage_name text,
  applications integer
)
language sql
stable
set search_path = public
as $$
  select
    c.position_id,
    c.position_title,
    c.stage_id,
    c.stage_name,
    count(*)::integer
  from report_month_applications(p_month) c
  where not c.is_archived
  group by c.position_id, c.position_title, c.stage_id, c.stage_name
  order by
    c.position_title,
    min(coalesce(c.stage_sort_order, 2147483647)),
    c.stage_name;
$$;


-- ── The column itself ────────────────────────────────────────────────────────
--
-- snapshot_pipeline_to_position copies template stages into a position, and
-- named stage_type in both its insert and select lists, so it breaks the moment
-- the column is gone. Dropping the column and fixing this function are one
-- change, not two. Everything else is byte-for-byte from 0002: same guardrail,
-- same security invoker, same pinned search_path (0013).

create or replace function snapshot_pipeline_to_position(
  p_position_id uuid,
  p_pipeline_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status position_status;
begin
  select status into v_status from positions where id = p_position_id for update;

  if v_status is null then
    raise exception 'Position % not found', p_position_id;
  end if;

  if v_status <> 'draft' then
    raise exception 'Cannot re-snapshot stages on a % position; stages are frozen once live', v_status;
  end if;

  delete from position_stages where position_id = p_position_id;

  insert into position_stages (position_id, source_template_stage_id, name, sort_order)
  select p_position_id, s.id, s.name, s.sort_order
  from pipeline_template_stages s
  where s.pipeline_id = p_pipeline_id
  order by s.sort_order;

  update positions set assigned_pipeline_id = p_pipeline_id where id = p_position_id;
end;
$$;

alter table pipeline_template_stages drop column if exists stage_type;
alter table position_stages drop column if exists stage_type;

drop type if exists stage_type;


-- ── Exposure ─────────────────────────────────────────────────────────────────
--
-- Same posture as 0030: SECURITY INVOKER, because RLS already grants
-- authenticated `using (true)` on every internal table and a definer function
-- would be a standing bypass of whatever RLS becomes later.
--
-- Two revokes per function, not one — the named grants Supabase's default
-- privileges hand out at creation, and Postgres's own implicit grant to PUBLIC,
-- which is where anon would otherwise inherit one (0014, 0021, 0030).

revoke execute on function public.report_month_applications(date) from public, anon;
revoke execute on function public.report_monthly_totals(date) from public, anon;
revoke execute on function public.report_monthly_positions(date) from public, anon;
revoke execute on function public.report_monthly_position_stages(date) from public, anon;

grant execute on function public.report_month_applications(date) to authenticated;
grant execute on function public.report_monthly_totals(date) to authenticated;
grant execute on function public.report_monthly_positions(date) to authenticated;
grant execute on function public.report_monthly_position_stages(date) to authenticated;
