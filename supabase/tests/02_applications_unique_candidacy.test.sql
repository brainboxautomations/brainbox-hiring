-- L4 — one candidacy per person per position.
--
-- `applications` is the board card. The identity rule says a Person who applies
-- twice to the same Position keeps ONE card with one history, so
-- `unique (person_id, position_id)` is what makes the intake RPC's `on conflict`
-- path reachable. Without the constraint the RPC would silently insert a second
-- card and the board would show the same candidate twice in different stages.
--
-- Wrapped in a transaction that is rolled back; runtests() also savepoints each
-- test function, so no fixtures survive on the development database.
begin;

create schema if not exists tap;

create function tap.test_applications_reject_duplicate_candidacy()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_person_id uuid;
  v_position_id uuid;
begin
  return next col_is_unique(
    'public'::name, 'applications'::name, array['person_id', 'position_id']::name[],
    'applications is unique on (person_id, position_id) — one card per candidacy'
  );

  insert into people (first_name, email)
  values ('Pat', ('pgtap-' || v_seed || '@example.com')::citext)
  returning id into v_person_id;

  insert into positions (title, slug, status)
  values ('pgTAP fixture position', 'pgtap-' || v_seed, 'draft')
  returning id into v_position_id;

  insert into applications (person_id, position_id)
  values (v_person_id, v_position_id);

  return next throws_ok(
    format(
      $q$insert into applications (person_id, position_id) values (%L::uuid, %L::uuid)$q$,
      v_person_id, v_position_id
    ),
    '23505'::char(5),
    null::text,
    'a second application for the same (person, position) is rejected'
  );

  -- Same person, different position, is a different candidacy and must be allowed.
  insert into positions (title, slug, status)
  values ('pgTAP fixture position two', 'pgtap-' || v_seed || '-two', 'draft')
  returning id into v_position_id;

  return next lives_ok(
    format(
      $q$insert into applications (person_id, position_id) values (%L::uuid, %L::uuid)$q$,
      v_person_id, v_position_id
    ),
    'the same Person may hold a separate candidacy on a different Position'
  );
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
