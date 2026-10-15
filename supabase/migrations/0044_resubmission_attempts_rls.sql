-- `application_resubmission_attempts` (0041) shipped without row level
-- security, which the database linter flags as `rls_disabled_in_public`:
-- anyone holding the project's anon key — it is in the careers site's
-- JavaScript, so effectively anyone — could read, insert, update or delete
-- every row over PostgREST.
--
-- 0041's own comment said it followed "the same [model] as applications,
-- documents, and every other internal table this function touches". That was
-- the mistake: 0003 enables RLS and adds an authenticated-only policy for each
-- of those tables. Its list simply predates this table, so this one inherited
-- the table grants `anon` holds everywhere without the RLS that makes those
-- grants harmless.
--
-- The rows record that someone tried to apply to a position twice — exactly
-- the signal 0036 took care not to expose publicly. Readable, they confirm
-- which applications exist; writable, the record could be faked or erased.
alter table application_resubmission_attempts enable row level security;

-- The shape 0003 gives every internal table: one shared access level, every
-- signed-in staff user sees everything. That covers the one reader, the
-- candidate profile route. The one writer, `submit_application`, is SECURITY
-- DEFINER and writes past RLS exactly as it does for applications and
-- documents, so public applications are unaffected.
create policy application_resubmission_attempts_authenticated_all
  on application_resubmission_attempts
  for all to authenticated
  using (true) with check (true);
