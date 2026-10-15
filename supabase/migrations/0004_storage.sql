-- Storage buckets for candidate uploads.
-- Private buckets: files are read through signed URLs from the internal app.
-- Public application intake writes here in Sprint 2 via a scoped anon policy
-- added alongside the submit_application RPC.
insert into storage.buckets (id, name, public)
values
  ('resumes', 'resumes', false),
  ('videos', 'videos', false)
on conflict (id) do nothing;

-- Internal users (authenticated) can read/write both buckets.
create policy "resumes authenticated read"
  on storage.objects for select to authenticated
  using (bucket_id = 'resumes');

create policy "resumes authenticated write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'resumes');

create policy "videos authenticated read"
  on storage.objects for select to authenticated
  using (bucket_id = 'videos');

create policy "videos authenticated write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'videos');
