-- L4 — editable questionnaire emails (0057).
--
-- Settings holds the default invite and reminder, seeded with the wording the
-- app used before, and each questionnaire uses that or its own. These tests pin
-- that the defaults exist and include the link, that neither a default nor a
-- questionnaire's custom wording can be saved blank, and that anon cannot read
-- or change the defaults.
begin;

create schema if not exists tap;

create function tap.test_the_defaults_are_seeded_with_the_link()
returns setof text
language plpgsql
as $fn$
begin
  return next is(
    (select count(*)::int from questionnaire_email_settings),
    1,
    'there is exactly one row of default questionnaire emails'
  );

  return next ok(
    (select invite_body like '%{{questionnaire.link}}%'
        and reminder_body like '%{{questionnaire.link}}%'
       from questionnaire_email_settings),
    'both defaults carry the questionnaire link'
  );

  return next throws_ok(
    $q$insert into questionnaire_email_settings (id, invite_subject, invite_body, reminder_subject, reminder_body)
       values (false, 's', 'b', 's', 'b')$q$,
    '23514',
    null,
    'a second row of defaults is refused'
  );

  return next throws_ok(
    $q$update questionnaire_email_settings set reminder_body = '   '$q$,
    '23514',
    null,
    'a default cannot be saved blank, since every questionnaire on it would send it'
  );
end;
$fn$;

create function tap.test_a_questionnaire_chooses_default_or_custom()
returns setof text
language plpgsql
as $fn$
declare
  v_id uuid;
begin
  insert into questionnaire_templates (name) values ('pgTAP emails') returning id into v_id;

  return next ok(
    (select invite_email_mode = 'default' and reminder_email_mode = 'default'
       from questionnaire_templates where id = v_id),
    'a new questionnaire uses the default invite and reminder'
  );

  return next throws_ok(
    format($q$update questionnaire_templates set invite_email_mode = 'custom' where id = %L$q$, v_id),
    '23514',
    null,
    'custom wording with no text is refused'
  );

  return next throws_ok(
    format(
      $q$update questionnaire_templates
            set reminder_email_mode = 'custom', reminder_subject = 'Hi', reminder_body = ' '
          where id = %L$q$,
      v_id
    ),
    '23514',
    null,
    'custom wording with a blank email is refused'
  );

  return next lives_ok(
    format(
      $q$update questionnaire_templates
            set invite_email_mode = 'custom', invite_subject = 'Next step', invite_body = 'Hi'
          where id = %L$q$,
      v_id
    ),
    'custom wording with a subject and an email is saved'
  );

  return next throws_ok(
    format($q$update questionnaire_templates set invite_email_mode = 'mine' where id = %L$q$, v_id),
    '23514',
    null,
    'a mode other than default or custom is refused'
  );
end;
$fn$;

create function tap.test_anon_cannot_touch_the_defaults()
returns setof text
language plpgsql
as $fn$
begin
  return next table_privs_are(
    'public', 'questionnaire_email_settings', 'anon', array[]::text[],
    'anon holds no grant on the default questionnaire emails'
  );

  return next ok(
    (select relrowsecurity from pg_class where oid = 'public.questionnaire_email_settings'::regclass),
    'the defaults table has row level security on'
  );
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
