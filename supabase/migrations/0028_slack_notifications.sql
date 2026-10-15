-- M7a — Slack notifications, part 3 of 3: the ledger.
--
-- WHY THERE IS A LEDGER AT ALL
--
-- The notifier cannot throw. An inbound candidate email must be recorded and the
-- webhook must return success to Resend even when Slack is unreachable, because
-- a non-2xx makes Resend retry and a retried inbound email is either lost mail or
-- duplicated mail. So every Slack failure is swallowed by construction.
--
-- Swallowed failures that leave no trace are how a subsystem dies silently: the
-- token expires, nobody is told, and six weeks later someone asks why Slack went
-- quiet. This table is the answer to that question. One row per attempt, with the
-- outcome and the reason, so "why did this candidate reply not appear in Slack?"
-- is a query rather than an archaeology exercise.
--
-- WHY NOT `scheduled_actions`
--
-- The obvious alternative was to enqueue the notification as a
-- `scheduled_actions` row and let the M6a worker deliver it. It was rejected for
-- three reasons, written up in full in docs/architecture.md:
--
--   1. `scheduled_actions.application_id` is NOT NULL. An inbound email from a
--      person with no application is an ordinary case — `contextFor` in
--      `_receive.ts` returns null application and null position, and the message
--      row itself allows both. Those queue rows could not exist without relaxing
--      a core invariant of the automation engine for a feature that does not need
--      it.
--
--   2. AUT-6's `cancel_pending_stage_actions` cancels every pending row for an
--      application whose origin stage the candidate has left. A queued Slack
--      notification would be collateral: move the candidate a minute after they
--      reply and the notification is cancelled, for reasons that have nothing to
--      do with Slack.
--
--   3. The queue has no retries — docs/architecture.md says so explicitly — so
--      routing through it would buy deferral and a status column, and this table
--      supplies the status column directly.
--
-- Delivery is therefore inline in the webhook: awaited, time-boxed, unable to
-- throw, and recorded here whatever happens.


-- ── The outcomes ─────────────────────────────────────────────────────────────
--
-- 'skipped' is not a failure and is the common case on a workspace that has
-- never configured Slack. Keeping it distinct from 'failed' is what stops the
-- ledger reading as a wall of errors for an operator who simply does not use the
-- integration.
create type slack_notification_status as enum ('delivered', 'failed', 'skipped');

create table slack_notifications (
  id uuid primary key default gen_random_uuid(),

  -- The inbound message this was about. ON DELETE CASCADE because the ledger is
  -- an annotation on the message, not an independent record: if the message is
  -- gone there is nothing left for the row to explain.
  message_id uuid not null references messages(id) on delete cascade,

  -- Where it went. Denormalised from `slack_config` on purpose — the channel can
  -- be changed later, and a ledger that silently rewrote history whenever
  -- somebody repointed the integration would be useless for the one question it
  -- exists to answer. Null when the outcome is 'skipped' with no channel set.
  channel_id text,

  status slack_notification_status not null,

  -- Why, in one line, for anything that is not 'delivered'. Written by the
  -- notifier and shown to nobody automatically; this is a debugging surface.
  detail text,

  -- Slack's own message timestamp (`ts`), which doubles as its message id.
  -- Present only on 'delivered'. Kept because it is the only handle that lets an
  -- operator find the exact Slack message a row refers to.
  slack_message_ts text,

  created_at timestamptz not null default now(),

  constraint slack_notifications_detail_check
    check (status = 'delivered' or detail is not null),
  constraint slack_notifications_ts_check
    check (status <> 'delivered' or slack_message_ts is not null)
);

-- One attempt per message, enforced rather than assumed.
--
-- `_receive.ts` already refuses to record the same inbound email twice
-- (`alreadyRecorded`), so a duplicate webhook delivery never reaches the
-- notifier. This index is the second lock on the same door: if that check is ever
-- weakened, a candidate gets one Slack message instead of five, and the insert
-- fails where a test can see it rather than in the channel.
create unique index slack_notifications_message_id_idx on slack_notifications (message_id);

-- The debugging query is "what happened recently", newest first.
create index slack_notifications_created_at_idx on slack_notifications (created_at desc);


-- ── Access ───────────────────────────────────────────────────────────────────
--
-- Readable by `authenticated` under the shared access level, like every other
-- internal table. It holds no secret: a channel id, a status and an error
-- string. The token never appears here, and the notifier is written so that no
-- error message it stores is derived from the token.
--
-- Writable only by the service role, because the only writer is the webhook. This
-- is narrower than the 0003 default (`for all using (true)`) and deliberately so:
-- an audit trail that its subjects can rewrite is not an audit trail. There is no
-- product feature that needs a signed-in user to edit this.
alter table slack_notifications enable row level security;

create policy slack_notifications_authenticated_read on slack_notifications
  for select to authenticated
  using (true);

revoke all on table slack_notifications from anon;
