-- Close the anonymous API surface that 0019 and 0020 opened.
--
-- 0014 wrote down half the rule: a new function in `public` is granted EXECUTE
-- directly to anon and authenticated by a Supabase default-privileges rule, so
-- `revoke ... from public` alone does not remove it. Both migrations revoked by
-- name accordingly.
--
-- The other half is Postgres's own default: **every** new function also carries
-- an implicit EXECUTE grant to PUBLIC, and anon inherits it. Revoking the named
-- grants therefore leaves the function callable anyway, and the security advisor
-- correctly reported `dispatch_due_scheduled_actions` as reachable at
-- /rest/v1/rpc/ by anon straight after 0020.
--
-- The complete rule, which is the one to follow for any future function here:
-- **revoke from PUBLIC as well as from anon.** Both, or the function is on the
-- public internet.
--
-- What was actually exposed, and how badly:
--
--   * `dispatch_due_scheduled_actions` is SECURITY DEFINER and issues an
--     outbound HTTP POST. The worker endpoint has its own shared secret, so no
--     email could have been sent this way, but an unauthenticated caller could
--     make the database originate network traffic on demand. That is the real
--     finding, and it is closed to everything but the cron job's own role.
--
--   * The rest are SECURITY INVOKER, so anon's (empty) RLS view of
--     `scheduled_actions` applied and every call would have touched zero rows.
--     Revoked anyway: "harmless because a policy elsewhere is doing the work" is
--     not a property worth depending on.
--
-- `authenticated` keeps EXECUTE on the engine's helpers, and that is deliberate
-- rather than an oversight. Phase 1 has one shared access level (0003): every
-- signed-in user already holds `for all using (true)` on `scheduled_actions` and
-- can write those rows directly. Withholding EXECUTE from the functions that
-- write them the correct way would remove no capability and only push callers
-- towards raw UPDATEs, which the status-transition trigger would then have to
-- catch. The boundary that carries weight in this codebase is anon versus
-- authenticated, and that one is now shut.

-- ── The doorbell: cron and the service role only ─────────────────────────────
revoke execute on function public.dispatch_due_scheduled_actions(timestamptz)
  from public, anon, authenticated;

-- ── Trigger functions: no business on the API at all ─────────────────────────
-- Calling one directly errors on NEW rather than doing damage, but the grant
-- buys nothing.
revoke execute on function public.guard_stage_action_target() from public, anon, authenticated;
revoke execute on function public.guard_scheduled_action_status() from public, anon, authenticated;
revoke execute on function public.apply_stage_automation() from public, anon, authenticated;
revoke execute on function public.cancel_pending_actions_for_deleted_stage_action()
  from public, anon, authenticated;

-- ── The engine's helpers: off PUBLIC and off anon, kept for authenticated ────
revoke execute on function public.claim_due_scheduled_actions(timestamptz, integer)
  from public, anon;
revoke execute on function
  public.complete_scheduled_action(uuid, scheduled_action_status, timestamptz, text, uuid)
  from public, anon;
revoke execute on function public.schedule_stage_actions(uuid, uuid, timestamptz)
  from public, anon;
revoke execute on function public.cancel_pending_stage_actions(uuid, uuid, timestamptz)
  from public, anon;
revoke execute on function public.record_first_stage_entry(uuid, uuid, timestamptz)
  from public, anon;
revoke execute on function public.position_stage_for_template_stage(uuid, uuid)
  from public, anon;

-- 0019 revoked these from anon before the PUBLIC grant was understood, which on
-- a fresh database leaves authenticated holding nothing here. State the grant
-- rather than relying on the default-privileges rule to have supplied it.
grant execute on function public.claim_due_scheduled_actions(timestamptz, integer)
  to authenticated, service_role;
grant execute on function
  public.complete_scheduled_action(uuid, scheduled_action_status, timestamptz, text, uuid)
  to authenticated, service_role;
grant execute on function public.schedule_stage_actions(uuid, uuid, timestamptz)
  to authenticated, service_role;
grant execute on function public.cancel_pending_stage_actions(uuid, uuid, timestamptz)
  to authenticated, service_role;
grant execute on function public.record_first_stage_entry(uuid, uuid, timestamptz)
  to authenticated, service_role;
grant execute on function public.position_stage_for_template_stage(uuid, uuid)
  to authenticated, service_role;

-- ── Tables and views ─────────────────────────────────────────────────────────
-- The stalled-work view is `security_invoker`, so anon already saw nothing
-- through it. Off the surface entirely is better than empty.
revoke all on table public.stalled_scheduled_actions from public, anon;

-- The ledger has no reason to be on the anonymous surface either. RLS already
-- denies anon every row; this removes the table grant that put it in front of
-- PostgREST in the first place.
revoke all on table public.application_stage_entries from anon;
