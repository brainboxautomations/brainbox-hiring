-- Local dev seed: ports the design's mock pipelines and positions so the app has
-- realistic data on a fresh `supabase db reset`. Idempotent-ish: intended for a
-- clean database.

do $$
declare
  v_eng uuid;
  v_sales uuid;
  v_design uuid;
  v_contract uuid;
  v_p1 uuid;
  v_applied_stage uuid;
begin
  -- ── Pipeline templates ─────────────────────────────────────────────────────
  insert into pipelines (name) values ('Engineering — Standard') returning id into v_eng;
  insert into pipelines (name) values ('Sales — Standard') returning id into v_sales;
  insert into pipelines (name) values ('Design — Standard') returning id into v_design;
  insert into pipelines (name) values ('Contract / Freelance') returning id into v_contract;

  insert into pipeline_template_stages (pipeline_id, name, sort_order) values
    (v_eng, 'Applied', 0),
    (v_eng, 'Video Screening', 1),
    (v_eng, 'Programming', 2),
    (v_eng, 'Deep-dive', 3),
    (v_eng, 'Shortlisted', 4),
    (v_eng, 'Made Offer', 5),
    (v_eng, 'Hired', 6),
    (v_eng, 'Rejected (Video Submitted)', 7),
    (v_eng, 'Rejected (Interviewed)', 8),
    (v_eng, 'Disqualified', 9),
    (v_eng, 'No Show', 10),
    (v_eng, 'Didn''t Submit Video', 11),
    (v_eng, 'No interview booked', 12),
    (v_eng, 'Doesn''t meet hiring criteria', 13),
    (v_eng, 'Special Rejection', 14),
    (v_eng, 'Application Withdrawal', 15),
    (v_eng, 'Under Inquiry', 16),
    (v_eng, 'Job Closed', 17),
    (v_eng, 'Shortlisted (Couldn''t Join Now)', 18),
    (v_eng, 'Empty Questionnaire', 19);

  insert into pipeline_template_stages (pipeline_id, name, sort_order) values
    (v_sales, 'Applied', 0),
    (v_sales, 'Screening Call', 1),
    (v_sales, 'Role Play', 2),
    (v_sales, 'Final Interview', 3),
    (v_sales, 'Offer', 4),
    (v_sales, 'Hired', 5),
    (v_sales, 'Rejected', 6);

  insert into pipeline_template_stages (pipeline_id, name, sort_order) values
    (v_design, 'Applied', 0),
    (v_design, 'Portfolio Review', 1),
    (v_design, 'Design Exercise', 2),
    (v_design, 'Onsite', 3),
    (v_design, 'Shortlisted', 4),
    (v_design, 'Hired', 5),
    (v_design, 'Rejected', 6);

  insert into pipeline_template_stages (pipeline_id, name, sort_order) values
    (v_contract, 'Applied', 0),
    (v_contract, 'Screening', 1),
    (v_contract, 'Trial Task', 2),
    (v_contract, 'Hired', 3),
    (v_contract, 'Rejected', 4);

  -- ── Positions ──────────────────────────────────────────────────────────────
  insert into positions (title, slug, department, position_type, locations, remote_flag, status, publish_mode, assigned_pipeline_id)
  values ('Senior Frontend Engineer', 'senior-frontend-engineer', 'Engineering', 'Full-time',
          '[{"country":"UK","detail":"Remote (UK)"}]'::jsonb, true, 'open', 'listed', v_eng)
  returning id into v_p1;

  insert into positions (title, slug, department, position_type, locations, remote_flag, status, publish_mode, assigned_pipeline_id) values
    ('Sales Development Rep', 'sales-development-rep', 'Sales', 'Full-time',
     '[{"country":"UK","detail":"London, UK"}]'::jsonb, false, 'open', 'listed', v_sales),
    ('Product Designer', 'product-designer', 'Design', 'Full-time',
     '[{"country":"EU","detail":"Remote (EU)"}]'::jsonb, true, 'draft', 'listed', v_design),
    ('Customer Success Manager', 'customer-success-manager', 'Success', 'Full-time',
     '[{"country":"UK","detail":"Manchester, UK"}]'::jsonb, false, 'open', 'listed', v_sales),
    ('Video Content Editor', 'video-content-editor', 'Marketing', 'Contract',
     '[{"country":"UK","detail":"Remote"}]'::jsonb, true, 'closed', 'disabled', v_contract),
    ('Backend Engineer', 'backend-engineer', 'Engineering', 'Full-time',
     '[{"country":"UK","detail":"Remote (UK)"}]'::jsonb, true, 'open', 'listed', v_eng),
    ('Operations Analyst', 'operations-analyst', 'Operations', 'Full-time',
     '[{"country":"UK","detail":"London, UK"}]'::jsonb, false, 'archived', 'disabled', v_sales),
    ('Junior Closer', 'junior-closer', 'Sales', 'Full-time',
     '[{"country":"UK","detail":"Remote"}]'::jsonb, true, 'draft', 'listed', v_sales);

  -- Snapshot pipeline stages into every seeded position that has one assigned.
  -- (Direct insert rather than the draft-only RPC, since some are already live.)
  insert into position_stages (position_id, source_template_stage_id, name, sort_order)
  select p.id, s.id, s.name, s.sort_order
  from positions p
  join pipeline_template_stages s on s.pipeline_id = p.assigned_pipeline_id;

  -- ── A few applications on p1 so the board + counts aren't empty ────────────
  select id into v_applied_stage from position_stages
  where position_id = v_p1 and sort_order = 0;

  insert into people (first_name, last_name, email) values
    ('Marcus', 'Reyes', 'marcus.reyes@example.com'),
    ('Priya', 'Nair', 'priya.nair@example.com'),
    ('Daniel', 'Osei', 'daniel.osei@example.com');

  insert into applications (person_id, position_id, current_stage_id, seen, starred)
  select pe.id, v_p1, v_applied_stage,
         (pe.email <> 'marcus.reyes@example.com'),  -- Marcus unseen
         (pe.email = 'priya.nair@example.com')      -- Priya starred
  from people pe
  where pe.email in ('marcus.reyes@example.com', 'priya.nair@example.com', 'daniel.osei@example.com');
end;
$$;
