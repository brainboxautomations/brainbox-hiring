-- Two unrelated, small cleanups bundled since both touch public-facing RPCs.
--
--   include_answers_on_profile   confirmed to have no purpose beyond hiding a
--                                  section on the candidate Experience tab;
--                                  product decision is to always show it, so
--                                  the toggle and its backing column go.
--
--   video_allow_retakes           already exists on `questions` (0024) and is
--                                  configurable in the questionnaire builder,
--                                  but was never added to the public RPC that
--                                  feeds the embedded careers apply form, so
--                                  candidates on that surface could never have
--                                  the setting enforced. The sibling RPC for
--                                  the standalone hosted-questionnaire-link
--                                  flow already carries it (0025).
alter table positions drop column if exists include_answers_on_profile;

-- `public_position_questions` returns a fixed column list, so — same as
-- `public_position_by_slug` in 0038 — Postgres requires the old signature
-- dropped before a narrower/wider `returns table` can replace it.
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
  video_allow_retakes boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.sort_order, q.type, q.prompt, q.help_text, q.required,
         q.options, q.video_max_duration, q.video_allow_retakes
  from questions q
  join positions p on p.application_questionnaire_id = q.questionnaire_template_id
  where p.id = p_position_id
    and p.status = 'open'
    and p.publish_mode in ('listed', 'unlisted')
  order by q.sort_order
$$;

revoke all on function public.public_position_questions(uuid) from public;
grant execute on function public.public_position_questions(uuid) to anon, authenticated;
