-- M4a — outbound email: send status and scheduled send.
--
-- `messages` has existed since 0001 but only ever described a message that had
-- already happened. Scheduled send (EML-1) needs a row that exists BEFORE the
-- provider is called, so the send state has to be modelled explicitly.
--
-- Lifecycle of an outbound row:
--   scheduled → sent            (the M6 worker picks it up at scheduled_for)
--   scheduled → failed          (the provider rejected it; failure_reason says why)
--   sent                        (an immediate send; scheduled_for stays null)
--
-- M6 owns the worker. The seam it consumes is deliberately narrow: every row
-- with direction = 'outbound', status = 'scheduled' and scheduled_for <= now()
-- is due. The partial index below is exactly that predicate, so the queue scan
-- stays cheap however large the message history grows.

alter table messages
  add column scheduled_for timestamptz,
  add column failure_reason text;

-- Constrain the vocabulary. `status` was a free-text column with no producer, so
-- there is nothing to migrate. 'received' is reserved for M4b's inbound webhook
-- so that half does not have to alter the constraint to insert its first row.
alter table messages
  add constraint messages_status_check
  check (status is null or status in ('scheduled', 'sent', 'failed', 'received'));

-- A scheduled message must say when, and only a scheduled message may.
alter table messages
  add constraint messages_scheduled_for_matches_status
  check (
    (status = 'scheduled' and scheduled_for is not null)
    or (status is distinct from 'scheduled' and scheduled_for is null)
  );

-- The M6 worker's pickup query. Partial, so it indexes only the pending queue.
create index messages_due_outbound_idx
  on messages (scheduled_for)
  where direction = 'outbound' and status = 'scheduled';

-- The Inbox and the profile thread (M4b) both read newest-first per person; the
-- 0001 index is ascending on (person_id, created_at), which cannot serve that
-- ordering without a sort. Cheap to add now, and M4b needs it.
create index messages_person_recent_idx on messages (person_id, created_at desc);
