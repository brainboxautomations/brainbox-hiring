-- Position field cleanup: three dead columns out, one new one in.
--
-- All three drops were confirmed against the whole codebase, not just the
-- schema — see the app-layer inventory the reviewing PR carries separately.
--
--   internal_id           a pure UI label. No dedup, no external sync, nothing
--                          reads it back once written.
--   category               write-only: captured on the position form and
--                          persisted, never rendered, filtered, searched or
--                          grouped anywhere.
--   apply_email_address    captured in the UI but never included in the
--                          create/update payload (`toRow()` in
--                          app/api/positions/_shared.ts has no line for it),
--                          and there is no inbound-email-ingestion code that
--                          reads it. Dead on both ends.
--
-- `if exists` on all three so this migration is safe to run twice.
alter table positions drop column if exists internal_id;
alter table positions drop column if exists category;
alter table positions drop column if exists apply_email_address;

-- education_level (0001) is a job-requirement dropdown — "No requirement" /
-- "High school" / "Bachelor's degree" / "Master's degree" — with no notion of
-- whether the stated level is a hard requirement or a preference. This column
-- adds that distinction for display on the public listing ("Bachelor's degree
-- required" vs "... preferred, not required"). It is informational only and
-- does not gate application submission anywhere.
--
-- Default true preserves current behaviour for every existing row: today
-- nothing says otherwise, so education_level has always read as required.
alter table positions add column education_level_required boolean not null default true;

-- ── `public_position_by_slug` (0009) named internal_id and category in its
-- explicit return list and select list, so it breaks the moment those columns
-- are gone: every call becomes a hard SQL error ("column p.internal_id does
-- not exist"), and this is the function the public careers detail page calls
-- on every job view. It cannot be left for a later migration — dropping the
-- columns and fixing this function are one change, not two.
--
-- Same coupling applies in reverse to the new education_level_required column:
-- the public careers detail page is the one place that column is meant to be
-- read (see the migration's comment above), and it only ever reads it through
-- this RPC, so education_level_required is added to the return list and select
-- list in the same breath as internal_id/category are removed from them.
--
-- Everything else is copied byte-for-byte from 0009: same security definer,
-- same search_path, same predicate, same grants. Only internal_id and category
-- are gone from the return table and the select list, and education_level_required
-- is added.
--
-- Postgres refuses `create or replace` across a change to a function's return
-- type, and a narrower `returns table (...)` list is exactly that, so the old
-- signature has to go first.
drop function if exists public.public_position_by_slug(text);

create function public.public_position_by_slug(p_slug text)
returns table (
  id uuid,
  title text,
  slug text,
  department text,
  locations jsonb,
  remote_flag boolean,
  position_type text,
  education_level text,
  education_level_required boolean,
  experience_level text,
  salary_from numeric,
  salary_to numeric,
  salary_period salary_period,
  salary_currency text,
  description text,
  status position_status,
  publish_mode publish_mode,
  application_form_config jsonb,
  application_questionnaire_id uuid,
  include_answers_on_profile boolean,
  assigned_pipeline_id uuid,
  email_sender_name text,
  hiring_team jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id, p.title, p.slug, p.department, p.locations, p.remote_flag,
    p.position_type, p.education_level, p.education_level_required, p.experience_level,
    p.salary_from, p.salary_to, p.salary_period, p.salary_currency, p.description,
    p.status, p.publish_mode, p.application_form_config, p.application_questionnaire_id,
    p.include_answers_on_profile, p.assigned_pipeline_id, p.email_sender_name,
    p.hiring_team, p.created_at
  from positions p
  where p.slug = p_slug
    and p.status = 'open'
    and p.publish_mode in ('listed', 'unlisted')
$$;

revoke all on function public.public_position_by_slug(text) from public;
grant execute on function public.public_position_by_slug(text) to anon, authenticated;
