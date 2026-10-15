-- An email address is not an authenticator, so the public intake path may create
-- a candidacy but must never rewrite one.
--
-- THE FINDING
--
-- `submit_application` (0005) resolves the Person by email — correctly, that is
-- PRD identity — and then treated a conflict on (person_id, position_id) as
-- "this applicant is refreshing their own submission":
--
--   * `on conflict … do update set application_form_answers = excluded.…`
--   * `delete from questionnaire_responses where application_id = … and
--      context = 'application_embedded'`, followed by a fresh 'completed' one
--   * `documents` rows appended unconditionally
--
-- An email address is public knowledge. Anyone who knows a candidate's address
-- and a published position id could therefore send one unauthenticated POST to
-- /api/apply and overwrite that candidate's application answers, destroy their
-- questionnaire response, and attach files of their choosing — leaving a
-- normal-looking application and no audit trail. The identity resolution was
-- never the bug; treating "same email" as "same person, authenticated" was.
--
-- THE ESCALATION THIS ALSO CLOSES
--
-- The replacement response was inserted with status 'completed', which fires
-- `questionnaire_responses_answer_routing` (0022). On any position whose
-- application-embedded questionnaire carries `answer_routing`, a visitor could
-- pick the answer that routes at a terminal stage and have this system move —
-- and reject — a named candidate on their behalf. No open position has such a
-- rule configured today, so this was latent rather than live; it is now
-- structurally impossible rather than unconfigured.
--
-- THE RULE, AND WHY IT IS THE WHOLE OF THE FIX
--
-- A submission that conflicts with an existing candidacy writes nothing but
-- `updated_at`. Not the answers, not the questionnaire, not the documents. The
-- original intent of the conflict arm — that an applicant pressing Submit twice
-- is never dead-ended with an error — is preserved exactly: the function still
-- returns the same success payload, and the careers page still shows the
-- confirmation screen.
--
-- `updated_at` is bumped deliberately and is the one exception. With everything
-- else a no-op it is the only trace that a second submission arrived at all, and
-- the BEFORE UPDATE trigger `applications_updated_at` (0001) would set it on any
-- touch of the row regardless.
--
-- WHY THE RESPONSE TO THE APPLICANT IS UNCHANGED
--
-- It would be friendlier to answer "you have already applied to this role". It
-- would also be an email-enumeration oracle on an unauthenticated endpoint:
-- anyone could probe whether a given address has applied to a given position.
-- The two cases are deliberately indistinguishable from outside.
--
-- WHAT HAPPENS TO A DUPLICATE SUBMISSION'S UPLOADS
--
-- /api/apply uploads to Storage before it calls this function, so a duplicate
-- submission's files land in the bucket and then get no `documents` row. That is
-- already a handled state: `orphaned_application_uploads` (0011) reports exactly
-- those objects once the grace period has passed, and they are cleaned up like
-- any abandoned half-filled form.


-- ── One embedded response per application, as a database fact ────────────────
--
-- The function below is careful not to replace a response, but "careful" is a
-- property of one caller. This index is the property of the table: it is what
-- makes the non-negotiable — the public intake path never replaces an existing
-- `questionnaire_responses` row — survive the next writer of this context, and
-- it closes the concurrent case that no amount of checking-then-inserting can.
--
-- Partial, because every other context legitimately has many rows per
-- application: a candidate can be sent the same questionnaire again after they
-- have answered it (0033), and that history is kept.
--
-- `submit_application` is the only writer of `application_embedded` rows, and
-- there are no duplicates to clean up first.
create unique index questionnaire_responses_application_embedded_idx
  on questionnaire_responses (application_id)
  where context = 'application_embedded';


-- ── The intake function ──────────────────────────────────────────────────────
--
-- Payload and return value are unchanged from 0005.
create or replace function submit_application(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_position_id uuid := nullif(payload->>'positionId', '')::uuid;
  v_first       text := nullif(trim(payload->>'firstName'), '');
  v_last        text := nullif(trim(payload->>'lastName'), '');
  v_email       text := lower(nullif(trim(payload->>'email'), ''));
  v_phone       text := nullif(trim(payload->>'phone'), '');
  v_form        jsonb := coalesce(payload->'formAnswers', '{}'::jsonb);
  v_q_answers   jsonb := coalesce(payload->'questionnaireAnswers', '[]'::jsonb);
  v_documents   jsonb := coalesce(payload->'documents', '[]'::jsonb);
  v_position    positions%rowtype;
  v_person_id   uuid;
  v_stage_id    uuid;
  v_app_id      uuid;
  v_is_new_application boolean;
  v_response_id uuid;
  v_qid         uuid;
  ans           jsonb;
  doc           jsonb;
begin
  if v_position_id is null then
    raise exception 'positionId is required';
  end if;
  if v_first is null then
    raise exception 'First name is required';
  end if;
  if v_email is null then
    raise exception 'A valid email is required';
  end if;

  -- The position must currently be open and publicly published — this is the
  -- security gate that stops anon submitting to draft/closed/disabled roles.
  select * into v_position from positions where id = v_position_id;
  if not found then
    raise exception 'Position not found';
  end if;
  if v_position.status <> 'open' or v_position.publish_mode not in ('listed', 'unlisted') then
    raise exception 'This position is not accepting applications';
  end if;

  -- Resolve or create the Person. Identity is keyed on email (citext → case
  -- insensitive), so re-applying with the same address reuses the same Person.
  -- An established Person is never renamed and never has a value overwritten;
  -- only a column that is still blank can be filled in.
  select id into v_person_id from people where email = v_email;
  if v_person_id is null then
    insert into people (first_name, last_name, email, phone)
    values (v_first, v_last, v_email, v_phone)
    returning id into v_person_id;
  else
    update people
       set phone     = coalesce(phone, v_phone),
           last_name = coalesce(last_name, v_last)
     where id = v_person_id;
  end if;

  v_stage_id := first_stage_for_position(v_position_id);

  -- Create the Application at the first stage, or find the one that is already
  -- there. `xmax = 0` is true only for the row this statement inserted, so it
  -- reports which of the two happened without a separate lookup that a
  -- concurrent submission could race.
  insert into applications (person_id, position_id, current_stage_id, source, application_form_answers)
  values (v_person_id, v_position_id, v_stage_id, 'public_apply', v_form)
  on conflict (person_id, position_id) do update
    set updated_at = now()
  returning id, (xmax = 0) into v_app_id, v_is_new_application;

  -- Everything below writes to a candidacy. On a resubmission there is nothing
  -- left to do: the existing one keeps its answers, its questionnaire response
  -- and its documents, and the applicant still gets a success payload.
  if not v_is_new_application then
    return jsonb_build_object('applicationId', v_app_id, 'personId', v_person_id);
  end if;

  -- Embedded questionnaire answers, if the position has a questionnaire and the
  -- applicant answered anything. There is deliberately no delete here: this
  -- function creates the one response a new candidacy is allowed and never
  -- removes or replaces one.
  if v_position.application_questionnaire_id is not null
     and jsonb_typeof(v_q_answers) = 'array'
     and jsonb_array_length(v_q_answers) > 0 then

    insert into questionnaire_responses
      (questionnaire_template_id, application_id, context, status, completed_at)
    values
      (v_position.application_questionnaire_id, v_app_id, 'application_embedded', 'completed', now())
    returning id into v_response_id;

    for ans in select * from jsonb_array_elements(v_q_answers) loop
      v_qid := nullif(ans->>'questionId', '')::uuid;
      -- Only accept answers for questions that actually belong to this position's
      -- questionnaire (defence against a tampered payload).
      if v_qid is not null and exists (
        select 1 from questions q
        where q.id = v_qid
          and q.questionnaire_template_id = v_position.application_questionnaire_id
      ) then
        insert into answers (questionnaire_response_id, question_id, value)
        values (v_response_id, v_qid, ans->'value');
      end if;
    end loop;
  end if;

  -- Link uploaded documents (already in Storage) to the Person + Application.
  for doc in select * from jsonb_array_elements(v_documents) loop
    if coalesce(doc->>'storagePath', '') <> '' then
      insert into documents (person_id, application_id, kind, storage_path, filename, mime_type)
      values (
        v_person_id,
        v_app_id,
        coalesce(nullif(doc->>'kind', ''), 'other')::document_kind,
        doc->>'storagePath',
        nullif(doc->>'filename', ''),
        nullif(doc->>'mimeType', '')
      );
    end if;
  end loop;

  return jsonb_build_object('applicationId', v_app_id, 'personId', v_person_id);
end;
$$;
