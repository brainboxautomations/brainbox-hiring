-- Brainbox ATS — core schema (Phase 1)
-- Single source of truth: the Phase 1 PRD, Section 4 (data model).
-- Sprints 1–2 exercise: profiles, people, pipelines, pipeline_template_stages,
-- positions, position_stages, questionnaire_templates, questions, applications,
-- questionnaire_responses, answers, documents. The remaining tables
-- (stage_actions, scheduled_actions, message_templates, messages, notes,
-- slack_config) are created here so the schema is complete and checked in, and
-- are wired up in later sprints.

create extension if not exists "citext";

-- ── Enums ────────────────────────────────────────────────────────────────────
create type position_status as enum ('draft', 'open', 'closed', 'archived');
create type publish_mode as enum ('listed', 'unlisted', 'disabled');
-- 'neutral' is present to match the design's holding stages (e.g. "Under Inquiry").
create type stage_type as enum ('active', 'success', 'terminal', 'neutral');
create type salary_period as enum ('year', 'month');
create type application_status as enum ('active', 'archived');
create type application_source as enum ('public_apply');
create type question_type as enum (
  'short_text', 'long_text', 'single_choice', 'multi_choice', 'dropdown',
  'numeric', 'video', 'file', 'date', 'yes_no'
);
create type questionnaire_context as enum ('application_embedded', 'stage_sent');
create type questionnaire_status as enum ('pending', 'completed');
create type stage_action_type as enum ('send_email', 'send_questionnaire', 'move_to_stage');
create type scheduled_action_status as enum ('pending', 'sent', 'cancelled');
create type message_direction as enum ('inbound', 'outbound');
create type document_kind as enum ('resume', 'video', 'other');

-- ── Helper: keep updated_at fresh ────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Profiles (internal users, one shared access level) ───────────────────────
-- Mirrors auth.users so we can show/select the sender name without exposing the
-- auth schema. No roles: every authenticated user is an equal internal user.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text not null,
  created_at timestamptz not null default now()
);

-- Auto-provision a profile row whenever a new auth user is created.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── People (candidate identity, keyed on email) ──────────────────────────────
create table people (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text,
  -- citext gives case-insensitive uniqueness so we never create a duplicate
  -- Person for "A@x.com" vs "a@x.com" (identity rule).
  email citext not null unique,
  phone text,
  links jsonb not null default '[]'::jsonb,
  custom_attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ── Pipelines (reusable, company-level templates) ────────────────────────────
create table pipelines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_template boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger pipelines_updated_at before update on pipelines
  for each row execute function set_updated_at();

create table pipeline_template_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references pipelines (id) on delete cascade,
  name text not null,
  sort_order integer not null,
  stage_type stage_type not null default 'active',
  created_at timestamptz not null default now()
);
create index pipeline_template_stages_pipeline_idx
  on pipeline_template_stages (pipeline_id, sort_order);

-- ── Questionnaire templates (library) ────────────────────────────────────────
create table questionnaire_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger questionnaire_templates_updated_at before update on questionnaire_templates
  for each row execute function set_updated_at();

create table questions (
  id uuid primary key default gen_random_uuid(),
  questionnaire_template_id uuid not null references questionnaire_templates (id) on delete cascade,
  sort_order integer not null,
  type question_type not null,
  prompt text not null,
  help_text text,
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb,          -- choice types: [{value,label}]
  video_max_duration integer,                          -- seconds, video type
  answer_routing jsonb not null default '[]'::jsonb,   -- [{option_value, target_stage_ref}]
  created_at timestamptz not null default now()
);
create index questions_template_idx on questions (questionnaire_template_id, sort_order);

-- ── Positions (jobs) ─────────────────────────────────────────────────────────
create table positions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  department text,
  internal_id text,
  locations jsonb not null default '[]'::jsonb,         -- [{country, detail}]
  remote_flag boolean not null default false,
  position_type text,
  category text,
  education_level text,
  experience_level text,
  salary_from numeric,
  salary_to numeric,
  salary_period salary_period,
  salary_currency text,
  description text,                                      -- rich text (HTML/markdown)
  status position_status not null default 'draft',
  publish_mode publish_mode not null default 'listed',
  -- per-field required/optional/disabled for the public application form
  application_form_config jsonb not null default '{}'::jsonb,
  application_questionnaire_id uuid references questionnaire_templates (id) on delete set null,
  include_answers_on_profile boolean not null default true,
  apply_email_address text unique,
  assigned_pipeline_id uuid references pipelines (id) on delete set null,
  email_sender_name text,
  hiring_team jsonb not null default '[]'::jsonb,        -- labels only, no permissions
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger positions_updated_at before update on positions
  for each row execute function set_updated_at();
create index positions_status_idx on positions (status);
create index positions_publish_idx on positions (publish_mode, status);

-- ── Position stages (per-position snapshot of a pipeline's stages) ───────────
-- Created when a pipeline is assigned. Stage actions attach here so edits are
-- position-scoped. Frozen (no reorder) once the position goes live.
create table position_stages (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references positions (id) on delete cascade,
  source_template_stage_id uuid references pipeline_template_stages (id) on delete set null,
  name text not null,
  sort_order integer not null,
  stage_type stage_type not null default 'active',
  created_at timestamptz not null default now()
);
create index position_stages_position_idx on position_stages (position_id, sort_order);

-- ── Applications (one person's candidacy for one position — the board card) ──
create table applications (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people (id) on delete cascade,
  position_id uuid not null references positions (id) on delete cascade,
  current_stage_id uuid references position_stages (id) on delete set null,
  status application_status not null default 'active',
  starred boolean not null default false,
  seen boolean not null default false,
  source application_source not null default 'public_apply',
  application_form_answers jsonb not null default '{}'::jsonb,
  applied_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- one candidacy per person per position (identity rule)
  unique (person_id, position_id)
);
create trigger applications_updated_at before update on applications
  for each row execute function set_updated_at();
create index applications_position_idx on applications (position_id);
create index applications_stage_idx on applications (current_stage_id);
create index applications_person_idx on applications (person_id);

-- ── Questionnaire responses + answers (per application) ──────────────────────
create table questionnaire_responses (
  id uuid primary key default gen_random_uuid(),
  questionnaire_template_id uuid not null references questionnaire_templates (id) on delete cascade,
  application_id uuid not null references applications (id) on delete cascade,
  context questionnaire_context not null,
  status questionnaire_status not null default 'pending',
  sent_at timestamptz,
  completed_at timestamptz,
  on_completion_move_to_stage_id uuid references position_stages (id) on delete set null,
  created_at timestamptz not null default now()
);
create index questionnaire_responses_application_idx on questionnaire_responses (application_id);

create table answers (
  id uuid primary key default gen_random_uuid(),
  questionnaire_response_id uuid not null references questionnaire_responses (id) on delete cascade,
  question_id uuid not null references questions (id) on delete cascade,
  value jsonb,                                           -- text | number | string[] | file path
  created_at timestamptz not null default now()
);
create index answers_response_idx on answers (questionnaire_response_id);

-- ── Documents (resume/video/other on Storage, linked to a Person) ────────────
create table documents (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people (id) on delete cascade,
  application_id uuid references applications (id) on delete set null,
  kind document_kind not null default 'other',
  storage_path text not null,
  filename text,
  mime_type text,
  created_at timestamptz not null default now()
);
create index documents_person_idx on documents (person_id);

-- ── Stage actions (forward-declared; wired in Sprint 5) ──────────────────────
create table stage_actions (
  id uuid primary key default gen_random_uuid(),
  position_stage_id uuid not null references position_stages (id) on delete cascade,
  type stage_action_type not null,
  enabled boolean not null default true,
  delay_minutes integer not null default 0,
  sort_order integer not null default 0,
  message_template_id uuid,                              -- send_email
  questionnaire_template_id uuid references questionnaire_templates (id) on delete set null, -- send_questionnaire
  reminder_config jsonb,                                 -- send_questionnaire
  target_position_stage_id uuid references position_stages (id) on delete set null,          -- move_to_stage
  created_at timestamptz not null default now()
);
create index stage_actions_stage_idx on stage_actions (position_stage_id, sort_order);

-- ── Scheduled actions queue (forward-declared; wired in Sprint 5) ────────────
create table scheduled_actions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  stage_action_id uuid references stage_actions (id) on delete set null,
  origin_stage_id uuid references position_stages (id) on delete set null,
  scheduled_for timestamptz not null,
  status scheduled_action_status not null default 'pending',
  created_at timestamptz not null default now()
);
create index scheduled_actions_due_idx on scheduled_actions (status, scheduled_for);

-- ── Messaging + notes + config (forward-declared; wired in Sprints 4/6) ──────
create table message_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text,
  body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger message_templates_updated_at before update on message_templates
  for each row execute function set_updated_at();

-- send_email actions reference a template; add the FK now that the table exists.
alter table stage_actions
  add constraint stage_actions_message_template_fk
  foreign key (message_template_id) references message_templates (id) on delete set null;

create table messages (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people (id) on delete cascade,
  application_id uuid references applications (id) on delete set null,
  direction message_direction not null,
  from_address text,
  to_address text,
  cc jsonb not null default '[]'::jsonb,
  bcc jsonb not null default '[]'::jsonb,
  subject text,
  body text,
  attachments jsonb not null default '[]'::jsonb,
  sender_user_id uuid references profiles (id) on delete set null,
  status text,
  thread_id text,
  relay_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index messages_person_idx on messages (person_id, created_at);

create table notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  author_user_id uuid references profiles (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index notes_application_idx on notes (application_id, created_at);

create table slack_config (
  id boolean primary key default true,                  -- single-row table
  channel text,
  inbound_email_notifications boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint slack_config_singleton check (id)
);
