-- M7b — Reporting (RPT-1, RPT-2).
--
-- Every figure on /reports was hardcoded. This migration is where the numbers
-- come from, and — more importantly — where each metric is *defined*. The
-- definitions live here rather than in TypeScript for two reasons:
--
--   1. Volume. Fetching every application and reducing it in the browser does
--      not survive a real account. These aggregate in Postgres and return one
--      short row set each.
--   2. Testability. A metric whose definition is spread across a React
--      component cannot be pinned by a known-input/known-output test. Here it
--      can, and supabase/tests/12_reporting.test.sql does exactly that.
--
-- WHAT THE PRD ASKS FOR, AND NOTHING MORE
--
--   RPT-1  "A reporting view with a monthly filter showing at minimum
--           applications received and candidate counts by stage for a selected
--           period."
--   RPT-2  "Breakdown by position."
--   RPT-3  "Deeper metrics (conversion, time-to-hire, source, recruiter) are
--           deferred."
--
-- So: no conversion rates, no time-to-hire, no source or recruiter attribution.
-- Nothing below computes a ratio between two stages, or a duration.
--
-- THE MONTH WINDOW, AND THE TIME ZONE
--
-- A "month" is the half-open interval
--     [ first day of the month 00:00 UTC , first day of the next month 00:00 UTC )
-- and every function below uses report_month_start / report_month_end to get
-- it, so no two cards on the screen can disagree about where a month begins.
--
-- UTC, not a local zone, because there is no company time zone anywhere in this
-- schema or in the PRD to read one from, and inventing one would make the same
-- application land in different months depending on who is looking. UTC also
-- has no DST discontinuity, so adding one month cannot produce a 23- or 25-hour
-- day at a boundary.
--
-- The consequence, stated with the case where it actually bites: an application
-- submitted at 00:30 on 1 June by someone in London (British Summer Time, UTC+1)
-- happened at 23:30 UTC on 31 May, so it counts as MAY. A London reader looking
-- at the June report will not find it there. That is the price of one fixed
-- boundary for everybody, and it is repeated in docs/architecture.md.
--
-- THE COHORT: ONE SET OF ROWS FEEDS EVERY CARD
--
-- report_month_applications is the single definition of "the applications this
-- month's report is about": every application whose applied_at falls inside the
-- window, regardless of what has happened to it since. The KPI cards, the
-- weekly bars, the stage bars and the per-position table are all thin GROUP BYs
-- over that one function. That is what makes the month filter drive the whole
-- page rather than most of it, and it is why the position table's totals row
-- necessarily equals the KPI row.
--
-- The stage bars therefore answer "of the people who applied in June, where do
-- they stand now?" — a cohort question, not a point-in-time snapshot of the
-- board. A true "where did the board stand on 30 June" would need a stage
-- history this schema does not keep (application_stage_entries records only the
-- first entry into a stage, and only since 0019), so it is not attempted.
-- Guessing it from partial data would be the subtly-wrong report that is worse
-- than the missing one.


-- ── The month window ─────────────────────────────────────────────────────────
--
-- Both take a date and truncate it to the first of its month, so a caller
-- passing 2026-06-17 gets June, not a window starting mid-month.
--
-- p_month::timestamp yields a *naive* midnight; AT TIME ZONE 'UTC' then reads
-- that wall clock as UTC and produces a timestamptz. Doing it this way rather
-- than p_month::timestamptz matters: the direct cast would interpret the date in
-- whatever TimeZone the session happens to carry, so the same report would move
-- by a few hours between a psql session and PostgREST.

create function report_month_start(p_month date)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select date_trunc('month', p_month::timestamp) at time zone 'UTC';
$$;

create function report_month_end(p_month date)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select (date_trunc('month', p_month::timestamp) + interval '1 month') at time zone 'UTC';
$$;


-- The month filter scans applied_at and nothing else indexes it.
create index applications_applied_at_idx on applications (applied_at);


-- ── The cohort ───────────────────────────────────────────────────────────────
--
-- One row per application received in the month, carrying everything the four
-- aggregates need. outcome is the only place a candidate's standing is
-- classified, so the four cards and the table cannot drift apart.
--
-- The outcome branches are ordered, and the order is the definition:
--
--   hired        the current stage is a success stage. Checked first, because
--                someone who was hired and later archived was still hired.
--   rejected     the current stage is a terminal stage — the pipeline's own
--                rejection / withdrawal / disqualification stages.
--   archived     applications.status = 'archived' while sitting in an active,
--                neutral or no stage. Archiving is a flag; it never moves the
--                candidate, and the board hides these rows by default, so they
--                are NOT counted as in pipeline.
--   in_pipeline  everything else: still active, still in an active or neutral
--                stage (or in no stage at all, which happens when a position
--                had no pipeline assigned or a stage was deleted).
--
-- Consequence, stated so nobody has to derive it: in_pipeline + hired + rejected
-- does NOT have to equal the total, because archived is the remainder. That is
-- deliberate — inflating "in pipeline" with candidates nobody is considering
-- would be the more damaging error. Every application is still visible on the
-- page, because the stage bars count the whole cohort.
--
-- day_of_month is read in UTC for the same reason the window is: the weekly bars
-- must bucket by the same clock that decided which month the row is in.

create function report_month_applications(p_month date)
returns table (
  application_id uuid,
  position_id uuid,
  position_title text,
  applied_at timestamptz,
  day_of_month integer,
  stage_name text,
  stage_type stage_type,
  stage_sort_order integer,
  outcome text
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
    coalesce(s.name, 'No stage'),
    s.stage_type,
    s.sort_order,
    case
      when s.stage_type = 'success' then 'hired'
      when s.stage_type = 'terminal' then 'rejected'
      when a.status = 'archived' then 'archived'
      else 'in_pipeline'
    end
  from applications a
  join positions p on p.id = a.position_id
  left join position_stages s on s.id = a.current_stage_id
  where a.applied_at >= report_month_start(p_month)
    and a.applied_at < report_month_end(p_month);
$$;


-- ── The four KPI figures ─────────────────────────────────────────────────────
--
-- archived is returned even though the approved design has no card for it, so
-- that a reader of this function can see the whole partition and satisfy
-- themselves that nothing is unaccounted for. The API passes it through and the
-- screen keeps the design's four cards, but prints a one-line footnote when it
-- is non-zero — otherwise a reader sees 10 received, 5 + 2 + 2 below it, and has
-- no way to find out where the tenth went.
--
-- A month with no applications returns one row of zeroes, never zero rows —
-- count(*) over an empty set is 0, and there is no GROUP BY to collapse. That is
-- what keeps a brand-new account rendering zeroes instead of an undefined
-- figure.

create function report_monthly_totals(p_month date)
returns table (
  applications_received integer,
  in_pipeline integer,
  hired integer,
  rejected integer,
  archived integer
)
language sql
stable
set search_path = public
as $$
  select
    count(*)::integer,
    count(*) filter (where c.outcome = 'in_pipeline')::integer,
    count(*) filter (where c.outcome = 'hired')::integer,
    count(*) filter (where c.outcome = 'rejected')::integer,
    count(*) filter (where c.outcome = 'archived')::integer
  from report_month_applications(p_month) c;
$$;


-- ── Applications received, by week ───────────────────────────────────────────
--
-- Four buckets by day of month: 1-7, 8-14, 15-21, 22-end. Not ISO weeks, which
-- would straddle month boundaries and produce five or six ragged bars whose ends
-- fall outside the very window the rest of the page is filtered by.
--
-- The trade is that W4 is nine to ten days long rather than seven, so its bar is
-- expected to run high; the screen says so under the chart title. What the
-- buckets do guarantee is that they tile the month exactly, so the four bars sum
-- to applications_received for any month of any length, including February.
--
-- generate_series on the left means all four rows always come back, at zero if
-- need be. A chart that silently loses a bar is worse than one showing a zero.

create function report_monthly_weeks(p_month date)
returns table (
  week_number integer,
  applications_received integer
)
language sql
stable
set search_path = public
as $$
  select w.n, coalesce(counted.total, 0)::integer
  from generate_series(1, 4) as w(n)
  left join (
    select least(4, ((c.day_of_month - 1) / 7) + 1) as week_number, count(*) as total
    from report_month_applications(p_month) c
    group by 1
  ) counted on counted.week_number = w.n
  order by w.n;
$$;


-- ── Candidate counts by stage (RPT-1) ────────────────────────────────────────
--
-- Stages are per-position snapshots (position_stages), so a report that grouped
-- by stage id would draw one bar per position per stage — forty bars for ten
-- positions. They are grouped by name and type instead, which merges the
-- "Applied" of every position into one bar, as the approved design shows.
--
-- Two positions using the same stage name with different types stay separate,
-- because a "Review" that rejects and a "Review" that does not are not the same
-- thing and must not be added together.
--
-- Applications with no current stage are grouped under 'No stage' rather than
-- dropped, which is what makes the bars sum to applications_received. Ordering
-- follows the pipeline: the earliest sort_order the name is used at, then the
-- name. 'No stage' has none and sorts last.

create function report_monthly_stages(p_month date)
returns table (
  stage_name text,
  stage_type stage_type,
  applications integer
)
language sql
stable
set search_path = public
as $$
  select c.stage_name, c.stage_type, count(*)::integer
  from report_month_applications(p_month) c
  group by c.stage_name, c.stage_type
  order by min(coalesce(c.stage_sort_order, 2147483647)), c.stage_name;
$$;


-- ── Breakdown by position (RPT-2) ────────────────────────────────────────────
--
-- The same four figures as the KPI row, per position, over the same cohort — so
-- summing any column down this table reproduces the matching card exactly.
--
-- Only positions that received at least one application in the month appear.
-- Listing every draft position at zero would bury the four that matter, and the
-- month filter is supposed to narrow the page, not pad it.
--
-- Busiest first, then alphabetically so the order is stable between two loads of
-- the same month.

create function report_monthly_positions(p_month date)
returns table (
  position_id uuid,
  position_title text,
  applied integer,
  in_pipeline integer,
  hired integer,
  rejected integer
)
language sql
stable
set search_path = public
as $$
  select
    c.position_id,
    c.position_title,
    count(*)::integer,
    count(*) filter (where c.outcome = 'in_pipeline')::integer,
    count(*) filter (where c.outcome = 'hired')::integer,
    count(*) filter (where c.outcome = 'rejected')::integer
  from report_month_applications(p_month) c
  group by c.position_id, c.position_title
  order by count(*) desc, c.position_title;
$$;


-- ── Which months the filter may offer ────────────────────────────────────────
--
-- Every month that has at least one application, plus the month p_now falls in,
-- newest first, capped at 24. The current month is unioned in unconditionally so
-- a brand-new account still has something to select and lands on the empty state
-- rather than on an empty dropdown.
--
-- p_now is a parameter and the function never reads now(), so pgTAP can assert
-- what the list looks like in a given month instead of waiting for one.

create function report_available_months(p_now timestamptz)
returns table (month date)
language sql
stable
set search_path = public
as $$
  select m.month
  from (
    select date_trunc('month', a.applied_at at time zone 'UTC')::date as month
    from applications a
    union
    select date_trunc('month', p_now at time zone 'UTC')::date
  ) m
  order by m.month desc
  limit 24;
$$;


-- ── Exposure ─────────────────────────────────────────────────────────────────
--
-- These are SECURITY INVOKER on purpose. RLS gives authenticated using (true) on
-- every internal table, so no elevation is needed, and a definer function here
-- would be a standing bypass of whatever RLS becomes later.
--
-- Two EXECUTE grants have to be revoked, not one — the named grants Supabase's
-- default privileges hand out at creation time, and Postgres's own implicit
-- grant to PUBLIC, which is where anon would otherwise inherit one (0014, 0021).

revoke execute on function public.report_month_start(date) from public, anon;
revoke execute on function public.report_month_end(date) from public, anon;
revoke execute on function public.report_month_applications(date) from public, anon;
revoke execute on function public.report_monthly_totals(date) from public, anon;
revoke execute on function public.report_monthly_weeks(date) from public, anon;
revoke execute on function public.report_monthly_stages(date) from public, anon;
revoke execute on function public.report_monthly_positions(date) from public, anon;
revoke execute on function public.report_available_months(timestamptz) from public, anon;

grant execute on function public.report_month_start(date) to authenticated, service_role;
grant execute on function public.report_month_end(date) to authenticated, service_role;
grant execute on function public.report_month_applications(date) to authenticated, service_role;
grant execute on function public.report_monthly_totals(date) to authenticated, service_role;
grant execute on function public.report_monthly_weeks(date) to authenticated, service_role;
grant execute on function public.report_monthly_stages(date) to authenticated, service_role;
grant execute on function public.report_monthly_positions(date) to authenticated, service_role;
grant execute on function public.report_available_months(timestamptz) to authenticated, service_role;
