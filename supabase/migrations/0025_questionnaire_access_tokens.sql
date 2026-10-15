-- M5 — the hosted questionnaire token model (decision D4).
--
-- Until now `/q` took no token and `utilities/questionnaire-invite.ts` answered
-- "no link available" to everything, so `send_questionnaire` settled `skipped`
-- and no reminder run could ever start. This migration supplies the missing
-- half: a credential that addresses exactly one `questionnaire_responses` row.
--
-- THE SHAPE OF THE CREDENTIAL
--
--   * Opaque. 32 cryptographically random bytes, base64url — 256 bits of
--     entropy, generated in `frontend/utilities/questionnaire-token.ts`. It is
--     not derived from any id, so it cannot be computed from data an attacker
--     already has, and the space is far too large to sweep.
--   * Stored hashed. The row keeps `sha256(token)` hex, never the token. The raw
--     value exists in exactly one place — the link in the candidate's email.
--     Someone holding a database dump holds digests, and a digest is not a key
--     to anything (see "WHY THE VERIFIERS TAKE THE RAW TOKEN" below).
--   * Expiring. `access_token_expires_at`, thirty days from issue. Justified in
--     docs/architecture.md; the number itself lives in the TypeScript constant,
--     because the arithmetic is unit-tested there against a supplied `now`.
--   * Single-purpose. It resolves to one response row and nothing else. Every
--     function below joins from that row outwards and returns an explicit column
--     list, so widening a table cannot widen what a candidate can see.
--   * Invalidated on completion. `submit_questionnaire_response` sets the status
--     to 'completed' AND pulls the expiry back to now, so a leaked link is dead
--     twice over and cannot be replayed to overwrite submitted answers.
--
-- WHY THE VERIFIERS TAKE THE RAW TOKEN, NOT ITS HASH
--
-- The obvious alternative — the app hashes the token and looks the response up
-- by digest — quietly makes the stored digest the credential: anyone with read
-- access to this table could pass the digest they just read to the same
-- anon-callable function and be let in, which is precisely the property hashing
-- was supposed to buy. So every verifier below accepts the raw token and hashes
-- it itself, and `questionnaire_token_hash` is the one and only implementation
-- of that hash in the system. There is deliberately no second one in
-- TypeScript.
--
-- WHY THESE ARE FUNCTIONS AND NOT RLS POLICIES
--
-- Same reasoning as 0009, which took unlisted positions off the table surface.
-- A policy cannot tell "I am opening the link I was emailed" from "I am sweeping
-- the table", because both are the same query with a different WHERE clause.
-- `questionnaire_responses` therefore stays entirely off the anon surface and
-- knowledge of the token is the whole capability, which is what a link-is-the-
-- secret model actually means.
--
-- WHAT A HOLDER OF A VALID TOKEN CAN REACH
--
-- The questionnaire's name, the title of the position they applied to, and the
-- questions — minus `answer_routing`, which is internal configuration and must
-- never be shipped to the candidate being routed by it (same omission as
-- `public_position_questions`). No ids beyond the question ids they must post
-- answers against. No other response, no other candidate, no position list.


-- ── The token columns ────────────────────────────────────────────────────────
--
-- On the response row rather than in a child table, per D4: one live link per
-- questionnaire. The consequence is that re-issuing (which every reminder does,
-- because the worker cannot recover a raw token it hashed) replaces the previous
-- link. That is a deliberate trade and is written up in docs/architecture.md.
alter table questionnaire_responses
  add column access_token_hash text,
  add column access_token_issued_at timestamptz,
  add column access_token_expires_at timestamptz;

-- Uniqueness is what makes "this token addresses exactly one response" a
-- database fact rather than a convention. A partial index so the many rows with
-- no token at all (every embedded application-form response) do not collide.
create unique index questionnaire_responses_access_token_hash_idx
  on questionnaire_responses (access_token_hash)
  where access_token_hash is not null;

-- Lower-case hex sha256 and nothing else, so a caller cannot smuggle a pattern,
-- an empty string or a raw token into the column that is compared against.
alter table questionnaire_responses
  add constraint questionnaire_responses_access_token_hash_shape_check
  check (access_token_hash is null or access_token_hash ~ '^[0-9a-f]{64}$');

-- A hash without an expiry would be a credential that never dies; an expiry
-- without a hash is a dangling half-issue. Both or neither.
alter table questionnaire_responses
  add constraint questionnaire_responses_access_token_columns_check
  check (
    num_nonnulls(access_token_hash, access_token_issued_at, access_token_expires_at) in (0, 3)
  );


-- ── The one hash implementation ──────────────────────────────────────────────
--
-- `sha256` is core Postgres (11+), so this needs no extension. Immutable, so it
-- is usable in an index predicate later if the volume ever justifies one.
--
-- A blank token hashes to NULL rather than to the digest of the empty string.
-- That matters: NULL never equals anything, so `where access_token_hash = ...`
-- with a blank token matches no row, instead of matching a row that somehow
-- stored the empty digest.
create or replace function questionnaire_token_hash(p_token text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when p_token is null or length(btrim(p_token)) = 0 then null
           else encode(sha256(convert_to(p_token, 'utf8')), 'hex')
         end
$$;


-- ── Issuing a token ──────────────────────────────────────────────────────────
--
-- Called by the worker's send_questionnaire path (and again by each reminder)
-- with a token it generated and an expiry it computed. Returns false rather than
-- raising when the response is gone or already completed, so a confused caller
-- cannot re-open a finished questionnaire and the worker can settle the queue row
-- with a reason.
--
-- Not SECURITY DEFINER: the only caller is the worker, which runs as the service
-- role and is not subject to RLS anyway. Nothing anonymous ever issues a token.
create or replace function issue_questionnaire_access_token(
  p_questionnaire_response_id uuid,
  p_token text,
  p_now timestamptz,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_hash text := questionnaire_token_hash(p_token);
  v_updated integer;
begin
  if v_hash is null or p_expires_at is null or p_expires_at <= p_now then
    return false;
  end if;

  update questionnaire_responses
     set access_token_hash = v_hash,
         access_token_issued_at = p_now,
         access_token_expires_at = p_expires_at
   where id = p_questionnaire_response_id
     and status = 'pending';

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;


-- ── What state is this link in? ──────────────────────────────────────────────
--
-- Returns one of 'unknown' | 'completed' | 'expired' | 'open'. The hosted page
-- needs to tell a candidate which of those happened, and the three resolvers
-- below deliberately return nothing for anything but 'open', so the state has to
-- come from somewhere.
--
-- This leaks nothing a token holder is not already entitled to: whether their
-- own link works. An attacker guessing tokens learns 'unknown' every time.
--
-- 'completed' is checked BEFORE 'expired' because completing a questionnaire
-- also pulls the expiry back, and "you have already answered this" is the true
-- explanation of the two.
--
-- Note there is no p_now parameter. This function is anon-callable, and a caller
-- who could supply the current time could supply a time before the expiry and
-- walk straight past it. Only the internal clock is trusted here; pgTAP tests
-- expiry by backdating the stored `access_token_expires_at` instead.
create or replace function public_questionnaire_token_state(p_token text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_response questionnaire_responses%rowtype;
  v_hash text := questionnaire_token_hash(p_token);
begin
  if v_hash is null then
    return 'unknown';
  end if;

  select * into v_response
    from questionnaire_responses
   where access_token_hash = v_hash;

  if not found then
    return 'unknown';
  end if;

  if v_response.status = 'completed' then
    return 'completed';
  end if;

  if v_response.access_token_expires_at <= now() then
    return 'expired';
  end if;

  return 'open';
end;
$$;


-- ── The questionnaire behind the link ────────────────────────────────────────
--
-- At most one row, and only while the link is open. An explicit column list
-- rather than `setof questionnaire_responses`, for the same reason as 0009:
-- adding a column to the table must not silently widen what a candidate sees.
--
-- `position_id` is here because the video and file controls upload straight to
-- Storage under the `applications/<position_id>/` prefix that 0005's anon policy
-- allows, and the submit path re-validates the returned path against it. It
-- identifies the role the candidate has already applied to and grants no read
-- access to anything.
create or replace function public_questionnaire_by_token(p_token text)
returns table (
  questionnaire_name text,
  position_title text,
  position_id uuid,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select qt.name, p.title, p.id, r.access_token_expires_at
    from questionnaire_responses r
    join questionnaire_templates qt on qt.id = r.questionnaire_template_id
    join applications a on a.id = r.application_id
    join positions p on p.id = a.position_id
   where r.access_token_hash = questionnaire_token_hash(p_token)
     and r.status = 'pending'
     and r.access_token_expires_at > now()
$$;


-- ── The questions behind the link ────────────────────────────────────────────
--
-- `answer_routing` is deliberately absent — a candidate must never be able to
-- read which of their answers moves them to which stage. This is not
-- hypothetical any more: M6b populates those rules and the worker acts on them.
-- Same omission, same reason, as `public_position_questions` in 0009.
create or replace function public_questionnaire_questions_by_token(p_token text)
returns table (
  id uuid,
  sort_order integer,
  type question_type,
  prompt text,
  help_text text,
  required boolean,
  options jsonb,
  video_max_duration integer,
  video_allow_retakes boolean,
  numeric_min numeric,
  numeric_max numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.sort_order, q.type, q.prompt, q.help_text, q.required, q.options,
         q.video_max_duration, q.video_allow_retakes, q.numeric_min, q.numeric_max
    from questions q
    join questionnaire_responses r
      on r.questionnaire_template_id = q.questionnaire_template_id
   where r.access_token_hash = questionnaire_token_hash(p_token)
     and r.status = 'pending'
     and r.access_token_expires_at > now()
   order by q.sort_order
$$;


-- ── Submitting ───────────────────────────────────────────────────────────────
--
-- The token is verified again here, from scratch. The page's earlier resolution
-- proves nothing about this request, and the client is never asked for — and is
-- never given — the response id, so there is no id to be trusted or tampered
-- with. The token is the only thing that selects a row.
--
-- p_answers: [{"questionId": "…", "value": <json>}, …]
--
-- Order matters. Answers are written BEFORE the status flips, because flipping
-- the status is what fires `questionnaire_responses_answer_routing` (0022), and
-- the routing evaluation reads the answers. Writing them afterwards would race
-- the worker for no reason.
--
-- Completing then does two independent things to the link: the status is no
-- longer 'pending', which every resolver above requires, and the expiry is
-- pulled back to now. Either alone is enough; both together mean a leaked link
-- cannot be replayed to overwrite a submitted questionnaire even if a future
-- migration relaxes one of them.
create or replace function submit_questionnaire_response(p_token text, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_response questionnaire_responses%rowtype;
  v_hash text := questionnaire_token_hash(p_token);
  v_now timestamptz := now();
  v_answer jsonb;
  v_question_id uuid;
begin
  if v_hash is null then
    raise exception 'This questionnaire link is not valid';
  end if;

  select * into v_response
    from questionnaire_responses
   where access_token_hash = v_hash
     and status = 'pending'
     and access_token_expires_at > v_now
     for update;

  if not found then
    raise exception 'This questionnaire link is no longer valid';
  end if;

  -- A resubmission cannot happen through this function (the status check above
  -- closes that door), but a half-written set of answers from a failed attempt
  -- could exist. Clearing first keeps one submission meaning one set of answers.
  delete from answers where questionnaire_response_id = v_response.id;

  for v_answer in select * from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) loop
    v_question_id := nullif(v_answer->>'questionId', '')::uuid;

    -- Only questions that actually belong to this response's template, exactly
    -- as `submit_application` does. A tampered payload naming someone else's
    -- question is dropped rather than stored.
    if v_question_id is not null and exists (
      select 1 from questions q
       where q.id = v_question_id
         and q.questionnaire_template_id = v_response.questionnaire_template_id
    ) then
      insert into answers (questionnaire_response_id, question_id, value)
      values (v_response.id, v_question_id, v_answer->'value');
    end if;
  end loop;

  update questionnaire_responses
     set status = 'completed',
         completed_at = v_now,
         access_token_expires_at = least(access_token_expires_at, v_now)
   where id = v_response.id;

  return jsonb_build_object('completed', true);
end;
$$;


-- ── Access ───────────────────────────────────────────────────────────────────
--
-- The rule from 0014 and 0021, restated because it is easy to half-do: a new
-- function in `public` carries Supabase's default-privileges grant to anon and
-- authenticated AND Postgres's own implicit grant to PUBLIC. Revoking only the
-- named roles leaves the function callable through PUBLIC.
--
-- `06_function_exposure.test.sql` asserts every line of this block.
revoke execute on function public.questionnaire_token_hash(text) from public, anon;
revoke execute on function public.issue_questionnaire_access_token(uuid, text, timestamptz, timestamptz)
  from public, anon;

grant execute on function public.questionnaire_token_hash(text) to service_role;
grant execute on function public.issue_questionnaire_access_token(uuid, text, timestamptz, timestamptz)
  to service_role;

-- The three anon-callable ones. They are the hosted questionnaire, in the same
-- sense that `submit_application` IS the public intake: revoking these stops
-- every candidate answering a questionnaire, so the grants are asserted too.
revoke execute on function public.public_questionnaire_token_state(text) from public;
revoke execute on function public.public_questionnaire_by_token(text) from public;
revoke execute on function public.public_questionnaire_questions_by_token(text) from public;
revoke execute on function public.submit_questionnaire_response(text, jsonb) from public;

grant execute on function public.public_questionnaire_token_state(text) to anon, authenticated;
grant execute on function public.public_questionnaire_by_token(text) to anon, authenticated;
grant execute on function public.public_questionnaire_questions_by_token(text) to anon, authenticated;
grant execute on function public.submit_questionnaire_response(text, jsonb) to anon, authenticated;
