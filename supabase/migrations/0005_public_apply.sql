-- Public application intake (Sprint 2).
--
-- Anonymous applicants never touch internal tables directly (RLS blocks anon
-- writes on people/applications/etc.). Instead the careers site uploads any
-- files to Storage under a scoped anon policy, then calls the SECURITY DEFINER
-- `submit_application` RPC, which runs as the function owner and performs the
-- whole intake atomically: resolve/create the Person, create the Application at
-- the position's first stage, record embedded questionnaire answers, and link
-- uploaded documents.

-- ── Storage: scoped anon upload for candidate files ──────────────────────────
-- Anon may INSERT (upload) into the resumes/videos buckets, but only under the
-- top-level `applications/` prefix, so the public form can't overwrite internal
-- objects. Anon is intentionally NOT granted select — files are read back only
-- through signed URLs minted by the authenticated internal app (migration 0004).
create policy "resumes anon apply upload"
  on storage.objects for insert to anon
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = 'applications');

create policy "videos anon apply upload"
  on storage.objects for insert to anon
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = 'applications');

-- ── RPC: submit_application ──────────────────────────────────────────────────
-- Payload (jsonb):
--   { positionId, firstName, lastName?, email, phone?,
--     formAnswers: {<field_key>: <text>},          -- per-field config answers
--     questionnaireAnswers: [{ questionId, value }],-- value is json (text|number|string[]|storage path)
--     documents: [{ kind, storagePath, filename?, mimeType? }] }
-- Returns: { applicationId, personId }.
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
  select id into v_person_id from people where email = v_email;
  if v_person_id is null then
    insert into people (first_name, last_name, email, phone)
    values (v_first, v_last, v_email, v_phone)
    returning id into v_person_id;
  else
    -- Keep the established identity; only backfill blanks we can now fill.
    update people
       set phone     = coalesce(phone, v_phone),
           last_name = coalesce(last_name, v_last)
     where id = v_person_id;
  end if;

  v_stage_id := first_stage_for_position(v_position_id);

  -- Create the Application at the first stage. Re-applying to the same position
  -- is idempotent (unique person+position): refresh the stored answers instead
  -- of erroring, so a resubmission never dead-ends the applicant.
  insert into applications (person_id, position_id, current_stage_id, source, application_form_answers)
  values (v_person_id, v_position_id, v_stage_id, 'public_apply', v_form)
  on conflict (person_id, position_id) do update
    set application_form_answers = excluded.application_form_answers,
        updated_at = now()
  returning id into v_app_id;

  -- Embedded questionnaire answers, if the position has a questionnaire and the
  -- applicant answered anything.
  if v_position.application_questionnaire_id is not null
     and jsonb_typeof(v_q_answers) = 'array'
     and jsonb_array_length(v_q_answers) > 0 then

    -- One response per (re)submission; drop any prior embedded response so a
    -- resubmit doesn't stack duplicates.
    delete from questionnaire_responses
     where application_id = v_app_id and context = 'application_embedded';

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

-- Anon (the public careers site) may call the intake RPC. It runs as the owner
-- and enforces its own visibility check above.
grant execute on function submit_application(jsonb) to anon;
