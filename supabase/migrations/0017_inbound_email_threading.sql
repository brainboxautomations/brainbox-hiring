-- M4b — inbound email, threading and the Inbox (EML-3, EML-4, EML-5).
--
-- Three things this migration has to make possible, none of which the 0001
-- schema supports:
--
--   1. Joining a reply to the message it answers. `messages.relay_message_id`
--      holds Resend's *internal* id ("a3580f68-…"), which is NOT the RFC 5322
--      Message-ID a reply quotes in In-Reply-To ("<0106019f…@…amazonses.com>").
--      Threading cannot join on it. `rfc_message_id` is the real one.
--   2. Surviving a webhook retry. Resend delivers `email.received` at least
--      once, so the handler must recognise a notification it has already
--      processed. `inbound_email_id` is that key, and it is unique.
--   3. Grouping messages into conversations. `thread_id` was a bare text column
--      with no producer and no table behind it.
--
-- Nothing has ever written `messages.thread_id` (M4a's dispatchMessage does not
-- set it), so it is dropped and re-added as a real foreign key rather than
-- migrated in place.

-- ── Threads ──────────────────────────────────────────────────────────────────
-- A thread belongs to a PERSON, not to an application (PRD §3.2). One candidate
-- who applies to three roles has one correspondence history, which is what a
-- recruiter opening the Inbox expects to see. Position context is retained two
-- ways: every message carries its own application_id, and the thread carries
-- the most recent one so the Inbox can scope by position.
--
-- `normalized_subject` is the fallback match key for a reply whose In-Reply-To
-- and References headers are absent or unusable — subject with any run of
-- Re:/Fwd:/Fw:/Aw:/Antw: prefixes stripped, whitespace collapsed, lowercased.
-- It is UNIQUE per person, which is what makes thread resolution idempotent:
-- two concurrent inserts cannot create two threads for the same conversation.
-- The accepted consequence is that two same-subject conversations with one
-- person merge into a single thread. That follows directly from threads being
-- person-level, and it is preferable to the alternative — a forged or reused
-- subject silently forking a candidate's history in two.
create table message_threads (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people (id) on delete cascade,
  position_id uuid references positions (id) on delete set null,
  application_id uuid references applications (id) on delete set null,
  subject text,
  normalized_subject text not null,
  last_message_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint message_threads_person_subject_key unique (person_id, normalized_subject)
);

-- The Inbox's three orderings: global newest-first, per-position newest-first,
-- and the per-person thread on the candidate profile.
create index message_threads_recent_idx on message_threads (last_message_at desc);
create index message_threads_position_recent_idx
  on message_threads (position_id, last_message_at desc);
create index message_threads_person_recent_idx
  on message_threads (person_id, last_message_at desc);

-- Unread is a property of the thread, not of a user. Phase 1 has a single
-- shared access level (no roles), so per-user read state would model a
-- distinction the product does not make. A thread is unread when an inbound
-- message has arrived since it was last opened.
comment on column message_threads.read_at is
  'When a human last opened this thread. Unread = last_inbound_at > read_at, or read_at is null with an inbound message present.';

-- ── Messages ─────────────────────────────────────────────────────────────────
alter table messages
  add column rfc_message_id text,
  add column inbound_email_id text,
  add column headers jsonb not null default '{}'::jsonb;

-- The RFC 5322 Message-ID, stored WITHOUT its angle brackets so that a reply's
-- In-Reply-To (which always carries them) is normalized to the same form before
-- the lookup. Unique: two messages cannot share a Message-ID, and if the relay
-- ever hands us a duplicate we would rather fail loudly than thread wrongly.
create unique index messages_rfc_message_id_key
  on messages (rfc_message_id)
  where rfc_message_id is not null;

-- The idempotency key for the inbound webhook. Resend retries on any non-2xx
-- and on a timeout, so the same email_id will arrive more than once. This index
-- is what makes the second delivery a no-op rather than a duplicate row — the
-- guarantee lives in the database, not in a handler's control flow.
create unique index messages_inbound_email_id_key
  on messages (inbound_email_id)
  where inbound_email_id is not null;

alter table messages drop column thread_id;
alter table messages
  add column thread_id uuid references message_threads (id) on delete cascade;

create index messages_thread_idx on messages (thread_id, created_at);

-- ── Inbound mail that matches no Person ──────────────────────────────────────
-- A reply can arrive from an address that is not in `people`: a candidate
-- replying from a second address, a colleague CC'd into the conversation, or
-- plain spam to a published relay address.
--
-- It is NOT dropped. Dropping it loses candidate mail, and a system that
-- silently discards email is worse than one that has none. It is also not
-- written to `messages`, because `messages.person_id` is `not null` and
-- relaxing that would put an unattributed row in the middle of every candidate
-- query. Auto-creating a Person is rejected too: PRD §2.2 excludes manually
-- adding candidates, and a spam run would fill the candidate database.
--
-- So it lands here, whole — headers, both bodies, attachment metadata — and is
-- listed in the Inbox under "Unmatched" where a human can read it.
create table unmatched_inbound_emails (
  id uuid primary key default gen_random_uuid(),
  relay_email_id text not null unique,
  rfc_message_id text,
  from_address text not null,
  to_addresses jsonb not null default '[]'::jsonb,
  subject text,
  body_html text,
  body_text text,
  headers jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  reason text not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint unmatched_inbound_reason_check
    check (reason in ('no_matching_person', 'sender_unreadable'))
);

create index unmatched_inbound_recent_idx on unmatched_inbound_emails (received_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Same model as every other internal table (0003): authenticated may do
-- everything, anon gets nothing at all. Candidate correspondence is the most
-- sensitive data in the system and the anon key ships in the browser bundle.
alter table message_threads enable row level security;
create policy message_threads_authenticated_all on message_threads
  for all to authenticated using (true) with check (true);

alter table unmatched_inbound_emails enable row level security;
create policy unmatched_inbound_emails_authenticated_all on unmatched_inbound_emails
  for all to authenticated using (true) with check (true);

-- ── Attachments ──────────────────────────────────────────────────────────────
-- Inbound attachments reuse the `message-attachments` bucket from 0016 under an
-- `inbound/` prefix, so there is one place email files live and one set of
-- policies to reason about. The per-file limit rises from 10 MB to 25 MB
-- because an inbound attachment size is the sender's choice, not ours — the
-- outbound API keeps enforcing its own 10 MB cap in application code.
update storage.buckets
  set file_size_limit = 26214400
  where id = 'message-attachments';
