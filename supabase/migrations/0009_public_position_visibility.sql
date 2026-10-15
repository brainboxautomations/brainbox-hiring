-- Close the unlisted-position enumeration hole (audit finding 2, PUB-2).
--
-- `positions_public_read` (0003) granted anon SELECT on every position whose
-- publish_mode was 'listed' OR 'unlisted'. The careers index narrowed that to
-- 'listed' in the query — but the anon key ships in the browser bundle, and a
-- PostgREST filter is supplied by the caller, so the narrowing was decoration.
-- `GET /rest/v1/positions?publish_mode=eq.unlisted` returned every unlisted role.
--
-- The tension: PUB-2 wants unlisted roles reachable "only by direct link", and a
-- direct link is a slug the caller types into the same caller-supplied filter.
-- RLS cannot distinguish "looking up the slug I was given" from "sweeping the
-- table", because both are the same query with a different WHERE clause.
--
-- Resolution: take unlisted rows off the table surface entirely and put the
-- direct-link case behind a SECURITY DEFINER lookup that accepts an exact slug
-- and returns at most one row. Knowledge of the slug becomes the capability,
-- which is what "reachable only by direct link" actually means. There is no
-- query shape that returns a list of unlisted roles.
--
-- What this does NOT prevent: an attacker who guesses or already knows a slug
-- still resolves the role, and the lookup can be probed one slug at a time.
-- That is inherent to a link-is-the-secret model. The mitigations are
-- unguessable slugs and request-rate limiting, neither of which belongs in — or
-- is achievable from — a policy. See docs/architecture.md.

-- ── The table surface: listed only ───────────────────────────────────────────
drop policy positions_public_read on positions;

create policy positions_public_listed_read on positions
  for select to anon
  using (status = 'open' and publish_mode = 'listed');

-- The questionnaire attached to an unlisted role leaks both its existence and
-- its screening content, so the same reasoning applies. Both tables come off the
-- anon surface; the application form is fed by the position-scoped lookup below,
-- which is the only consumer either policy ever had.
drop policy questionnaire_templates_public_read on questionnaire_templates;
drop policy questions_public_read on questions;

-- ── Direct-link lookup ───────────────────────────────────────────────────────
-- Column list mirrors the careers DETAIL_SELECT exactly. It is deliberately a
-- list and not `returns setof positions`: adding a column to `positions` must
-- not silently widen what the public careers page publishes.
create or replace function public.public_position_by_slug(p_slug text)
returns table (
  id uuid,
  title text,
  slug text,
  department text,
  internal_id text,
  locations jsonb,
  remote_flag boolean,
  position_type text,
  category text,
  education_level text,
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
    p.id, p.title, p.slug, p.department, p.internal_id, p.locations, p.remote_flag,
    p.position_type, p.category, p.education_level, p.experience_level,
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

-- ── Questions for the embedded application form ──────────────────────────────
-- `answer_routing` is deliberately absent: it is internal routing configuration
-- and must never be shipped to the applicant who is being routed.
create or replace function public.public_position_questions(p_position_id uuid)
returns table (
  id uuid,
  sort_order integer,
  type question_type,
  prompt text,
  help_text text,
  required boolean,
  options jsonb,
  video_max_duration integer
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.sort_order, q.type, q.prompt, q.help_text, q.required,
         q.options, q.video_max_duration
  from questions q
  join positions p on p.application_questionnaire_id = q.questionnaire_template_id
  where p.id = p_position_id
    and p.status = 'open'
    and p.publish_mode in ('listed', 'unlisted')
  order by q.sort_order
$$;

revoke all on function public.public_position_questions(uuid) from public;
grant execute on function public.public_position_questions(uuid) to anon, authenticated;

-- ── "Is this position accepting applications?" ───────────────────────────────
-- POST /api/apply answers 404 from this. It cannot read `positions` directly any
-- more: an unlisted role IS accepting applications while being invisible to
-- anon, so the check has to see through RLS. `submit_application` re-checks the
-- same condition, so this is the friendly-error path, not the security boundary.
create or replace function public.public_position_is_open(p_position_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from positions p
    where p.id = p_position_id
      and p.status = 'open'
      and p.publish_mode in ('listed', 'unlisted')
  )
$$;

revoke all on function public.public_position_is_open(uuid) from public;
grant execute on function public.public_position_is_open(uuid) to anon, authenticated;
