-- L4 — people identity rule.
--
-- Identity rule: a Person is keyed on email, case-insensitively. Applying as
-- "Casey@Example.com" after having applied as "casey@example.com" must resolve to
-- the SAME Person, never a second one. `people.email` is `citext unique`, and
-- that is the whole mechanism — there is no application-level de-duplication to
-- fall back on. If the column type ever drifts to `text`, every duplicate-cased
-- applicant silently becomes a second candidate with a split history.
--
-- Everything here runs inside a transaction that is rolled back, and runtests()
-- additionally wraps each test function in its own savepoint, so this leaves no
-- rows behind on the shared development database.
begin;

create schema if not exists tap;

create function tap.test_people_email_is_case_insensitive_and_unique()
returns setof text
language plpgsql
as $fn$
declare
  v_local text := 'pgtap-' || replace(gen_random_uuid()::text, '-', '');
begin
  return next col_type_is(
    'public'::name, 'people'::name, 'email'::name, 'citext'::text,
    'people.email is citext, so equality and uniqueness are case-insensitive'
  );

  return next col_not_null(
    'public'::name, 'people'::name, 'email'::name,
    'people.email is not null — identity cannot be anonymous'
  );

  return next col_is_unique(
    'public'::name, 'people'::name, array['email']::name[],
    'people.email is unique — one Person per email address'
  );

  insert into people (first_name, last_name, email)
  values ('Casey', 'Lowercase', (v_local || '@example.com')::citext);

  return next throws_ok(
    format(
      $q$insert into people (first_name, email) values ('Casey', %L::citext)$q$,
      upper(left(v_local, 1)) || substr(v_local, 2) || '@Example.COM'
    ),
    '23505'::char(5),
    null::text,
    'a second Person differing only in email case is rejected (unique violation)'
  );

  -- The flip side of the same rule: a lookup by a differently-cased address must
  -- find the existing row. This is what the intake RPC relies on to attach a new
  -- application to an existing candidate instead of forking their history.
  return next is(
    (select count(*)::int from people where email = (upper(v_local) || '@EXAMPLE.COM')::citext),
    1,
    'the existing Person is found when queried with a differently-cased address'
  );
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
