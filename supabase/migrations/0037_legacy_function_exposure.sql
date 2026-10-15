-- The four functions 0021's rule never got applied to.
--
-- 0014 and 0021 between them wrote down the complete rule for a new function in
-- `public`: it carries TWO default EXECUTE grants — the named ones Supabase's
-- default privileges hand to anon and authenticated, and Postgres's own implicit
-- grant to PUBLIC — and both have to go, or the function is on the anonymous
-- API at /rest/v1/rpc/<name>.
--
-- That rule was applied to everything from 0019 onwards and never applied
-- backwards. The four functions written before it still hold the full set:
--
--   set_updated_at()                        0001
--   snapshot_pipeline_to_position(uuid,uuid) 0002
--   first_stage_for_position(uuid)          0002
--   submit_application(jsonb)               0005, granted to anon on purpose but
--                                           never revoked from PUBLIC
--
-- None of them is exploitable as things stand, and this is not a claim that one
-- was. `set_updated_at` is a trigger function and errors on NEW when called
-- directly. The other two are SECURITY INVOKER, so an anonymous caller gets
-- anon's RLS view of `positions`, `pipelines` and `position_stages`, which is
-- nothing writable. The reason to close them anyway is the reason 0021 exists:
-- "harmless because a policy elsewhere is doing the work" is not a property
-- worth depending on, and a function reachable by anon is one RLS mistake away
-- from being the finding rather than the footnote.
--
-- `06_function_exposure.test.sql` now covers all four, including the PUBLIC
-- check on `submit_application` the suite previously omitted, so this cannot
-- silently regress.

-- ── A trigger function has no business on the API at all ─────────────────────
-- EXECUTE is checked when a trigger is created, not each time it fires, so
-- revoking this changes nothing about the six `updated_at` triggers that use it.
-- That is asserted rather than assumed, in 06.
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- ── The two internal helpers: off PUBLIC and off anon, kept for the app ──────
-- `snapshot_pipeline_to_position` is called by POST /api/positions and
-- PATCH /api/positions/[id] with a signed-in session, so `authenticated` keeps
-- it. `first_stage_for_position` is called from inside `submit_application`,
-- which is SECURITY DEFINER and therefore runs as the owner — the grant below is
-- for the internal app, not for the intake path.
revoke execute on function public.snapshot_pipeline_to_position(uuid, uuid) from public, anon;
revoke execute on function public.first_stage_for_position(uuid) from public, anon;

grant execute on function public.snapshot_pipeline_to_position(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.first_stage_for_position(uuid)
  to authenticated, service_role;

-- ── The public intake keeps its anon grant, and loses the PUBLIC one ─────────
-- `submit_application` IS the public intake (PUB-4): revoking it from anon would
-- stop the careers site accepting applications, and 06 asserts the grant in both
-- directions for exactly that reason. What it does not need is the implicit
-- PUBLIC grant, which is a second, unstated route to the same function.
--
-- `authenticated` is stated rather than dropped. The careers pages are open to
-- everybody including signed-in staff, and /api/apply uses the ordinary server
-- client, so an application submitted from a browser that happens to hold a
-- session runs as `authenticated`. Removing the grant would make the public form
-- fail for exactly the people most likely to be testing it.
revoke execute on function public.submit_application(jsonb) from public;
grant execute on function public.submit_application(jsonb) to anon, authenticated;
