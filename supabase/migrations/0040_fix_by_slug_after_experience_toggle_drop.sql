-- 0039 dropped positions.include_answers_on_profile but missed that
-- public_position_by_slug (0038) still named and selected it — same class of
-- coupling 0038 itself called out for internal_id/category. Caught by
-- 04_positions_public_visibility.test.sql failing after 0039 shipped.
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
    p.assigned_pipeline_id, p.email_sender_name,
    p.hiring_team, p.created_at
  from positions p
  where p.slug = p_slug
    and p.status = 'open'
    and p.publish_mode in ('listed', 'unlisted')
$$;

revoke all on function public.public_position_by_slug(text) from public;
grant execute on function public.public_position_by_slug(text) to anon, authenticated;
