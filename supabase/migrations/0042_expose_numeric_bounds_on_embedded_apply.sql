-- Same gap as 0039's video_allow_retakes fix, for numeric_min/numeric_max
-- (added to `questions` by 0024): the hosted-questionnaire-link RPC
-- (public_questionnaire_questions_by_token, 0025) already exposes and
-- enforces these bounds, but the embedded careers apply form's RPC never
-- picked them up, so a numeric question's Min/Max was silently decorative
-- on the page candidates actually use to apply.
drop function if exists public.public_position_questions(uuid);

create function public.public_position_questions(p_position_id uuid)
returns table (
  id uuid,
  sort_order integer,
  type question_type,
  prompt text,
  help_text text,
  required boolean,
  options jsonb,
  video_max_duration integer,
  video_allow_retakes boolean,
  numeric_min numeric,
  numeric_max numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.sort_order, q.type, q.prompt, q.help_text, q.required,
         q.options, q.video_max_duration, q.video_allow_retakes,
         q.numeric_min, q.numeric_max
  from questions q
  join positions p on p.application_questionnaire_id = q.questionnaire_template_id
  where p.id = p_position_id
    and p.status = 'open'
    and p.publish_mode in ('listed', 'unlisted')
  order by q.sort_order
$$;

revoke all on function public.public_position_questions(uuid) from public;
grant execute on function public.public_position_questions(uuid) to anon, authenticated;
