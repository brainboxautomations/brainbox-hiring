-- L4 — snapshot_pipeline_to_position and the stage-freeze rule.
--
-- A position's stages are frozen once it goes live. Re-snapshotting an
-- open position would delete its position_stages, and `applications.current_stage_id`
-- is `on delete set null` — every candidate on the board would silently lose
-- their stage. The guard lives in the function rather than in the API precisely
-- so that no future caller can route around it; this test is what holds that
-- guarantee in place.
--
-- Wrapped in a transaction that is rolled back; runtests() also savepoints each
-- test function, so no fixtures survive on the development database.
begin;

create schema if not exists tap;

create function tap.test_snapshot_copies_every_stage_of_a_draft()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_pipeline_id uuid;
  v_position_id uuid;
begin
  return next has_function(
    'public'::name, 'snapshot_pipeline_to_position'::name, array['uuid', 'uuid']::name[],
    'snapshot_pipeline_to_position(uuid, uuid) exists'
  );

  insert into pipelines (name) values ('pgTAP fixture pipeline')
  returning id into v_pipeline_id;

  insert into pipeline_template_stages (pipeline_id, name, sort_order)
  values
    (v_pipeline_id, 'Applied', 1),
    (v_pipeline_id, 'Interview', 2),
    (v_pipeline_id, 'Hired', 3),
    (v_pipeline_id, 'Rejected', 4);

  insert into positions (title, slug, status)
  values ('pgTAP fixture position', 'pgtap-' || v_seed, 'draft')
  returning id into v_position_id;

  perform snapshot_pipeline_to_position(v_position_id, v_pipeline_id);

  -- Terminal and success stages are copied too: the board's closed/rejected
  -- group is built from them, so dropping them would break it.
  return next is(
    (select count(*)::int from position_stages where position_id = v_position_id),
    4,
    'every template stage is copied, including the success and terminal ones'
  );

  return next is(
    (select assigned_pipeline_id from positions where id = v_position_id),
    v_pipeline_id,
    'the position records which pipeline it was snapshotted from'
  );

  -- Swapping pipelines while still a draft replaces the prior snapshot rather
  -- than appending to it.
  perform snapshot_pipeline_to_position(v_position_id, v_pipeline_id);

  return next is(
    (select count(*)::int from position_stages where position_id = v_position_id),
    4,
    're-snapshotting a draft replaces the previous stages instead of duplicating them'
  );
end;
$fn$;

create function tap.test_snapshot_is_frozen_once_the_position_is_live()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_pipeline_id uuid;
  v_position_id uuid;
begin
  insert into pipelines (name) values ('pgTAP fixture pipeline')
  returning id into v_pipeline_id;

  insert into pipeline_template_stages (pipeline_id, name, sort_order)
  values (v_pipeline_id, 'Applied', 1);

  insert into positions (title, slug, status)
  values ('pgTAP fixture position', 'pgtap-' || v_seed, 'open')
  returning id into v_position_id;

  return next throws_ok(
    format(
      $q$select snapshot_pipeline_to_position(%L::uuid, %L::uuid)$q$,
      v_position_id, v_pipeline_id
    ),
    'P0001'::char(5),
    'Cannot re-snapshot stages on a open position; stages are frozen once live',
    'snapshotting an open position raises instead of rewriting its stages'
  );

  update positions set status = 'closed' where id = v_position_id;

  return next throws_ok(
    format(
      $q$select snapshot_pipeline_to_position(%L::uuid, %L::uuid)$q$,
      v_position_id, v_pipeline_id
    ),
    'P0001'::char(5),
    'Cannot re-snapshot stages on a closed position; stages are frozen once live',
    'the freeze also holds for a closed position'
  );

  return next is(
    (select count(*)::int from position_stages where position_id = v_position_id),
    0,
    'the refused snapshot left the position stages untouched'
  );

  return next throws_ok(
    format(
      $q$select snapshot_pipeline_to_position(%L::uuid, %L::uuid)$q$,
      gen_random_uuid(), v_pipeline_id
    ),
    'P0001'::char(5),
    null::text,
    'snapshotting an unknown position raises rather than silently doing nothing'
  );
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
