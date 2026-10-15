-- Deleting abandoned candidate uploads (the half 0011 left open), with an
-- audit trail of every run and every file removed.
--
-- A candidate's resume, file answers and video answers upload to Storage the
-- moment they are picked, before the application exists. Anything picked and
-- never submitted — a candidate who walked away, a file swapped for another, a
-- submit that failed, a same-position resubmission (0036) — stays in the bucket
-- with nothing pointing at it, and is billed for ever. 0011 shipped the
-- function that finds those files and deliberately stopped short of deleting
-- them: the bytes can only be removed through the Storage API, with the service
-- role key, from a scheduled job — none of which existed then. All of it does
-- now (the automation worker, 0020, runs on exactly that footing), so this adds
-- the job.
--
-- The deletion itself happens in the app, at /api/workers/orphan-cleanup. The
-- database decides which files are orphans, keeps the audit trail, and rings
-- the doorbell once a day.


-- ── 1. The orphan report, extended ───────────────────────────────────────────
--
-- Two changes to 0011's function:
--
--  * Legacy answers. Before 0007, file and video answers stored the path as a
--    bare JSON string, which `value->>'storagePath'` cannot see. 0007 converted
--    those, but the read path still accepts the old shape, so a straggler would
--    have made a file in use look abandoned — and deletion cannot be undone.
--    The bare string is matched as well.
--  * The file's type, from Storage's own metadata, for the audit trail.
--
-- Adding a result column changes the return type, which CREATE OR REPLACE
-- cannot do, so the function is dropped and recreated. Its grants go with it
-- and are restored below exactly as 0011 and 0014 left them: service_role only.
drop function public.orphaned_application_uploads(interval);

create function public.orphaned_application_uploads(
  p_grace interval default '24 hours'
)
returns table (
  bucket_id text,
  name text,
  created_at timestamptz,
  size_bytes bigint,
  mime_type text
)
language sql
stable
security definer
set search_path = public
as $$
  select o.bucket_id, o.name, o.created_at,
         nullif(o.metadata ->> 'size', '')::bigint,
         nullif(o.metadata ->> 'mimetype', '')
  from storage.objects o
  where o.bucket_id in ('resumes', 'videos')
    and (storage.foldername(o.name))[1] = 'applications'
    and o.created_at < now() - p_grace
    and not exists (
      select 1 from documents d where d.storage_path = o.name
    )
    and not exists (
      select 1 from answers a
      where a.value ->> 'storagePath' = o.name
         or (jsonb_typeof(a.value) = 'string' and a.value #>> '{}' = o.name)
    )
$$;

-- It lists other applicants' object paths: a maintenance job's input, not part
-- of any API surface.
revoke all on function public.orphaned_application_uploads(interval) from public;
revoke all on function public.orphaned_application_uploads(interval) from anon;
revoke all on function public.orphaned_application_uploads(interval) from authenticated;
grant execute on function public.orphaned_application_uploads(interval) to service_role;


-- ── 2. The audit trail ───────────────────────────────────────────────────────
--
-- Storage has no recycle bin: a removed file is gone. So every run is recorded,
-- and every file it removes.
--
-- One row per run, including the nights that find nothing. Without that, a job
-- that silently stopped running would look exactly like one with nothing to
-- clean. `finished_at` stays null if a run dies part-way.
create table orphan_cleanup_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  grace interval not null,
  found integer not null default 0,
  removed integer not null default 0,
  failed integer not null default 0,
  -- Past the per-run cap; picked up on a later night.
  deferred integer not null default 0,
  bytes_freed bigint not null default 0,
  errors text[] not null default '{}'
);

create index orphan_cleanup_runs_started_at_idx on orphan_cleanup_runs (started_at desc);

-- One row per file removed, written only once Storage has confirmed the
-- removal, so it never lists a file that is still there.
--
-- What can be known is recorded. What cannot — who uploaded the file, or why
-- they never submitted — is not guessed at: an abandoned upload never became an
-- application, so the system never learned the candidate's name or email, and
-- nothing in the data tells "walked away" from "swapped the file" from "the
-- submit failed". `file_name` often carries the candidate's name all the same
-- (Ahmed_Khan_Resume.pdf), which is part of why this table is locked down.
create table deleted_application_uploads (
  id bigint generated always as identity primary key,
  run_id bigint references orphan_cleanup_runs (id) on delete set null,
  bucket_id text not null,
  storage_path text not null,
  -- From the path's folder. No foreign key: the audit must outlive a position
  -- that is later deleted.
  position_id uuid,
  file_name text,
  file_type text,
  size_bytes bigint,
  -- One reason today. The column exists so a later kind of deletion (a
  -- candidate's files after the candidate is deleted, say) is told apart from
  -- this one rather than mixed into it.
  reason text not null default 'abandoned_upload'
    constraint deleted_application_uploads_reason_check check (reason in ('abandoned_upload')),
  uploaded_at timestamptz,
  deleted_at timestamptz not null default now()
);

create index deleted_application_uploads_deleted_at_idx
  on deleted_application_uploads (deleted_at desc);
create index deleted_application_uploads_position_idx
  on deleted_application_uploads (position_id);

-- Written only by the worker's service-role client. RLS on with no policy, and
-- the default grants revoked, keeps both tables off the anon and signed-in API
-- surface. Read them from the SQL editor.
alter table orphan_cleanup_runs enable row level security;
revoke all on table orphan_cleanup_runs from anon;
revoke all on table orphan_cleanup_runs from authenticated;

alter table deleted_application_uploads enable row level security;
revoke all on table deleted_application_uploads from anon;
revoke all on table deleted_application_uploads from authenticated;


-- ── 3. The switch ────────────────────────────────────────────────────────────
--
-- Ships off. Review what would be deleted first:
--
--   select * from orphaned_application_uploads('7 days') order by created_at;
--
-- then turn it on:
--
--   update automation_worker_config set orphan_cleanup_enabled = true;
--
-- It rides on the automation worker's row because it uses the same endpoint
-- and the same shared secret; there is nothing new to configure.
alter table automation_worker_config
  add column orphan_cleanup_enabled boolean not null default false;


-- ── 4. The doorbell ──────────────────────────────────────────────────────────
--
-- Same shape as dispatch_due_scheduled_actions (0020): SECURITY DEFINER so the
-- cron job can read the secret, fire-and-forget through pg_net, and a null
-- return when there is nothing to do.
--
-- The cleanup URL is the worker's own URL with the last path segment swapped,
-- so the operator sets one endpoint for both jobs. If the stored URL is not the
-- worker's, it does not guess.
create or replace function dispatch_orphan_cleanup()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config automation_worker_config%rowtype;
  v_url text;
  v_request_id bigint;
begin
  select * into v_config from automation_worker_config where id;

  if not found
     or not v_config.enabled
     or not v_config.orphan_cleanup_enabled
     or coalesce(v_config.endpoint_url, '') = '' then
    return null;
  end if;

  if v_config.endpoint_url !~ '/api/workers/scheduled-actions/?$' then
    return null;
  end if;
  v_url := regexp_replace(
    v_config.endpoint_url,
    '/api/workers/scheduled-actions/?$',
    '/api/workers/orphan-cleanup'
  );

  select net.http_post(
    url := v_url,
    body := jsonb_build_object('source', 'pg_cron'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-worker-secret', coalesce(v_config.shared_secret, '')
    ),
    timeout_milliseconds := 60000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke execute on function public.dispatch_orphan_cleanup() from public;
revoke execute on function public.dispatch_orphan_cleanup() from anon;
revoke execute on function public.dispatch_orphan_cleanup() from authenticated;


-- ── 5. Once a day ────────────────────────────────────────────────────────────
--
-- 21:00 UTC is 02:00 in Pakistan: the quietest hour for the careers site. Daily
-- is plenty; the files it removes are already a week old.
do $$
begin
  perform cron.unschedule('brainbox-orphan-cleanup');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'brainbox-orphan-cleanup',
  '0 21 * * *',
  $job$select public.dispatch_orphan_cleanup()$job$
);
