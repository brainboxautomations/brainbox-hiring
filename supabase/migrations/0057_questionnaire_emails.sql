-- Editable questionnaire emails.
--
-- The invite that carries a candidate's questionnaire link, and the reminder
-- that chases it, were fixed wording in the app. Now:
--
--  * Settings holds one default invite and one default reminder, seeded with
--    the wording the app used until now, so nothing changes until someone
--    edits it.
--  * Each questionnaire uses the default or its own custom wording, chosen
--    separately for the invite and the reminder.
--
-- The text uses the same {{group.field}} variables as email templates, plus
-- {{questionnaire.name}} and {{questionnaire.link}}. The app adds the link at
-- the end of any email whose text leaves it out, so a candidate always gets it.

-- ── The defaults ─────────────────────────────────────────────────────────────
create table questionnaire_email_settings (
  id boolean primary key default true,  -- single-row table, like email_timing_settings
  invite_subject text not null,
  invite_body text not null,
  reminder_subject text not null,
  reminder_body text not null,
  updated_at timestamptz not null default now(),
  constraint questionnaire_email_settings_singleton check (id),
  constraint questionnaire_email_settings_text_present check (
    btrim(invite_subject) <> '' and btrim(invite_body) <> ''
    and btrim(reminder_subject) <> '' and btrim(reminder_body) <> ''
  )
);

insert into questionnaire_email_settings
  (id, invite_subject, invite_body, reminder_subject, reminder_body)
values (
  true,
  '{{position.title}} — {{questionnaire.name}}',
  E'Hi {{candidate.first_name}},\n\nThe next step for the {{position.title}} role is **{{questionnaire.name}}**.\n\n{{questionnaire.link}}\n\nThanks,\n{{company.name}}',
  'Reminder: {{questionnaire.name}}',
  E'Hi {{candidate.first_name}},\n\nThis is an automated reminder regarding the **{{questionnaire.name}}** step for the {{position.title}} role.\n\nWe have not received your response yet.\n\n{{questionnaire.link}}\n\nThanks,\n{{company.name}}'
)
on conflict (id) do nothing;

create trigger questionnaire_email_settings_set_updated_at
  before update on questionnaire_email_settings
  for each row execute function set_updated_at();

alter table questionnaire_email_settings enable row level security;

create policy questionnaire_email_settings_authenticated_all on questionnaire_email_settings
  for all to authenticated using (true) with check (true);

revoke all on table public.questionnaire_email_settings from anon;
grant select, insert, update, delete on table public.questionnaire_email_settings to authenticated;
grant select, insert, update, delete on table public.questionnaire_email_settings to service_role;


-- ── Each questionnaire: default or custom ────────────────────────────────────
alter table questionnaire_templates
  add column invite_email_mode text not null default 'default',
  add column invite_subject text,
  add column invite_body text,
  add column reminder_email_mode text not null default 'default',
  add column reminder_subject text,
  add column reminder_body text,
  add constraint questionnaire_templates_invite_email_mode_check
    check (invite_email_mode in ('default', 'custom')),
  add constraint questionnaire_templates_reminder_email_mode_check
    check (reminder_email_mode in ('default', 'custom')),
  -- Custom wording is used as it stands, so it cannot be blank.
  add constraint questionnaire_templates_custom_invite_present check (
    invite_email_mode = 'default'
    or (btrim(coalesce(invite_subject, '')) <> '' and btrim(coalesce(invite_body, '')) <> '')
  ),
  add constraint questionnaire_templates_custom_reminder_present check (
    reminder_email_mode = 'default'
    or (btrim(coalesce(reminder_subject, '')) <> '' and btrim(coalesce(reminder_body, '')) <> '')
  );
