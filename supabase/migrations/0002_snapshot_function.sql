-- Snapshot a pipeline template's stages into a position as PositionStages.
--
-- Called when a pipeline is assigned to a position (create-position wizard, or
-- changing the pipeline while the position is still a draft). Copies EVERY
-- template stage — including terminal/rejected stages — so the board and its
-- closed/rejected group are complete.
--
-- Guardrail: stages are frozen once a position is live, so this refuses to run
-- unless the position is in 'draft'. Re-running on a draft replaces the prior
-- snapshot (the user swapped pipelines before publishing).
create or replace function snapshot_pipeline_to_position(
  p_position_id uuid,
  p_pipeline_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status position_status;
begin
  select status into v_status from positions where id = p_position_id for update;

  if v_status is null then
    raise exception 'Position % not found', p_position_id;
  end if;

  if v_status <> 'draft' then
    raise exception 'Cannot re-snapshot stages on a % position; stages are frozen once live', v_status;
  end if;

  -- Replace any prior snapshot (idempotent for a draft).
  delete from position_stages where position_id = p_position_id;

  insert into position_stages (position_id, source_template_stage_id, name, sort_order, stage_type)
  select p_position_id, s.id, s.name, s.sort_order, s.stage_type
  from pipeline_template_stages s
  where s.pipeline_id = p_pipeline_id
  order by s.sort_order;

  update positions set assigned_pipeline_id = p_pipeline_id where id = p_position_id;
end;
$$;

-- Convenience: the first stage (lowest sort_order) of a position — where a new
-- application lands on apply. Used by the public intake in Sprint 2.
create or replace function first_stage_for_position(p_position_id uuid)
returns uuid
language sql
stable
as $$
  select id
  from position_stages
  where position_id = p_position_id
  order by sort_order
  limit 1;
$$;
