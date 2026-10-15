-- M7a — Slack notifications, part 2 of 3: the bot token.
--
-- THE PROBLEM THIS MIGRATION SOLVES
--
-- Posting to Slack needs a bot token (`xoxb-…`). A bot token is a bearer
-- credential for the whole workspace: whoever holds it can post as the app to
-- every channel the app is in, and read whatever its scopes allow. It is in the
-- same class as `automation_worker_config.shared_secret` (0020), and it gets the
-- same treatment.
--
-- The obvious place to put it is an environment variable, and that was
-- considered. It loses to a table for one reason: the settings screen has to be
-- able to change it. An operator who rotates their Slack token should not need a
-- redeploy, and telling them "edit .env and restart" is how a token stays
-- unrotated for a year. The channel is already user-editable configuration
-- (0026); the token belongs beside it in the same admin surface.
--
-- WHAT KEEPS IT SAFE
--
--   1. Its own table, not a column on `slack_config`. `slack_config` is readable
--      by `authenticated` (0003), and it must stay that way — the settings screen
--      renders the channel. A secret column on a readable table is one forgotten
--      `select *` away from the browser. Separating the tables makes the
--      dangerous read impossible rather than merely discouraged.
--
--   2. RLS on with no policy at all. That denies every role that does not bypass
--      RLS, which is everything except the service role and the migration owner.
--      There is no policy to accidentally widen.
--
--   3. Table grants revoked from anon and authenticated, so the table is off the
--      PostgREST surface entirely rather than present-but-empty.
--
--   4. Three functions, and only three, as the entire interface. Write-only in,
--      a boolean out, and one service-role-only reader. There is deliberately no
--      function that returns the token to a signed-in user — not masked, not the
--      last four characters, not "for confirmation". A partially revealed secret
--      is a revealed secret in the only way that matters, and a UI that shows
--      `xoxb-••••1234` teaches operators that the app will show them the token,
--      which is precisely the habit that makes the next leak possible.
--
-- 06_function_exposure.test.sql asserts every grant below.


-- ── The table ────────────────────────────────────────────────────────────────
--
-- `bot_token_set_at` is a separate column from `updated_at` on purpose. The
-- settings screen has to answer "is a token configured, and when was it set?"
-- without reading the token, and `updated_at` would move for any change to the
-- row, which would misreport a rotation that never happened.
create table slack_credentials (
  id boolean primary key default true,
  bot_token text,
  bot_token_set_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint slack_credentials_singleton check (id),
  -- A token and its set-at timestamp travel together or not at all, so
  -- `slack_bot_token_state()` cannot report "configured" with nothing to show
  -- for it, or a rotation date for a token that was cleared.
  constraint slack_credentials_token_columns_check
    check (num_nonnulls(bot_token, bot_token_set_at) in (0, 2))
);

insert into slack_credentials (id) values (true);

create trigger slack_credentials_updated_at before update on slack_credentials
  for each row execute function set_updated_at();

-- Points 2 and 3 above.
alter table slack_credentials enable row level security;
revoke all on table slack_credentials from anon;
revoke all on table slack_credentials from authenticated;


-- ── Writing the token ────────────────────────────────────────────────────────
--
-- SECURITY DEFINER because `authenticated` cannot touch the table by design, and
-- this is the sanctioned way in. It takes the token and returns whether it was
-- stored — never the token, never the stored value, nothing derived from either.
--
-- Passing null or blank clears the token, which is how the settings screen
-- implements "remove". Clearing also disables notifications: a configuration that
-- says `enabled = true` with no token would fail on every inbound email and
-- report a delivery error each time, when what actually happened is that somebody
-- deliberately removed the credential.
--
-- The shape check is the same argument as 0026's channel-id check. Slack bot
-- tokens begin `xoxb-`; a user token is `xoxp-` and an app-level token is
-- `xapp-`, and neither can post as the app. Rejecting them here means the
-- settings screen can say "that looks like a user token, not a bot token" while
-- the operator still has the Slack page open, rather than failing on the first
-- real candidate reply. The length floor is a typo guard, not a format claim —
-- Slack does not document a fixed token length and this migration does not
-- pretend to know one.
create or replace function set_slack_bot_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
begin
  if v_token is null then
    update slack_credentials
       set bot_token = null,
           bot_token_set_at = null
     where id;

    update slack_config set enabled = false where id and enabled;

    return true;
  end if;

  if v_token !~ '^xoxb-[A-Za-z0-9-]{10,}$' then
    return false;
  end if;

  update slack_credentials
     set bot_token = v_token,
         bot_token_set_at = now()
   where id;

  return true;
end;
$$;


-- ── Asking whether a token exists ────────────────────────────────────────────
--
-- Everything the settings screen is allowed to know about the credential. A
-- boolean and a timestamp; no length, no prefix, no suffix, no digest. A digest
-- would be enough to confirm a guess, and there is no product question that
-- needs one.
create or replace function slack_bot_token_state()
returns table (configured boolean, token_set_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select bot_token is not null, bot_token_set_at
    from slack_credentials
   where id
$$;


-- ── Reading the token, for the one caller that sends ─────────────────────────
--
-- The inbound-email webhook runs as the service role, which bypasses RLS and
-- could select the table directly. This function exists anyway, for two reasons.
--
-- First, it returns the whole delivery decision — enabled, channel and token — in
-- one round trip, so the notifier has no chance to read a channel from one
-- moment and a token from another.
--
-- Second, it gives the token exactly one named exit from the database, which is
-- a thing a test can assert and a reviewer can grep for. `slack_delivery_config`
-- appearing anywhere outside `_slack-notifier.ts` is a finding; a bare
-- `.from("slack_credentials")` is harder to notice.
--
-- Not SECURITY DEFINER. The service role bypasses RLS on its own, so definer
-- rights would add nothing and would turn a mistaken grant into a real
-- escalation instead of an empty result.
create or replace function slack_delivery_config()
returns table (enabled boolean, channel_id text, bot_token text)
language sql
stable
set search_path = public
as $$
  select c.enabled and k.bot_token is not null, c.channel_id, k.bot_token
    from slack_config c
    cross join slack_credentials k
   where c.id and k.id
$$;


-- ── Access ───────────────────────────────────────────────────────────────────
--
-- The rule from 0014, 0021 and 0025, restated because it is easy to half-do: a
-- new function in `public` carries Supabase's default-privileges grant to anon
-- and authenticated AND Postgres's own implicit grant to PUBLIC. Revoking only
-- the named roles leaves the function callable through PUBLIC.
--
-- Revoke everything first, then grant back deliberately.
revoke execute on function public.set_slack_bot_token(text) from public, anon, authenticated;
revoke execute on function public.slack_bot_token_state() from public, anon, authenticated;
revoke execute on function public.slack_delivery_config() from public, anon, authenticated;

-- The two the settings screen calls. `authenticated` under the shared access
-- level (USR-2) — every internal user administers the workspace, because there
-- are no roles to distinguish them by.
grant execute on function public.set_slack_bot_token(text) to authenticated, service_role;
grant execute on function public.slack_bot_token_state() to authenticated, service_role;

-- The one the notifier calls, and nothing else. If this line ever grows
-- `authenticated`, the bot token is one `/rest/v1/rpc/slack_delivery_config` away
-- from any browser session.
grant execute on function public.slack_delivery_config() to service_role;
