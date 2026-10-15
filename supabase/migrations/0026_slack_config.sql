-- M7a — Slack notifications, part 1 of 3: the destination.
--
-- `slack_config` has existed since 0001 as an empty placeholder ("created here so
-- the schema is complete and checked in, and wired up in later sprints"). This is
-- that later sprint. Nothing in the application has ever read or written the
-- table — grep for `slack_config` across frontend/ before this migration returns
-- only the generated database types — so the columns are reshaped in place rather
-- than deprecated alongside new ones.
--
-- WHAT THE PRD ASKS FOR, AND NOTHING MORE
--
--   SLK-1  One event posts to Slack: an inbound candidate email.
--   SLK-2  One configured channel. No direct messages.
--   SLK-3  Receive only. No actions taken from Slack. Stage moves and outbound
--          email do not post.
--
-- The entity is `SlackConfig` — channel id, enabled. That is the whole surface,
-- and the shape below is deliberately not general: there is no per-event table,
-- no channel list, no subscription rows. When a second event is asked for, that
-- is the migration that should introduce the generality, with a real second case
-- to design against.


-- ── The columns ──────────────────────────────────────────────────────────────
--
-- Two renames and one addition.
--
-- `inbound_email_notifications` -> `enabled`. With exactly one event in the PRD,
-- a per-event flag and a master switch are the same boolean, and keeping the
-- longer name would imply a sibling column (`stage_move_notifications`) that
-- SLK-3 explicitly rules out.
--
-- `channel` -> `channel_name`, and a new `channel_id`. These are not the same
-- thing and conflating them is the mistake this split exists to prevent:
--
--   * `channel_id` is what Slack's API addresses. `chat.postMessage` takes a
--     channel ID (`C0123456789`) and that is the only value that reliably works
--     for a bot posting to a channel it has been invited to. It is what we send.
--   * `channel_name` is a human label so the settings screen can render
--     "#candidate-inbox" instead of "C0123456789". It is never sent to Slack and
--     nothing behaves differently when it is wrong. It exists so an operator can
--     recognise their own configuration a year later.
alter table slack_config rename column inbound_email_notifications to enabled;
alter table slack_config rename column channel to channel_name;

alter table slack_config add column channel_id text;
alter table slack_config add column created_at timestamptz not null default now();

-- The default flips to false. 0001 defaulted the flag to true, which on a
-- freshly restored database would mean "Slack notifications are on" for a
-- workspace that has no token and no channel. Off until an operator turns it on
-- is the same posture `automation_worker_config` (0020) takes, and for the same
-- reason.
alter table slack_config alter column enabled set default false;

-- Slack channel IDs are uppercase alphanumeric and begin with C (public), G
-- (private group) or D (DM). The check rejects the single most likely operator
-- mistake — pasting `#candidate-inbox` into the ID field — at write time, where
-- the settings screen can say so, rather than at 2am when a candidate replies and
-- `chat.postMessage` answers `channel_not_found`.
--
-- SLK-2 says no direct messages, so a `D…` id would be out of scope. It is
-- allowed by the shape check anyway: the constraint's job is to catch typos, and
-- a database check that also enforces product policy would have to be relaxed the
-- first time someone legitimately wants a private channel. The narrower rule
-- lives where it can explain itself — see the settings UI.
alter table slack_config
  add constraint slack_config_channel_id_shape_check
  check (channel_id is null or channel_id ~ '^[A-Z][A-Z0-9]{5,31}$');

-- Enabling with nowhere to post is not a state worth being able to represent. A
-- notifier that has to re-check "…but is there a channel?" after reading
-- `enabled = true` invites exactly one caller to forget.
alter table slack_config
  add constraint slack_config_enabled_needs_channel_check
  check (not enabled or channel_id is not null);


-- ── The row ──────────────────────────────────────────────────────────────────
--
-- 0001 created the table but never seeded it, so every read returned zero rows
-- and every UPDATE touched nothing. A singleton table with no row is a trap: the
-- settings screen would have had to UPSERT, and an UPSERT that races itself on a
-- boolean primary key is a needless failure mode. One row, always present,
-- updated in place.
insert into slack_config (id) values (true) on conflict (id) do nothing;

-- 0001 declared `updated_at` but attached no trigger, so the column would have
-- frozen at the insert time above.
create trigger slack_config_updated_at before update on slack_config
  for each row execute function set_updated_at();


-- ── Access ───────────────────────────────────────────────────────────────────
--
-- 0003 already granted `authenticated` full access to this table under the
-- shared-access-level model (USR-2: one access level, no roles), and that stays.
-- Nothing here is a secret: a channel id and an on/off switch are exactly the
-- kind of configuration every internal user is entitled to see and change.
--
-- The bot token is a different matter entirely and does not live in this table.
-- It has its own, in 0027.
revoke all on table slack_config from anon;
