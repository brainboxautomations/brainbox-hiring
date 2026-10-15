-- Orphaned-upload cleanup for the public apply flow (audit finding 3, part 2).
--
-- Every upload is meant to end up referenced by a `documents` row (and, for
-- question uploads, by an `answers.value->>'storagePath'`) when
-- `submit_application` runs. An object that is past a grace period and still
-- referenced by neither belongs to an application that was started and
-- abandoned — or to an upload that was never an application at all.
--
-- ── Why this reports rather than deletes ─────────────────────────────────────
--
-- Supabase installs a BEFORE DELETE trigger on `storage.objects`
-- (`storage.protect_delete`) that raises 42501 — "Direct deletion from storage
-- tables is not allowed. Use the Storage API instead." — unless the session sets
-- `storage.allow_delete_query = 'true'`.
--
-- That escape hatch exists, and this migration deliberately does not use it.
-- Deleting the row does not delete the bytes: the object stays in the backing
-- store, still billed, and now with no row through which the Storage API could
-- ever remove it. A SQL-only "cleanup" would turn a recoverable cost leak into
-- an unrecoverable one.
--
-- So the deletion itself CANNOT be closed at the database layer. What the
-- database can own is the decision — which objects are orphans — and that is
-- what ships here. The remaining half is an application-layer job holding the
-- service-role key that reads this function and calls
-- `storage.from(bucket).remove(paths)`, which drops the row and the bytes
-- together. That job needs a service-role credential (this app has none today)
-- and a scheduler; both are open decisions, and neither is invented here.
--
-- Grace period: 24 hours by default. Video answers upload browser → Storage
-- while the applicant is still filling in the form, so the window has to be
-- comfortably longer than a form session but short enough that an abandoned
-- 50 MB upload is not paid for indefinitely.
create or replace function public.orphaned_application_uploads(
  p_grace interval default '24 hours'
)
returns table (
  bucket_id text,
  name text,
  created_at timestamptz,
  size_bytes bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select o.bucket_id, o.name, o.created_at,
         nullif(o.metadata ->> 'size', '')::bigint
  from storage.objects o
  where o.bucket_id in ('resumes', 'videos')
    and (storage.foldername(o.name))[1] = 'applications'
    and o.created_at < now() - p_grace
    and not exists (
      select 1 from documents d where d.storage_path = o.name
    )
    -- Belt and braces: a file/video answer records its path in `answers.value`
    -- as well. If a documents row were ever missed, the answer still makes the
    -- object live, and a cleanup job must not delete it out from under a
    -- reviewer.
    and not exists (
      select 1 from answers a where a.value ->> 'storagePath' = o.name
    )
$$;

-- Maintenance only. This lists other applicants' object paths, so it is off both
-- the anonymous and the internal API surface; `service_role` is the intended
-- and only caller.
revoke all on function public.orphaned_application_uploads(interval) from public;
grant execute on function public.orphaned_application_uploads(interval) to service_role;
