-- Closes the routes around the public intake checks.
--
-- APPLY ONLY AFTER the code that sends every public submission and upload
-- through the server is deployed. Applied earlier, the live apply form — which
-- until then calls these functions and uploads as `anon` — stops working.
--
-- The apply form and the hosted questionnaire are protected by a captcha and by
-- the rate limits in 0048, both checked in the server routes. Until now those
-- routes were not the only way in: the anon key ships in every visitor's
-- browser, and with it anyone could call `submit_application` and
-- `submit_questionnaire_response` directly through the REST API, or upload
-- files straight into Storage, without passing either check.
--
-- After this migration:
--   * both submit functions are callable only by the service role, which only
--     the server holds;
--   * anon can no longer insert into Storage at all. Uploads go through a
--     signed upload URL that the server issues after its own checks
--     (`/api/public-uploads`), and the server chooses the object path.
--
-- The read-only public functions (position by slug, questionnaire by token,
-- and so on) stay anon-callable: they serve the careers pages, which render
-- without going through these routes, and reading creates nothing.


-- ── The submit functions: server only ────────────────────────────────────────
--
-- 0037 granted `authenticated` as well, because the route used the visitor's
-- own client and a staff member browsing the careers site holds a session. The
-- route now uses the service role, so neither grant is needed.
revoke execute on function public.submit_application(jsonb) from public, anon, authenticated;
grant execute on function public.submit_application(jsonb) to service_role;

revoke execute on function public.submit_questionnaire_response(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_questionnaire_response(text, jsonb) to service_role;


-- ── Storage: no anonymous inserts ────────────────────────────────────────────
--
-- The two policies from 0010 let anon insert under
-- `applications/<open position>/…`. Signed upload URLs carry their own
-- authorisation and do not need them.
drop policy if exists "resumes anon apply upload" on storage.objects;
drop policy if exists "videos anon apply upload" on storage.objects;

-- The helper those policies used is no longer referenced by any policy. It is
-- taken off the public API rather than dropped, so this migration stays a pure
-- tightening that is easy to reverse.
revoke execute on function public.anon_may_upload_application_object(text)
  from public, anon, authenticated;
