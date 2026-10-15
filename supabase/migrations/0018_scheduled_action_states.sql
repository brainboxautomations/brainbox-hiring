-- M6a — the automation engine, part 1 of 3: the state vocabulary.
--
-- `scheduled_action_status` was created in 0001 with three values —
-- pending / sent / cancelled — which describe a queue that is never worked by a
-- crashable worker. Three states cannot express the two things the engine has to
-- be able to say:
--
--   * "a worker has taken this row and is about to call the mail relay"
--     (without which two overlapping pg_cron runs both send the same email), and
--   * "this row will never fire, and here is why" — separately from "a human
--     cancelled it", because a failed relay call and a cancel-on-move are
--     completely different things to an operator reading the queue.
--
-- The full lifecycle, after 0019 installs the guard:
--
--   pending ─┬─► claimed ─┬─► sent       the action ran and the email went out
--            │            ├─► failed     it ran and something broke; see failure_reason
--            │            └─► skipped    a precondition no longer held (AUT-7)
--            └─► cancelled               the candidate left the stage (AUT-6)
--
-- sent, failed, skipped and cancelled are terminal and immutable. `claimed` is
-- deliberately NOT cancellable: once a worker owns a row, cancel-on-move must
-- not be able to pull it out from under an in-flight send, because an email that
-- has gone out cannot be recalled.
--
-- This migration adds nothing but enum values, and it is on its own for a
-- reason: Postgres refuses to *use* a new enum value in the same transaction
-- that added it, and every migration runs in one. 0019 is where the values are
-- first referenced.

alter type scheduled_action_status add value if not exists 'claimed' after 'pending';
alter type scheduled_action_status add value if not exists 'failed' after 'sent';
alter type scheduled_action_status add value if not exists 'skipped' after 'failed';
