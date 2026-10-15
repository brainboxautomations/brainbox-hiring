-- Pin the search_path on the two functions that still resolve names against the
-- caller's (advisor: function_search_path_mutable).
--
-- A function without `set search_path` resolves unqualified names against
-- whatever the caller's search_path happens to be at call time. Anyone able to
-- create objects in a schema that sits earlier on that path can shadow the table
-- or operator the function meant to use. For a SECURITY DEFINER function that is
-- a privilege-escalation primitive outright; for these two it is subtler but
-- still wrong:
--
--   * `set_updated_at` is a trigger fired inside whatever session happens to be
--     writing, so its behaviour is currently a property of the caller.
--   * `first_stage_for_position` decides where a new application lands, and is
--     called from `submit_application` on the anonymous intake path.
--
-- `handle_new_user`, `submit_application` and `snapshot_pipeline_to_position`
-- already pin theirs. ALTER FUNCTION ... SET only touches the function's
-- configuration, so triggers and dependent functions are unaffected.
alter function public.set_updated_at() set search_path = public;
alter function public.first_stage_for_position(uuid) set search_path = public;
