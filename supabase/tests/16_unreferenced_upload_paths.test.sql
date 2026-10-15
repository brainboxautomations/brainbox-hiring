-- L4 — which uploaded file paths nothing refers to (0052).
--
-- Files live in Cloudflare R2. The orphan clean-up lists R2 and hands the old
-- enough paths to `unreferenced_upload_paths`; whatever it returns is deleted
-- for good. So the dangerous mistake is returning a path that is still in use.
-- These tests pin every way a path can be in use, and that the function is not
-- callable from the API.
begin;

create schema if not exists tap;

create function tap.test_only_unreferenced_paths_are_returned()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := gen_random_uuid()::text;
  v_position_id uuid;
  v_person_id uuid;
  v_app_id uuid;
  v_question_id uuid;
  v_legacy_question_id uuid;
  v_response_id uuid;
  v_template_id uuid;
  v_orphan text;
  v_document text;
  v_answer text;
  v_legacy_answer text;
  v_result text[];
begin
  return next has_function(
    'public'::name, 'unreferenced_upload_paths'::name, array['text[]']::name[],
    'unreferenced_upload_paths(text[]) exists'
  );

  insert into positions (title, slug, status, publish_mode)
  values ('pgTAP orphans', 'pgtap-orphans-' || v_seed, 'open', 'listed')
  returning id into v_position_id;

  insert into people (first_name, email)
  values ('pgTAP', 'pgtap-orphans-' || v_seed || '@example.test')
  returning id into v_person_id;

  insert into applications (person_id, position_id)
  values (v_person_id, v_position_id)
  returning id into v_app_id;

  insert into questionnaire_templates (name)
  values ('pgTAP orphans ' || v_seed)
  returning id into v_template_id;

  insert into questions (questionnaire_template_id, prompt, type, sort_order)
  values (v_template_id, 'Upload a file', 'file', 1)
  returning id into v_question_id;

  insert into questions (questionnaire_template_id, prompt, type, sort_order)
  values (v_template_id, 'Upload another file', 'file', 2)
  returning id into v_legacy_question_id;

  insert into questionnaire_responses (application_id, questionnaire_template_id, context)
  values (v_app_id, v_template_id, 'application_embedded')
  returning id into v_response_id;

  v_orphan        := 'applications/' || v_position_id || '/' || gen_random_uuid()::text || '-abandoned.pdf';
  v_document      := 'applications/' || v_position_id || '/' || gen_random_uuid()::text || '-resume.pdf';
  v_answer        := 'applications/' || v_position_id || '/' || gen_random_uuid()::text || '-answer.pdf';
  v_legacy_answer := 'applications/' || v_position_id || '/' || gen_random_uuid()::text || '-legacy.pdf';

  insert into documents (person_id, application_id, kind, storage_path)
  values (v_person_id, v_app_id, 'resume', v_document);

  insert into answers (questionnaire_response_id, question_id, value) values
    (v_response_id, v_question_id, jsonb_build_object('source', 'upload', 'storagePath', v_answer)),
    (v_response_id, v_legacy_question_id, to_jsonb(v_legacy_answer));

  select array_agg(p) into v_result
  from unreferenced_upload_paths(array[v_orphan, v_document, v_answer, v_legacy_answer]) as p;

  return next is(v_result, array[v_orphan], 'only the path nothing refers to is returned');
  return next is(
    (select count(*)::int from unreferenced_upload_paths(array[]::text[])),
    0,
    'an empty list returns nothing'
  );
end;
$fn$;

create function tap.test_unreferenced_paths_are_not_on_the_public_api()
returns setof text
language plpgsql
as $fn$
begin
  return next function_privs_are(
    'public'::name, 'unreferenced_upload_paths'::name, array['text[]']::name[],
    'anon'::name, array[]::name[],
    'anon cannot call it — it confirms other applicants'' file paths'
  );

  return next function_privs_are(
    'public'::name, 'unreferenced_upload_paths'::name, array['text[]']::name[],
    'authenticated'::name, array[]::name[],
    'it is a maintenance job, not part of the internal app surface'
  );
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
