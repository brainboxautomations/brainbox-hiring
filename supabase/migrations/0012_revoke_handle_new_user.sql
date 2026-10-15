-- Take handle_new_user() off the public API (advisor: SECURITY DEFINER function
-- exposed via PostgREST).
--
-- PostgREST publishes every function in `public` the caller may execute at
-- /rest/v1/rpc/<name>, and a new function inherits EXECUTE from PUBLIC, so
-- `handle_new_user` has been anon-callable since 0001. It is a trigger function:
-- a direct call fails on the missing NEW record rather than doing damage, which
-- is why this is low severity and not urgent. It is also a SECURITY DEFINER
-- function that inserts into `profiles`, sitting on the anonymous surface for no
-- reason at all — nothing calls it except the trigger.
--
-- EXECUTE is checked when a trigger is CREATED, not each time it fires, so
-- `on_auth_user_created` keeps provisioning profiles after this revoke.
-- 06_function_exposure.test.sql asserts that rather than trusting it.
--
-- `submit_application` is flagged by the same advisor rule and is deliberately
-- left alone: it is the public intake (PUB-4), it runs as its owner precisely so
-- anon needs no table grants, and it re-verifies that the position is open and
-- published before writing anything.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
