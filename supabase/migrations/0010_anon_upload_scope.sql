-- Narrow the anonymous Storage upload surface (audit finding 3).
--
-- The policies from 0005 checked only `(storage.foldername(name))[1] =
-- 'applications'`. Anything under that prefix was writable by anyone holding the
-- bundled anon key, in any shape, for any position or none — 50 MB at a time,
-- with no application ever submitted. Unmetered storage on a public endpoint.
--
-- What a policy can actually do is bind the write to something the attacker
-- cannot invent: the object path must name a position that is currently
-- accepting applications, and it must match the exact shape both upload paths
-- produce. That removes "upload to nowhere" entirely and reduces the remaining
-- surface to "flood a live position's folder".
--
-- What it does NOT do is rate-limit. Postgres policies see one row at a time and
-- have no notion of a caller, a session or a budget — anon has no JWT to key on.
-- Volume control has to live in front of Storage (a WAF/edge rate limit, or
-- moving video uploads behind a server-issued signed upload URL). The bucket
-- size and MIME limits from 0007 remain the outer per-object gate.
--
-- Both upload paths must keep working:
--   * POST /api/apply uploads resumes and file answers server-side with the anon
--     key (there is no service-role key in this app);
--   * video answers upload browser → Storage directly.
-- Both build `applications/<positionId>/<uuid>-<sanitised filename>`, and the
-- sanitiser in both is the same: everything outside [A-Za-z0-9._-] becomes '_',
-- truncated to the last 120 characters. The regexes below are that contract.

-- Written in plpgsql, not as an inline policy expression, for one specific
-- reason: the position-folder segment has to be cast to uuid, and an AND chain
-- in a policy has no guaranteed evaluation order — the planner is free to
-- attempt the cast before the shape check and raise 22P02 on a junk path
-- instead of cleanly denying it. plpgsql gives ordered, short-circuiting checks.
--
-- SECURITY DEFINER because the position lookup must see through RLS: an unlisted
-- position is invisible to anon (migration 0009) but is still accepting
-- applications, so an invoker-rights check would reject every unlisted upload.
create or replace function public.anon_may_upload_application_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_folders text[] := storage.foldername(p_name);
  v_file text := storage.filename(p_name);
  v_uuid constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  -- Exactly two folder segments: `applications/<positionId>/`. Deeper nesting
  -- would let the folder be used as free-form scratch space.
  if array_length(v_folders, 1) is distinct from 2 then
    return false;
  end if;

  if v_folders[1] <> 'applications' then
    return false;
  end if;

  if v_folders[2] !~ ('^' || v_uuid || '$') then
    return false;
  end if;

  -- `<uuid>-<sanitised filename>`, matching storagePathFor() in both
  -- app/api/apply/route.ts and components/organisms/video-answer-field.tsx.
  if v_file !~ ('^' || v_uuid || '-[A-Za-z0-9._-]{1,120}$') then
    return false;
  end if;

  return exists (
    select 1
    from positions p
    where p.id = v_folders[2]::uuid
      and p.status = 'open'
      and p.publish_mode in ('listed', 'unlisted')
  );
end;
$$;

revoke all on function public.anon_may_upload_application_object(text) from public;
-- anon needs EXECUTE because a policy expression is evaluated as the querying
-- role. It answers only "would this write be allowed", which the INSERT itself
-- already reveals, so it adds no oracle that did not exist.
grant execute on function public.anon_may_upload_application_object(text) to anon, authenticated;

drop policy "resumes anon apply upload" on storage.objects;
drop policy "videos anon apply upload" on storage.objects;

create policy "resumes anon apply upload"
  on storage.objects for insert to anon
  with check (
    bucket_id = 'resumes'
    and public.anon_may_upload_application_object(name)
  );

create policy "videos anon apply upload"
  on storage.objects for insert to anon
  with check (
    bucket_id = 'videos'
    and public.anon_may_upload_application_object(name)
  );
