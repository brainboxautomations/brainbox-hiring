-- L4 — the anonymous surface on storage.objects.
--
-- Signed-out visitors used to upload as `anon` under a policy that admitted
-- `applications/<open position>/<uuid>-<filename>` (0010, narrowed after audit
-- finding 3: unmetered uploads on a public endpoint). Since 0049 anon cannot
-- insert at all. The apply form and the hosted questionnaire ask the server
-- for a one-time signed upload URL (/api/public-uploads), which checks the form
-- is open and the upload rate limit and chooses the path; a signed upload needs
-- no policy, so there is no anonymous route around those checks.
--
-- These tests pin that anon can neither insert, read, change nor delete
-- objects, and that orphaned uploads stay identifiable for the clean-up job.
--
-- The bucket-level size and MIME limits from migration 0007 remain the outer
-- gate on signed uploads too; they are enforced by the Storage API before a row
-- reaches this table.
begin;

create schema if not exists tap;

-- The helper below is invoked while the role is switched to anon, so anon needs
-- to reach the schema. Granted inside the transaction and rolled back with it.
grant usage on schema tap to anon;

-- Attempt an insert and report whether the policy allowed it. Only the RLS
-- violation (42501) is swallowed; any other error is a real failure and must
-- surface rather than be reported as a clean denial.
create function tap.anon_upload_allowed(p_bucket text, p_name text)
returns boolean
language plpgsql
as $fn$
begin
  insert into storage.objects (bucket_id, name) values (p_bucket, p_name);
  return true;
exception
  when insufficient_privilege then
    return false;
end;
$fn$;

-- Attempt a delete and report whether anything went. Two different mechanisms
-- can stop it and the caller cares about neither: RLS filters the row out and
-- reports zero rows, and Supabase's own `storage.protect_delete()` statement
-- trigger raises 42501 whatever the policies say. Both are a refusal.
create function tap.anon_delete_allowed(p_name text)
returns boolean
language plpgsql
as $fn$
declare
  v_deleted integer;
begin
  delete from storage.objects where name = p_name;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
exception
  when insufficient_privilege then
    return false;
end;
$fn$;

-- Since 0049 anon cannot insert into Storage at all. The apply form and the
-- hosted questionnaire ask the server for a one-time signed upload URL
-- (/api/public-uploads), which checks the form is open and the rate limit and
-- picks the path; signed uploads need no policy. Every attempt below must be
-- refused, including the ones the old policy allowed.
create function tap.test_anon_cannot_upload_anything()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_open_id uuid;
  v_unlisted_id uuid;
  v_object text := gen_random_uuid()::text || '-cv.pdf';
  v_open_ok boolean;
  v_unlisted_ok boolean;
  v_video_ok boolean;
  v_unknown_ok boolean;
  v_other_prefix_ok boolean;
  v_insert_policies int;
begin
  insert into positions (title, slug, status, publish_mode)
  values ('pgTAP listed', 'pgtap-listed-' || v_seed, 'open', 'listed')
  returning id into v_open_id;

  insert into positions (title, slug, status, publish_mode)
  values ('pgTAP unlisted', 'pgtap-unlisted-' || v_seed, 'open', 'unlisted')
  returning id into v_unlisted_id;

  set local role anon;
  v_open_ok         := tap.anon_upload_allowed('resumes', 'applications/' || v_open_id || '/' || v_object);
  v_unlisted_ok     := tap.anon_upload_allowed('resumes', 'applications/' || v_unlisted_id || '/' || v_object);
  v_video_ok        := tap.anon_upload_allowed('videos',  'applications/' || v_open_id || '/' || gen_random_uuid()::text || '-clip.mp4');
  v_unknown_ok      := tap.anon_upload_allowed('resumes', 'applications/' || gen_random_uuid()::text || '/' || v_object);
  v_other_prefix_ok := tap.anon_upload_allowed('resumes', 'internal/' || v_open_id || '/' || v_object);
  reset role;

  select count(*)::int into v_insert_policies
    from pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and cmd in ('INSERT', 'ALL')
     and (roles && array['anon', 'public']::name[]);

  return next ok(not v_open_ok, 'anon cannot upload a resume directly, even into an open position folder');
  return next ok(not v_unlisted_ok, 'nor into an unlisted position folder');
  return next ok(not v_video_ok, 'nor a video answer into the videos bucket');
  return next ok(not v_unknown_ok, 'nor into a folder that names no real position');
  return next ok(not v_other_prefix_ok, 'nor outside the applications/ prefix');
  -- Behaviour alone could miss a policy added back "for convenience"; the
  -- policy set is what the Storage API obeys.
  return next is(
    v_insert_policies, 0,
    'no policy grants anon INSERT on storage.objects — uploads go through signed URLs (0049)'
  );
end;
$fn$;

create function tap.test_anon_cannot_read_change_or_delete_stored_objects()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_open_id uuid;
  v_name text;
  v_visible int;
  v_updated int;
  v_delete_ok boolean;
  v_survives int;
  v_delete_policies int;
begin
  insert into positions (title, slug, status, publish_mode)
  values ('pgTAP listed', 'pgtap-listed-' || v_seed, 'open', 'listed')
  returning id into v_open_id;

  v_name := 'applications/' || v_open_id || '/' || gen_random_uuid()::text || '-cv.pdf';
  insert into storage.objects (bucket_id, name) values ('resumes', v_name);

  set local role anon;
  select count(*)::int into v_visible from storage.objects where name = v_name;
  update storage.objects set metadata = '{"tampered":true}'::jsonb where name = v_name;
  get diagnostics v_updated = row_count;
  v_delete_ok := tap.anon_delete_allowed(v_name);
  reset role;

  select count(*)::int into v_survives from storage.objects where name = v_name;

  select count(*)::int into v_delete_policies
    from pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and cmd in ('DELETE', 'ALL')
     -- `to public` reaches anon just as surely as `to anon` does, which is the
     -- same trap 0021 had to clean up on the function grants.
     and (roles && array['anon', 'public']::name[]);

  -- No anon SELECT policy: internal reads go through signed URLs minted by the
  -- authenticated app, so an applicant can never enumerate another applicant's CV.
  return next is(v_visible, 0, 'anon cannot read back any stored object, including its own upload');
  -- No anon UPDATE policy, so it is a silent no-op rather than an error.
  return next is(v_updated, 0, 'anon cannot modify a stored object once written');

  -- The name of this test promised a delete and never attempted one. It does
  -- now, and the object is checked afterwards rather than the row count trusted.
  return next ok(not v_delete_ok, 'anon cannot delete a stored object either');
  return next is(v_survives, 1, 'and the object is still there afterwards');

  -- Behaviour alone would not catch the regression this is really guarding
  -- against. `storage.protect_delete()` refuses every direct SQL delete whoever
  -- issues it, so adding a DELETE policy for anon — "let an applicant remove the
  -- CV they just uploaded" is a reasonable-sounding request — would leave the
  -- assertions above green while the Storage API happily honoured it. The policy
  -- set is the thing to assert.
  return next is(
    v_delete_policies, 0,
    'no policy grants anon DELETE on storage.objects, which is what the Storage API would obey'
  );
end;
$fn$;

create function tap.test_orphaned_uploads_are_identifiable_for_cleanup()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_position_id uuid;
  v_person_id uuid;
  v_app_id uuid;
  v_stale_orphan text;
  v_fresh_orphan text;
  v_linked text;
  v_stale_listed int;
  v_fresh_listed int;
  v_linked_listed int;
begin
  return next has_function(
    'public'::name, 'orphaned_application_uploads'::name, array['interval']::name[],
    'orphaned_application_uploads(interval) exists'
  );

  insert into positions (title, slug, status, publish_mode)
  values ('pgTAP listed', 'pgtap-listed-' || v_seed, 'open', 'listed')
  returning id into v_position_id;

  insert into people (first_name, email)
  values ('pgTAP', 'pgtap-' || v_seed || '@example.test')
  returning id into v_person_id;

  insert into applications (person_id, position_id)
  values (v_person_id, v_position_id)
  returning id into v_app_id;

  v_stale_orphan := 'applications/' || v_position_id || '/' || gen_random_uuid()::text || '-abandoned.pdf';
  v_fresh_orphan := 'applications/' || v_position_id || '/' || gen_random_uuid()::text || '-in-progress.pdf';
  v_linked       := 'applications/' || v_position_id || '/' || gen_random_uuid()::text || '-submitted.pdf';

  insert into storage.objects (bucket_id, name, created_at) values
    ('resumes', v_stale_orphan, now() - interval '3 days'),
    ('resumes', v_fresh_orphan, now()),
    ('resumes', v_linked, now() - interval '3 days');

  insert into documents (person_id, application_id, kind, storage_path)
  values (v_person_id, v_app_id, 'resume', v_linked);

  select count(*)::int into v_stale_listed
    from orphaned_application_uploads('24 hours'::interval) where name = v_stale_orphan;
  select count(*)::int into v_fresh_listed
    from orphaned_application_uploads('24 hours'::interval) where name = v_fresh_orphan;
  select count(*)::int into v_linked_listed
    from orphaned_application_uploads('24 hours'::interval) where name = v_linked;

  return next is(v_stale_listed, 1, 'an upload past the grace period with no documents row is reported as an orphan');
  return next is(v_fresh_listed, 0, 'an upload still inside the grace period is left alone — an applicant may be mid-form');
  return next is(v_linked_listed, 0, 'an upload linked to a documents row is never reported, however old');
end;
$fn$;

create function tap.test_orphan_report_is_not_on_the_public_api()
returns setof text
language plpgsql
as $fn$
begin
  return next function_privs_are(
    'public'::name, 'orphaned_application_uploads'::name, array['interval']::name[],
    'anon'::name, array[]::name[],
    'anon cannot call the orphan report — it lists other applicants'' object paths'
  );

  return next function_privs_are(
    'public'::name, 'orphaned_application_uploads'::name, array['interval']::name[],
    'authenticated'::name, array[]::name[],
    'the orphan report is a maintenance job, not part of the internal app surface'
  );
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
