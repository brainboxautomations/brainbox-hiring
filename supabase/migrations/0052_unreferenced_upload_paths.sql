-- Uploaded files now live in Cloudflare R2, not Supabase Storage.
--
-- The nightly orphan clean-up used to find abandoned uploads in SQL by reading
-- storage.objects (`orphaned_application_uploads`, 0011/0045). R2 is not in the
-- database, so the worker now lists R2 itself, keeps the uploads older than the
-- grace period, and asks this function which of those paths nothing refers to.
-- A path counts as in use exactly as before: a `documents` row points at it,
-- or an answer does, in the current `{ storagePath }` shape or the pre-0007
-- bare string.
--
-- `orphaned_application_uploads` is left in place. Nothing calls it any more,
-- but its pgTAP coverage stays green until the Supabase buckets are emptied
-- and it is dropped with them.

create function public.unreferenced_upload_paths(p_paths text[])
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select p.path
  from unnest(p_paths) as p(path)
  where not exists (
      select 1 from documents d where d.storage_path = p.path
    )
    and not exists (
      select 1 from answers a
      where a.value ->> 'storagePath' = p.path
         or (jsonb_typeof(a.value) = 'string' and a.value #>> '{}' = p.path)
    )
$$;

-- It confirms which applicants' file paths exist: a maintenance job's input,
-- not part of any API surface.
revoke all on function public.unreferenced_upload_paths(text[]) from public;
revoke all on function public.unreferenced_upload_paths(text[]) from anon;
revoke all on function public.unreferenced_upload_paths(text[]) from authenticated;
grant execute on function public.unreferenced_upload_paths(text[]) to service_role;
