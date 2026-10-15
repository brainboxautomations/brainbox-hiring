-- 0036 made a same-position resubmission a deliberate, silent no-op on the
-- public response — correctly, since telling the anonymous submitter "you
-- already applied" is an email-enumeration oracle. But "silent to the
-- applicant" doesn't have to mean "invisible to staff": this table gives
-- recruiters a record that a resubmission was attempted and rejected,
-- without changing anything the public endpoint returns.
create table application_resubmission_attempts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index application_resubmission_attempts_application_id_idx
  on application_resubmission_attempts (application_id);

-- Mirrors submit_application's own security model: it is security definer
-- and already the only public writer of applications/documents/answers, so
-- it is the only writer of this table too. No RLS/grants beyond that — same
-- as applications, documents, and every other internal table this function
-- touches, which rely on the app's server-side service-role client rather
-- than RLS for staff access.
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

  select * into v_position from positions where id = v_position_id;
  if not found then
    raise exception 'Position not found';
  end if;
  if v_position.status <> 'open' or v_position.publish_mode not in ('listed', 'unlisted') then
    raise exception 'This position is not accepting applications';
  end if;

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

  insert into applications (person_id, position_id, current_stage_id, source, application_form_answers)
  values (v_person_id, v_position_id, v_stage_id, 'public_apply', v_form)
  on conflict (person_id, position_id) do update
    set updated_at = now()
  returning id, (xmax = 0) into v_app_id, v_is_new_application;

  if not v_is_new_application then
    insert into application_resubmission_attempts (application_id) values (v_app_id);
    return jsonb_build_object('applicationId', v_app_id, 'personId', v_person_id);
  end if;

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
