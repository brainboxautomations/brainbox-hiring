-- M4a — a private bucket for outbound email attachments (EML-1).
--
-- Why bytes are stored rather than posted straight through to the provider:
-- a scheduled message is persisted now and sent later by the M6 worker. If the
-- attachment only existed in the request body, the worker would have nothing to
-- attach. `messages.attachments` therefore records object paths, and whoever
-- sends the message — the Route Handler for an immediate send, the worker for a
-- scheduled one — downloads the bytes at send time.
--
-- Private, like `resumes` and `videos`. `anon` gets nothing at all: unlike the
-- candidate buckets there is no public write path here, so no anon policy is
-- created and the default deny applies.
insert into storage.buckets (id, name, public, file_size_limit)
values ('message-attachments', 'message-attachments', false, 10485760)
on conflict (id) do nothing;

create policy "message attachments authenticated read"
  on storage.objects for select to authenticated
  using (bucket_id = 'message-attachments');

create policy "message attachments authenticated write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'message-attachments');

create policy "message attachments authenticated delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'message-attachments');
