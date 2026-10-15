-- Row Level Security.
--
-- Access model (PRD): a single shared access level. Every authenticated internal
-- user can read and write all internal data — there are no roles. The public
-- (anon) surface is deliberately narrow: read published positions only. Public
-- application intake (Sprint 2) goes through a SECURITY DEFINER RPC rather than
-- direct anon writes, so anon never gets table-level insert/select on people.

-- Enable RLS + grant authenticated full access on every internal table.
do $$
declare
  t text;
  internal_tables text[] := array[
    'profiles', 'people', 'pipelines', 'pipeline_template_stages',
    'questionnaire_templates', 'questions', 'positions', 'position_stages',
    'applications', 'questionnaire_responses', 'answers', 'documents',
    'stage_actions', 'scheduled_actions', 'message_templates', 'messages',
    'notes', 'slack_config'
  ];
begin
  foreach t in array internal_tables loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy %I on %I for all to authenticated using (true) with check (true);',
      t || '_authenticated_all', t
    );
  end loop;
end;
$$;

-- Public careers site: anon may read positions that are open and publicly
-- published (listed OR unlisted-by-direct-link). Disabled/draft/closed are hidden.
create policy positions_public_read on positions
  for select to anon
  using (status = 'open' and publish_mode in ('listed', 'unlisted'));

-- Anon may read the questionnaire + questions attached to a publicly visible
-- position, so the embedded application form can render (Sprint 2). Scoped via
-- the owning position; nothing else in the library is exposed.
create policy questionnaire_templates_public_read on questionnaire_templates
  for select to anon
  using (
    exists (
      select 1 from positions p
      where p.application_questionnaire_id = questionnaire_templates.id
        and p.status = 'open'
        and p.publish_mode in ('listed', 'unlisted')
    )
  );

create policy questions_public_read on questions
  for select to anon
  using (
    exists (
      select 1 from positions p
      where p.application_questionnaire_id = questions.questionnaire_template_id
        and p.status = 'open'
        and p.publish_mode in ('listed', 'unlisted')
    )
  );
