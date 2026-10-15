-- Rate limits for the public, signed-out surface: the apply form, the hosted
-- questionnaire, and the file uploads both of them make.
--
-- Nothing stopped a script from submitting thousands of applications. Each one
-- creates a person and an application and can fire the first stage's
-- automations, which email whatever address was typed in — from our domain.
--
-- The limits live in the database rather than in the app because the app runs
-- on several short-lived server instances: a counter held in memory would be
-- one counter per instance, and an attacker's requests would simply spread
-- across them. A table is shared by every instance, so the limit holds.
--
-- This migration is additive and safe to apply on its own. The routes call
-- `register_public_submission` before doing any work; until the code that
-- calls it is deployed, nothing reads this table. Closing the direct routes
-- around these checks is migration 0049, which must be applied only after that
-- code is live.


-- ── The ledger ───────────────────────────────────────────────────────────────
--
-- One row per accepted attempt. `ip` is the caller's address as the host
-- reported it; `email` is set only for applications, which are also limited
-- per address so that rotating IPs cannot flood one victim's inbox.
create table public_submission_attempts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('apply', 'questionnaire', 'upload')),
  ip text not null,
  email citext,
  created_at timestamptz not null default now()
);

create index public_submission_attempts_ip_idx
  on public_submission_attempts (kind, ip, created_at desc);

create index public_submission_attempts_email_idx
  on public_submission_attempts (kind, email, created_at desc)
  where email is not null;

-- Internal bookkeeping: only the server, through the function below, touches
-- it. RLS on with no policies, and no grants to the API roles.
alter table public_submission_attempts enable row level security;
revoke all on public_submission_attempts from anon, authenticated;


-- ── Checking and recording an attempt ────────────────────────────────────────
--
-- Returns NULL when the attempt is allowed (and records it), or the name of the
-- limit that refused it: 'ip' or 'email'. The caller turns that into a 429.
--
-- The limits:
--   apply          10 per IP per 10 minutes, 5 per email address per day
--   questionnaire  20 per IP per 10 minutes
--   upload         60 files per IP per 10 minutes
--
-- Generous for a real person — even a shared office connection — and far too
-- low to be worth scripting against. Rows older than two days are pruned as
-- attempts come in, so the table stays small without a scheduled job.
--
-- Two attempts racing can both pass the count and both be recorded; at these
-- limits being off by one under a burst does not matter, and it keeps the check
-- a plain count rather than a lock.
create or replace function register_public_submission(
  p_kind text,
  p_ip text,
  p_email text,
  p_now timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip_limit integer;
  v_ip_window interval := interval '10 minutes';
  v_email_limit integer := 5;
  v_email_window interval := interval '1 day';
  -- The generated client types this argument as a plain string, so callers
  -- with no address pass an empty one.
  v_email citext := nullif(trim(p_email), '');
  v_count integer;
begin
  v_ip_limit := case p_kind
    when 'apply' then 10
    when 'questionnaire' then 20
    when 'upload' then 60
  end;

  if v_ip_limit is null then
    raise exception 'unknown submission kind: %', p_kind;
  end if;

  delete from public_submission_attempts
   where created_at < p_now - interval '2 days';

  select count(*) into v_count
    from public_submission_attempts
   where kind = p_kind
     and ip = coalesce(p_ip, 'unknown')
     and created_at > p_now - v_ip_window;

  if v_count >= v_ip_limit then
    return 'ip';
  end if;

  if p_kind = 'apply' and v_email is not null then
    select count(*) into v_count
      from public_submission_attempts
     where kind = 'apply'
       and email = v_email
       and created_at > p_now - v_email_window;

    if v_count >= v_email_limit then
      return 'email';
    end if;
  end if;

  insert into public_submission_attempts (kind, ip, email, created_at)
  values (p_kind, coalesce(p_ip, 'unknown'), v_email, p_now);

  return null;
end;
$$;

-- Only the server calls this, with the service role. A function in `public`
-- picks up default grants to anon and authenticated, so revoke from PUBLIC and
-- by name, the rule learned in 0021.
revoke execute on function public.register_public_submission(text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.register_public_submission(text, text, text, timestamptz)
  to service_role;
