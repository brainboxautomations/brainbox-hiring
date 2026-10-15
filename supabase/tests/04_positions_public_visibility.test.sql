-- L4 — the anon read surface for the public careers site.
--
-- A listed position appears on the careers index; an unlisted position is
-- "reachable only by direct link". The anon key ships in the browser bundle, so
-- "we filter to listed in the query" is not a control — anyone can talk to
-- PostgREST themselves. The distinction therefore has to live in the database.
--
-- The model these tests hold in place:
--   * the `positions` table is readable by anon for open + listed ONLY, so
--     `select * from positions` can never enumerate an unlisted role;
--   * unlisted roles are reachable through `public_position_by_slug(text)`, a
--     SECURITY DEFINER lookup that takes an exact slug and returns at most one
--     row — knowledge of the slug IS the capability, which is precisely what
--     "reachable only by direct link" means;
--   * `questions` are served through `public_position_questions(uuid)` for the
--     same reason: the embedded application form must render for an unlisted
--     role without the question bank being anon-readable.
--
-- Role switching follows the L4 convention: seed as the session role, switch to
-- anon, capture results into variables, `reset role`, and only then assert —
-- pgTAP's own bookkeeping uses session temp tables that anon cannot write to.
--
-- Wrapped in a transaction that is rolled back; runtests() also savepoints each
-- test function, so no fixtures survive on the development database.
begin;

create schema if not exists tap;

create function tap.test_anon_reads_only_open_listed_positions_from_the_table()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_listed_slug text := 'pgtap-listed-' || v_seed;
  v_unlisted_slug text := 'pgtap-unlisted-' || v_seed;
  v_draft_slug text := 'pgtap-draft-' || v_seed;
  v_closed_slug text := 'pgtap-closed-' || v_seed;
  v_disabled_slug text := 'pgtap-disabled-' || v_seed;
  v_listed int;
  v_unlisted int;
  v_draft int;
  v_closed int;
  v_disabled int;
  v_any_unlisted int;
begin
  insert into positions (title, slug, status, publish_mode) values
    ('pgTAP listed',   v_listed_slug,   'open',   'listed'),
    ('pgTAP unlisted', v_unlisted_slug, 'open',   'unlisted'),
    ('pgTAP draft',    v_draft_slug,    'draft',  'listed'),
    ('pgTAP closed',   v_closed_slug,   'closed', 'listed'),
    ('pgTAP disabled', v_disabled_slug, 'open',   'disabled');

  set local role anon;
  select count(*)::int into v_listed   from positions where slug = v_listed_slug;
  select count(*)::int into v_unlisted from positions where slug = v_unlisted_slug;
  select count(*)::int into v_draft    from positions where slug = v_draft_slug;
  select count(*)::int into v_closed   from positions where slug = v_closed_slug;
  select count(*)::int into v_disabled from positions where slug = v_disabled_slug;
  -- The enumeration assertion: not "our fixture is hidden" but "no unlisted row
  -- anywhere in the table is reachable", which is the property that actually
  -- matters for a caller-supplied PostgREST filter.
  select count(*)::int into v_any_unlisted from positions where publish_mode = 'unlisted';
  reset role;

  return next is(v_listed, 1, 'anon reads an open + listed position from the positions table — the careers index needs this');
  return next is(v_unlisted, 0, 'anon cannot read an unlisted position from the positions table, even holding its exact slug');
  return next is(v_any_unlisted, 0, 'anon cannot enumerate any unlisted position through PostgREST');
  return next is(v_draft, 0, 'anon cannot read a draft position');
  return next is(v_closed, 0, 'anon cannot read a closed position');
  return next is(v_disabled, 0, 'anon cannot read a position whose publish mode is disabled');
end;
$fn$;

create function tap.test_unlisted_position_resolves_through_the_by_slug_lookup()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_listed_slug text := 'pgtap-listed-' || v_seed;
  v_unlisted_slug text := 'pgtap-unlisted-' || v_seed;
  v_draft_slug text := 'pgtap-draft-' || v_seed;
  v_disabled_slug text := 'pgtap-disabled-' || v_seed;
  v_listed int;
  v_unlisted int;
  v_unlisted_title text;
  v_draft int;
  v_disabled int;
  v_unknown int;
begin
  return next has_function(
    'public'::name, 'public_position_by_slug'::name, array['text']::name[],
    'public_position_by_slug(text) exists'
  );

  insert into positions (title, slug, status, publish_mode) values
    ('pgTAP listed',   v_listed_slug,   'open',   'listed'),
    ('pgTAP unlisted', v_unlisted_slug, 'open',   'unlisted'),
    ('pgTAP draft',    v_draft_slug,    'draft',  'listed'),
    ('pgTAP disabled', v_disabled_slug, 'open',   'disabled');

  set local role anon;
  select count(*)::int into v_listed   from public_position_by_slug(v_listed_slug);
  select count(*)::int into v_unlisted from public_position_by_slug(v_unlisted_slug);
  select title        into v_unlisted_title from public_position_by_slug(v_unlisted_slug);
  select count(*)::int into v_draft    from public_position_by_slug(v_draft_slug);
  select count(*)::int into v_disabled from public_position_by_slug(v_disabled_slug);
  select count(*)::int into v_unknown  from public_position_by_slug('pgtap-no-such-slug-' || v_seed);
  reset role;

  return next is(v_listed, 1, 'the by-slug lookup resolves a listed position');
  return next is(v_unlisted, 1, 'an unlisted position still resolves for a caller who already holds its slug');
  return next is(v_unlisted_title, 'pgTAP unlisted', 'the by-slug lookup returns the position row, not just its existence');
  return next is(v_draft, 0, 'the by-slug lookup refuses a draft position');
  return next is(v_disabled, 0, 'the by-slug lookup refuses a position whose publish mode is disabled');
  return next is(v_unknown, 0, 'the by-slug lookup returns nothing for an unknown slug');
end;
$fn$;

create function tap.test_public_position_is_open_gates_the_apply_route()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_open_id uuid;
  v_draft_id uuid;
  v_open boolean;
  v_draft boolean;
  v_unknown boolean;
begin
  return next has_function(
    'public'::name, 'public_position_is_open'::name, array['uuid']::name[],
    'public_position_is_open(uuid) exists'
  );

  insert into positions (title, slug, status, publish_mode)
  values ('pgTAP unlisted', 'pgtap-unlisted-' || v_seed, 'open', 'unlisted')
  returning id into v_open_id;

  insert into positions (title, slug, status, publish_mode)
  values ('pgTAP draft', 'pgtap-draft-' || v_seed, 'draft', 'listed')
  returning id into v_draft_id;

  set local role anon;
  select public_position_is_open(v_open_id) into v_open;
  select public_position_is_open(v_draft_id) into v_draft;
  select public_position_is_open(gen_random_uuid()) into v_unknown;
  reset role;

  -- /api/apply answers 404 on this gate. It has to see through RLS, because an
  -- unlisted position IS accepting applications while being invisible in the table.
  return next ok(v_open, 'an unlisted, open position accepts applications even though anon cannot read its row');
  return next ok(not v_draft, 'a draft position does not accept applications');
  return next ok(not v_unknown, 'an unknown position id does not accept applications');
end;
$fn$;

create function tap.test_questions_are_served_by_lookup_not_by_table_read()
returns setof text
language plpgsql
as $fn$
declare
  v_seed text := replace(gen_random_uuid()::text, '-', '');
  v_template_id uuid;
  v_listed_id uuid;
  v_unlisted_id uuid;
  v_draft_id uuid;
  v_direct_questions int;
  v_direct_templates int;
  v_listed_questions int;
  v_unlisted_questions int;
  v_draft_questions int;
  v_prompt text;
begin
  return next has_function(
    'public'::name, 'public_position_questions'::name, array['uuid']::name[],
    'public_position_questions(uuid) exists'
  );

  insert into questionnaire_templates (name) values ('pgTAP template ' || v_seed)
  returning id into v_template_id;

  insert into questions (questionnaire_template_id, sort_order, type, prompt)
  values (v_template_id, 1, 'short_text', 'pgTAP prompt ' || v_seed);

  insert into positions (title, slug, status, publish_mode, application_questionnaire_id)
  values ('pgTAP listed', 'pgtap-listed-' || v_seed, 'open', 'listed', v_template_id)
  returning id into v_listed_id;

  insert into positions (title, slug, status, publish_mode, application_questionnaire_id)
  values ('pgTAP unlisted', 'pgtap-unlisted-' || v_seed, 'open', 'unlisted', v_template_id)
  returning id into v_unlisted_id;

  insert into positions (title, slug, status, publish_mode, application_questionnaire_id)
  values ('pgTAP draft', 'pgtap-draft-' || v_seed, 'draft', 'listed', v_template_id)
  returning id into v_draft_id;

  set local role anon;
  select count(*)::int into v_direct_questions from questions where questionnaire_template_id = v_template_id;
  select count(*)::int into v_direct_templates from questionnaire_templates where id = v_template_id;
  select count(*)::int into v_listed_questions from public_position_questions(v_listed_id);
  select count(*)::int into v_unlisted_questions from public_position_questions(v_unlisted_id);
  select prompt into v_prompt from public_position_questions(v_unlisted_id);
  select count(*)::int into v_draft_questions from public_position_questions(v_draft_id);
  reset role;

  -- A questionnaire template attached to an unlisted role leaks the role's
  -- existence and its screening content, so the table itself is closed to anon
  -- and the form is fed from the position-scoped lookup instead.
  return next is(v_direct_questions, 0, 'anon cannot read the questions table directly');
  return next is(v_direct_templates, 0, 'anon cannot read the questionnaire_templates table directly');
  return next is(v_listed_questions, 1, 'the embedded application form for a listed position still gets its questions');
  return next is(v_unlisted_questions, 1, 'the embedded application form for an unlisted position still gets its questions');
  return next is(v_prompt, 'pgTAP prompt ' || v_seed, 'the question lookup returns the question rows, not just a count');
  return next is(v_draft_questions, 0, 'the question lookup returns nothing for a position that is not accepting applications');
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
