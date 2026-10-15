-- L4 — the reporting aggregates.
--
-- Somebody will make a hiring decision on these numbers, so every metric is
-- pinned here against a fixture whose answer was worked out by hand before the
-- query was run. If a later migration changes a definition, one of these fails
-- with the old number next to the new one rather than the report quietly moving.
--
-- Rewritten for 0043, which removed stage_type. There is no longer any
-- hired / rejected / in_pipeline classification to assert — a stage is a name and
-- a count. What replaced those assertions is the grouping rule: counts are per
-- position, and the merging bug the old report_monthly_stages had is pinned here
-- so it cannot come back.
--
-- ISOLATION FROM THE DEV DATABASE
--
-- The aggregates are company-wide: they count every application in the window,
-- including whatever the shared dev project already holds. So the fixture lives
-- in March 2099, a month no real application can be in, and every assertion is
-- against that month or a neighbour of it. Nothing here counts rows it did not
-- insert. The whole file runs in a transaction that rolls back, so 2099 does not
-- survive the test either.
--
-- THE FIXTURE, AND THE ANSWER IT IS SUPPOSED TO GIVE
--
-- Two positions. Alpha has Applied(1), Interview(2), Hired(3), Rejected(4). Beta
-- has Applied(1) and Rejected(2) — Beta's Rejected sits at a different sort_order
-- from Alpha's on purpose, so the per-position ordering rule is exercised rather
-- than accidentally satisfied. Both positions have a stage named 'Applied', which
-- is what pins the merging bug.
--
--   id  position  applied_at (UTC)         stage       status     counted in stages
--   A1  Alpha     2099-03-01 00:00:00      Applied     active     yes
--   A2  Alpha     2099-03-07 23:59:59      Applied     active     yes
--   A3  Alpha     2099-03-08 09:00:00      Interview   active     yes
--   A4  Alpha     2099-03-15 09:00:00      Hired       active     yes
--   A5  Alpha     2099-03-22 09:00:00      Rejected    active     yes
--   A6  Alpha     2099-03-31 23:59:59      Applied     archived   no
--   A7  Alpha     2099-03-29 09:00:00      (none)      active     yes, as 'No stage'
--   A8  Alpha     2099-03-16 09:00:00      Hired       archived   no
--   B1  Beta      2099-03-05 09:00:00      Applied     active     yes
--   B2  Beta      2099-03-10 09:00:00      Rejected    active     yes
--   X1  Alpha     2099-02-28 23:59:59      Applied     active     (February)
--   X2  Alpha     2099-04-01 00:00:00      Applied     active     (April)
--
-- A1 sits exactly on the window's opening instant and X2 exactly on its closing
-- instant, which is what makes the half-open interval [start, end) testable
-- rather than merely asserted in a comment.
--
-- Worked by hand, for March 2099:
--   received 10   archived 2 (A6 and A8)
--   weeks     W1 3 (A1,A2,B1)  W2 2 (A3,B2)  W3 2 (A4,A8)  W4 3 (A5,A7,A6)
--   positions Alpha 8 received, Beta 2 received
--   stages    Alpha: Applied 2, Interview 1, Hired 1, Rejected 1, No stage 1  (6)
--             Beta:  Applied 1, Rejected 1                                    (2)
--   and 6 + 2 = 8 = received 10 - archived 2, which is the one invariant a
--   reader of the screen has to be told about, so it carries its own test.
--
-- Note A8: someone archived while sitting in what used to be a 'success' stage.
-- The old report called them 'hired' because hired beat archived. There is no
-- such rule now — they are simply archived, and therefore absent from the stage
-- counts. That is the single number this rewrite changes: archived 1 becomes 2.
begin;

create schema if not exists tap;

create function tap.rfixture()
returns table (
  alpha uuid, beta uuid,
  alpha_applied uuid, alpha_interview uuid, alpha_hired uuid, alpha_rejected uuid,
  beta_applied uuid, beta_rejected uuid
)
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_pipeline uuid;
begin
  insert into pipelines (name) values ('pgTAP reporting pipeline ' || v_seed)
  returning id into v_pipeline;

  insert into positions (title, slug, status, assigned_pipeline_id)
  values ('pgTAP Reporting Alpha', 'pgtap-rpt-a-' || v_seed, 'open', v_pipeline)
  returning id into alpha;

  insert into positions (title, slug, status, assigned_pipeline_id)
  values ('pgTAP Reporting Beta', 'pgtap-rpt-b-' || v_seed, 'open', v_pipeline)
  returning id into beta;

  insert into position_stages (position_id, name, sort_order)
  values (alpha, 'Applied', 1) returning id into alpha_applied;
  insert into position_stages (position_id, name, sort_order)
  values (alpha, 'Interview', 2) returning id into alpha_interview;
  insert into position_stages (position_id, name, sort_order)
  values (alpha, 'Hired', 3) returning id into alpha_hired;
  insert into position_stages (position_id, name, sort_order)
  values (alpha, 'Rejected', 4) returning id into alpha_rejected;

  insert into position_stages (position_id, name, sort_order)
  values (beta, 'Applied', 1) returning id into beta_applied;
  insert into position_stages (position_id, name, sort_order)
  values (beta, 'Rejected', 2) returning id into beta_rejected;

  return next;
end;
$fn$;

-- One candidate per application, because a person may hold only one candidacy
-- per position (the identity rule from 0001).
create function tap.rapply(
  p_position uuid,
  p_stage uuid,
  p_applied_at timestamptz,
  p_status application_status default 'active'
)
returns uuid
language plpgsql
as $fn$
declare
  v_person uuid;
  v_application uuid;
begin
  insert into people (first_name, last_name, email)
  values ('pgTAP', 'Reporting', 'pgtap-rpt-' || gen_random_uuid() || '@example.com')
  returning id into v_person;

  insert into applications (person_id, position_id, current_stage_id, applied_at, status)
  values (v_person, p_position, p_stage, p_applied_at, p_status)
  returning id into v_application;

  return v_application;
end;
$fn$;

create function tap.rseed()
returns void
language plpgsql
as $fn$
declare
  f record;
begin
  select * into f from tap.rfixture();

  perform tap.rapply(f.alpha, f.alpha_applied,   '2099-03-01 00:00:00+00');
  perform tap.rapply(f.alpha, f.alpha_applied,   '2099-03-07 23:59:59+00');
  perform tap.rapply(f.alpha, f.alpha_interview, '2099-03-08 09:00:00+00');
  perform tap.rapply(f.alpha, f.alpha_hired,     '2099-03-15 09:00:00+00');
  perform tap.rapply(f.alpha, f.alpha_rejected,  '2099-03-22 09:00:00+00');
  perform tap.rapply(f.alpha, f.alpha_applied,   '2099-03-31 23:59:59+00', 'archived');
  perform tap.rapply(f.alpha, null,              '2099-03-29 09:00:00+00');
  perform tap.rapply(f.alpha, f.alpha_hired,     '2099-03-16 09:00:00+00', 'archived');

  perform tap.rapply(f.beta,  f.beta_applied,    '2099-03-05 09:00:00+00');
  perform tap.rapply(f.beta,  f.beta_rejected,   '2099-03-10 09:00:00+00');

  perform tap.rapply(f.alpha, f.alpha_applied,   '2099-02-28 23:59:59+00');
  perform tap.rapply(f.alpha, f.alpha_applied,   '2099-04-01 00:00:00+00');

  return;
end;
$fn$;


-- ── The window ───────────────────────────────────────────────────────────────

create function tap.test_a_month_is_a_half_open_utc_interval()
returns setof text
language plpgsql
as $fn$
begin
  return next is(
    report_month_start('2099-03-01'::date), '2099-03-01 00:00:00+00'::timestamptz,
    'a month starts at midnight UTC on the first'
  );
  return next is(
    report_month_end('2099-03-01'::date), '2099-04-01 00:00:00+00'::timestamptz,
    'and ends at midnight UTC on the first of the next month'
  );
  return next is(
    report_month_start('2099-03-17'::date), '2099-03-01 00:00:00+00'::timestamptz,
    'any date in the month truncates to the same start, so a mid-month input is not a mid-month window'
  );
  return next is(
    report_month_end('2099-03-17'::date), '2099-04-01 00:00:00+00'::timestamptz,
    'and to the same end'
  );

  -- February, because a window built by adding 30 or 31 days would be wrong here
  -- and nowhere else. 2099 is not a leap year.
  return next is(
    report_month_end('2099-02-10'::date), '2099-03-01 00:00:00+00'::timestamptz,
    'February ends on 1 March however many days it had'
  );
  return next is(
    report_month_end('2096-02-10'::date), '2096-03-01 00:00:00+00'::timestamptz,
    'including a leap February'
  );

  -- December must roll the year, not the month number.
  return next is(
    report_month_end('2099-12-04'::date), '2100-01-01 00:00:00+00'::timestamptz,
    'December ends on 1 January of the next year'
  );
end;
$fn$;

-- The reason report_month_start does `p_month::timestamp at time zone 'UTC'`
-- rather than `p_month::timestamptz`: the direct cast reads the date in the
-- session's TimeZone, so the same report would move by hours between psql and
-- PostgREST. This asserts it does not.
create function tap.test_the_window_ignores_the_session_time_zone()
returns setof text
language plpgsql
as $fn$
declare
  v_utc timestamptz;
  v_auckland timestamptz;
  v_honolulu timestamptz;
begin
  set local timezone to 'UTC';
  v_utc := report_month_start('2099-03-01'::date);

  set local timezone to 'Pacific/Auckland';
  v_auckland := report_month_start('2099-03-01'::date);

  set local timezone to 'Pacific/Honolulu';
  v_honolulu := report_month_start('2099-03-01'::date);

  set local timezone to 'UTC';

  return next is(v_auckland, v_utc, 'a UTC+13 session gets the same month boundary as a UTC one');
  return next is(v_honolulu, v_utc, 'and so does a UTC-10 session');
end;
$fn$;

create function tap.test_the_window_is_closed_at_the_start_and_open_at_the_end()
returns setof text
language plpgsql
as $fn$
declare
  v_march integer;
  v_february integer;
  v_april integer;
begin
  perform tap.rseed();

  select applications_received into v_march from report_monthly_totals('2099-03-01'::date);
  select applications_received into v_february from report_monthly_totals('2099-02-01'::date);
  select applications_received into v_april from report_monthly_totals('2099-04-01'::date);

  return next is(v_march, 10, 'March 2099 sees exactly the ten applications seeded into it');
  return next is(
    v_february, 1,
    'an application at 2099-02-28 23:59:59 UTC is February''s, one second before the boundary'
  );
  return next is(
    v_april, 1,
    'and one at exactly 2099-04-01 00:00:00 UTC is April''s — the end of the window is exclusive'
  );
end;
$fn$;


-- ── The KPI figures ──────────────────────────────────────────────────────────

create function tap.test_the_headline_figures()
returns setof text
language plpgsql
as $fn$
declare
  t record;
begin
  perform tap.rseed();
  select * into t from report_monthly_totals('2099-03-01'::date);

  return next is(t.applications_received, 10, 'applications received counts every application applied in the month, archived included');
  return next is(t.archived, 2, 'archived counts both flagged rows — the one in an ordinary stage and the one in what used to be a success stage');
end;
$fn$;

-- The one arithmetic a reader of the screen has to be told about: the stage bars
-- deliberately do not sum to applications received. Archived rows are counted in
-- the headline and left out of the bars, because the board hides them by default
-- and a report that disagreed with the board would send someone hunting a bug
-- that does not exist. The footnote on the screen says so; this pins it.
create function tap.test_archived_is_counted_in_the_headline_and_left_out_of_the_stages()
returns setof text
language plpgsql
as $fn$
declare
  t record;
  v_stage_sum integer;
begin
  perform tap.rseed();
  select * into t from report_monthly_totals('2099-03-01'::date);

  select sum(applications)::integer into v_stage_sum
  from report_monthly_position_stages('2099-03-01'::date)
  where position_title like 'pgTAP Reporting%';

  return next is(v_stage_sum, 8, 'the stage counts total 8, not the 10 the headline reports');
  return next is(
    v_stage_sum, t.applications_received - t.archived,
    'and the gap is exactly the archived applications — nothing else is unaccounted for'
  );
end;
$fn$;

-- Someone archived while sitting in what 0001 would have called a success stage.
-- The old report classified them 'hired', because hired beat archived. No such
-- rule survives, so they are archived and absent from the bars. Pinned because
-- it is the one number this rewrite deliberately changed.
create function tap.test_an_archived_application_is_archived_whatever_stage_it_sits_in()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_archived boolean;
  v_bars integer;
begin
  select * into f from tap.rfixture();
  perform tap.rapply(f.alpha, f.alpha_hired, '2099-07-04 09:00:00+00', 'archived');

  select is_archived into v_archived
  from report_month_applications('2099-07-01'::date)
  where stage_name = 'Hired';

  select count(*)::integer into v_bars
  from report_monthly_position_stages('2099-07-01'::date)
  where position_title like 'pgTAP Reporting%';

  return next ok(v_archived, 'the cohort reports it as archived, with no stage-derived verdict overriding that');
  return next is(v_bars, 0, 'and it appears on no stage bar at all');
end;
$fn$;

create function tap.test_an_empty_month_returns_zeroes_rather_than_no_row()
returns setof text
language plpgsql
as $fn$
declare
  t record;
  v_rows integer;
begin
  perform tap.rseed();

  select count(*)::integer into v_rows from report_monthly_totals('2099-05-01'::date);
  return next is(v_rows, 1, 'a month with no applications still returns exactly one totals row');

  select * into t from report_monthly_totals('2099-05-01'::date);
  return next is(t.applications_received, 0, 'applications received is 0, not null');
  return next is(t.archived, 0, 'archived is 0, not null');
end;
$fn$;


-- ── Applications received, by week ───────────────────────────────────────────

create function tap.test_the_four_week_buckets_tile_the_month()
returns setof text
language plpgsql
as $fn$
declare
  v_weeks integer[];
  v_total integer;
begin
  perform tap.rseed();

  select array_agg(applications_received order by week_number)
    into v_weeks
  from report_monthly_weeks('2099-03-01'::date);

  return next is(
    v_weeks, array[3, 2, 2, 3],
    'the weekly bars are W1 3, W2 2, W3 2, W4 3 — days 1-7, 8-14, 15-21 and 22 to month end'
  );

  select applications_received into v_total from report_monthly_totals('2099-03-01'::date);
  return next is(
    v_weeks[1] + v_weeks[2] + v_weeks[3] + v_weeks[4], v_total,
    'and they sum to applications received, because the buckets tile the month with no gap or overlap'
  );
end;
$fn$;

create function tap.test_every_day_of_a_long_month_lands_in_a_bucket()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  d integer;
  v_weeks integer[];
begin
  select * into f from tap.rfixture();

  -- One application on each of August 2099's thirty-one days.
  for d in 1..31 loop
    perform tap.rapply(
      f.alpha, f.alpha_applied,
      ('2099-08-' || lpad(d::text, 2, '0') || ' 12:00:00+00')::timestamptz
    );
  end loop;

  select array_agg(applications_received order by week_number)
    into v_weeks
  from report_monthly_weeks('2099-08-01'::date);

  return next is(
    v_weeks, array[7, 7, 7, 10],
    'days 29, 30 and 31 fall into W4 rather than a fifth bucket, so W4 runs long and nothing is dropped'
  );
end;
$fn$;

create function tap.test_an_empty_month_still_draws_four_bars()
returns setof text
language plpgsql
as $fn$
declare
  v_weeks integer[];
begin
  select array_agg(applications_received order by week_number)
    into v_weeks
  from report_monthly_weeks('2099-05-01'::date);

  return next is(
    v_weeks, array[0, 0, 0, 0],
    'a month with no applications returns four zero bars, not zero rows — a chart must not lose a bar'
  );
end;
$fn$;


-- ── Candidate counts by stage ────────────────────────────────────────────────

create function tap.test_stage_counts_are_grouped_per_position()
returns setof text
language plpgsql
as $fn$
declare
  v_names text[];
  v_counts integer[];
begin
  perform tap.rseed();

  select array_agg(stage_name), array_agg(applications)
    into v_names, v_counts
  from report_monthly_position_stages('2099-03-01'::date)
  where position_title = 'pgTAP Reporting Alpha';

  return next is(
    v_names, array['Applied', 'Interview', 'Hired', 'Rejected', 'No stage'],
    'Alpha''s stages come back in its own sort_order, with the unstaged bucket last'
  );
  return next is(
    v_counts, array[2, 1, 1, 1, 1],
    'Applied 2, Interview 1, Hired 1, Rejected 1, No stage 1 — the two archived rows are absent'
  );

  select array_agg(stage_name), array_agg(applications)
    into v_names, v_counts
  from report_monthly_position_stages('2099-03-01'::date)
  where position_title = 'pgTAP Reporting Beta';

  return next is(v_names, array['Applied', 'Rejected'], 'and Beta reports only its own two stages');
  return next is(v_counts, array[1, 1], 'one in each');
end;
$fn$;

-- The bug the old report_monthly_stages had, pinned so it cannot return. It
-- grouped by (stage_name, stage_type) with no position in the key, so Alpha's
-- Applied and Beta's Applied became one bar of 3 — and two teams running
-- unrelated processes that both happened to name a stage 'Screening' were
-- reported as a single number nobody could act on.
create function tap.test_two_positions_sharing_a_stage_name_are_never_merged()
returns setof text
language plpgsql
as $fn$
declare
  v_rows integer;
  v_counts integer[];
  v_positions integer;
begin
  perform tap.rseed();

  select count(*)::integer, array_agg(applications order by applications), count(distinct position_id)::integer
    into v_rows, v_counts, v_positions
  from report_monthly_position_stages('2099-03-01'::date)
  where stage_name = 'Applied'
    and position_title like 'pgTAP Reporting%';

  return next is(v_rows, 2, 'Applied is two rows, one per position — never one merged bar');
  return next is(v_counts, array[1, 2], 'Beta''s 1 and Alpha''s 2 stay apart rather than becoming 3');
  return next is(v_positions, 2, 'and each row carries its own position_id, which is what the screen keys on');
end;
$fn$;

-- Two positions may legitimately share a title — a role reposted next quarter —
-- so identity is the id and never the name. A consumer grouping on title would
-- fan out; this is what tells them not to.
create function tap.test_a_row_is_identified_by_position_id_not_by_title()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_second uuid;
  v_stage uuid;
  v_titles integer;
  v_ids integer;
begin
  select * into f from tap.rfixture();

  insert into positions (title, slug, status)
  values ('pgTAP Reporting Alpha', 'pgtap-rpt-dupe-' || replace(gen_random_uuid()::text, '-', ''), 'open')
  returning id into v_second;

  insert into position_stages (position_id, name, sort_order)
  values (v_second, 'Applied', 1) returning id into v_stage;

  perform tap.rapply(f.alpha, f.alpha_applied, '2099-11-03 09:00:00+00');
  perform tap.rapply(v_second, v_stage, '2099-11-04 09:00:00+00');

  select count(distinct position_title)::integer, count(distinct position_id)::integer
    into v_titles, v_ids
  from report_monthly_position_stages('2099-11-01'::date)
  where position_title = 'pgTAP Reporting Alpha';

  return next is(v_titles, 1, 'both positions report the same title');
  return next is(v_ids, 2, 'but they are two distinct position ids, and therefore two cards on the screen');
end;
$fn$;

create function tap.test_an_unstaged_application_is_kept_as_no_stage()
returns setof text
language plpgsql
as $fn$
declare
  v_stage_id uuid;
  v_count integer;
begin
  perform tap.rseed();

  select stage_id, applications into v_stage_id, v_count
  from report_monthly_position_stages('2099-03-01'::date)
  where stage_name = 'No stage'
    and position_title = 'pgTAP Reporting Alpha';

  return next is(v_count, 1, 'an application with no current stage is kept rather than dropped');
  return next is(v_stage_id, null::uuid, 'and it carries a null stage_id, so the screen can tell it apart from a real stage');
end;
$fn$;

create function tap.test_an_empty_month_has_no_stage_bars()
returns setof text
language plpgsql
as $fn$
begin
  return next is(
    (select count(*)::integer from report_monthly_position_stages('2099-05-01'::date)), 0,
    'a month with no applications has no stage bars at all, which is the screen''s empty state'
  );
end;
$fn$;


-- ── Breakdown by position ────────────────────────────────────────────────────

create function tap.test_the_position_list_reproduces_the_headline()
returns setof text
language plpgsql
as $fn$
declare
  t record;
  v_titles text[];
  v_received integer[];
begin
  perform tap.rseed();

  select
    array_agg(position_title order by applications_received desc, position_title),
    array_agg(applications_received order by applications_received desc, position_title)
  into v_titles, v_received
  from report_monthly_positions('2099-03-01'::date)
  where position_title like 'pgTAP Reporting%';

  return next is(
    v_titles, array['pgTAP Reporting Alpha', 'pgTAP Reporting Beta'],
    'the busiest position is listed first'
  );
  return next is(v_received, array[8, 2], 'Alpha received 8 applications in the month and Beta 2');

  select * into t from report_monthly_totals('2099-03-01'::date);
  return next is(
    (select sum(applications_received)::integer from report_monthly_positions('2099-03-01'::date)),
    t.applications_received,
    'and summing the column reproduces the applications received card exactly'
  );
end;
$fn$;

-- The screen walks positions in the order report_monthly_positions returns them
-- and looks up each one's stages by id, so the two result sets have to agree on
-- which positions exist. If one listed a position the other did not, a card
-- would render with no bars or bars would have nowhere to go.
create function tap.test_the_two_position_result_sets_cover_the_same_positions()
returns setof text
language plpgsql
as $fn$
declare
  v_missing integer;
begin
  perform tap.rseed();

  select count(*)::integer into v_missing
  from report_monthly_position_stages('2099-03-01'::date) s
  where not exists (
    select 1 from report_monthly_positions('2099-03-01'::date) p
    where p.position_id = s.position_id
  );

  return next is(v_missing, 0, 'every stage row belongs to a position the position list also returns');
end;
$fn$;

create function tap.test_a_position_with_no_applications_this_month_is_left_out()
returns setof text
language plpgsql
as $fn$
declare
  f record;
  v_rows integer;
begin
  select * into f from tap.rfixture();
  perform tap.rapply(f.alpha, f.alpha_applied, '2099-10-09 09:00:00+00');

  select count(*)::integer into v_rows
  from report_monthly_positions('2099-10-01'::date)
  where position_title like 'pgTAP Reporting%';

  return next is(
    v_rows, 1,
    'Beta exists but received nothing in October, so it is not listed at zero — the filter narrows the page'
  );
end;
$fn$;

create function tap.test_an_empty_month_has_no_position_rows()
returns setof text
language plpgsql
as $fn$
begin
  return next is(
    (select count(*)::integer from report_monthly_positions('2099-05-01'::date)), 0,
    'and a month with no applications lists no positions'
  );
end;
$fn$;


-- ── The month dropdown ───────────────────────────────────────────────────────

create function tap.test_the_month_list_offers_every_month_with_activity()
returns setof text
language plpgsql
as $fn$
declare
  v_months date[];
begin
  perform tap.rseed();

  select array_agg(month order by month desc)
    into v_months
  from report_available_months('2099-04-15 09:00:00+00'::timestamptz)
  where month >= '2099-01-01'::date;

  return next is(
    v_months, array['2099-04-01', '2099-03-01', '2099-02-01']::date[],
    'the three months the fixture has applications in are offered, newest first'
  );
end;
$fn$;

create function tap.test_the_current_month_is_always_offered_even_with_no_activity()
returns setof text
language plpgsql
as $fn$
declare
  v_present boolean;
  v_first date;
begin
  perform tap.rseed();

  select exists (
    select 1 from report_available_months('2099-06-20 09:00:00+00'::timestamptz)
    where month = '2099-06-01'::date
  ) into v_present;

  select month into v_first
  from report_available_months('2099-06-20 09:00:00+00'::timestamptz)
  order by month desc
  limit 1;

  return next ok(
    v_present,
    'June 2099 has no applications but is still offered, so a brand-new account lands on the empty state and not an empty dropdown'
  );
  return next is(
    v_first, '2099-06-01'::date,
    'and it sorts to the top, so the screen can default to the current month'
  );
end;
$fn$;

-- The list is deduplicated: ten applications in one month must not produce ten
-- identical entries in the dropdown.
create function tap.test_the_month_list_has_no_duplicates()
returns setof text
language plpgsql
as $fn$
declare
  v_all integer;
  v_distinct integer;
begin
  perform tap.rseed();

  select count(*)::integer, count(distinct month)::integer
    into v_all, v_distinct
  from report_available_months('2099-04-15 09:00:00+00'::timestamptz);

  return next is(v_all, v_distinct, 'each month appears once however many applications it holds');
end;
$fn$;


-- ── Exposure ─────────────────────────────────────────────────────────────────
--
-- Same rule as 06: nothing in this subsystem is anon-callable. These are plain
-- reads of company-wide hiring data, and PostgREST publishes anything anon may
-- execute at /rest/v1/rpc/<name>.

create function tap.test_no_reporting_function_is_anon_callable()
returns setof text
language plpgsql
as $fn$
declare
  v_name name;
  v_args name[];
  v_functions constant text[][] := array[
    array['report_month_start', 'date'],
    array['report_month_end', 'date'],
    array['report_month_applications', 'date'],
    array['report_monthly_totals', 'date'],
    array['report_monthly_weeks', 'date'],
    array['report_monthly_positions', 'date'],
    array['report_monthly_position_stages', 'date'],
    array['report_available_months', 'timestamptz']
  ];
  v_row text[];
begin
  foreach v_row slice 1 in array v_functions loop
    v_name := v_row[1]::name;
    v_args := array[v_row[2]]::name[];

    return next function_privs_are(
      'public'::name, v_name, v_args, 'anon'::name, array[]::name[],
      format('%s is not callable by anon', v_name)
    );
    return next function_privs_are(
      'public'::name, v_name, v_args, 'public'::name, array[]::name[],
      format('%s carries no PUBLIC execute grant either, which is where anon would inherit one', v_name)
    );
    return next function_privs_are(
      'public'::name, v_name, v_args, 'authenticated'::name, array['EXECUTE']::name[],
      format('%s is callable by a signed-in user, which is who reads the report', v_name)
    );
  end loop;
end;
$fn$;

create function tap.test_the_reporting_functions_pin_their_search_path()
returns setof text
language plpgsql
as $fn$
declare
  v_unpinned text[];
begin
  select array_agg(p.proname order by p.proname)
    into v_unpinned
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname like 'report_%'
    and (p.proconfig is null or not (p.proconfig @> array['search_path=public']));

  return next is(
    v_unpinned, null::text[],
    'every reporting function pins search_path, so its behaviour does not depend on the caller'
  );
end;
$fn$;

create function tap.test_the_reporting_functions_are_security_invoker()
returns setof text
language plpgsql
as $fn$
declare
  v_definers text[];
begin
  select array_agg(p.proname order by p.proname)
    into v_definers
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname like 'report_%'
    and p.prosecdef;

  return next is(
    v_definers, null::text[],
    'none of them is SECURITY DEFINER — a definer here would be a standing bypass of whatever RLS becomes later'
  );
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
