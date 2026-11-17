-- Universal Script Engine: database-level validation.
--
-- The browser writes script units and blocks directly, so these rules live in
-- triggers rather than in the API. Errors use check_violation (23514) with a
-- readable message the editor can show.

create extension if not exists pg_jsonschema with schema extensions;

-- Units --------------------------------------------------------------------

create or replace function public.validate_script_unit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_project_type text;
  v_level integer;
  v_is_leaf boolean;
  v_parent record;
  v_parent_level integer;
  v_allowed text;
begin
  select project_type into v_project_type from public.projects where id = new.project_id;

  select level, is_leaf into v_level, v_is_leaf
  from public.project_type_unit_types
  where project_type = v_project_type and unit_type = new.unit_type;

  if v_level is null then
    select string_agg(unit_type, ', ' order by level) into v_allowed
    from public.project_type_unit_types where project_type = v_project_type;
    raise exception 'Unit type "%" is not allowed in % projects. Allowed: %',
      new.unit_type, v_project_type, v_allowed
      using errcode = 'check_violation';
  end if;

  new.is_leaf := v_is_leaf;

  if new.parent_id is not null then
    select id, project_id, unit_type into v_parent from public.scenes where id = new.parent_id;
    if v_parent.id is null then
      raise exception 'Parent unit % does not exist', new.parent_id using errcode = 'foreign_key_violation';
    end if;
    if v_parent.project_id <> new.project_id then
      raise exception 'Parent unit belongs to a different project' using errcode = 'check_violation';
    end if;
    select level into v_parent_level
    from public.project_type_unit_types
    where project_type = v_project_type and unit_type = v_parent.unit_type;
    if v_parent_level is null or v_parent_level >= v_level then
      raise exception 'A % cannot be placed inside a %', new.unit_type, v_parent.unit_type
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' and not v_is_leaf
     and exists (select 1 from public.script_blocks where scene_id = new.id) then
    raise exception 'Unit type "%" cannot hold script blocks; move its blocks first', new.unit_type
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger scenes_validate_unit
  before insert or update of unit_type, parent_id, project_id, is_leaf on public.scenes
  for each row execute function public.validate_script_unit();

-- Blocks -------------------------------------------------------------------

create or replace function public.validate_script_block()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_unit record;
  v_project_type text;
  v_schema jsonb;
  v_allowed text;
begin
  select id, project_id, unit_type, is_leaf into v_unit from public.scenes where id = new.scene_id;
  if v_unit.project_id <> new.project_id then
    raise exception 'Script block project does not match its unit''s project' using errcode = 'check_violation';
  end if;
  if not v_unit.is_leaf then
    raise exception 'Script blocks cannot be added to a % (only to the innermost unit type)', v_unit.unit_type
      using errcode = 'check_violation';
  end if;

  select project_type into v_project_type from public.projects where id = new.project_id;

  if not exists (
    select 1 from public.project_type_block_types
    where project_type = v_project_type and block_type = new.block_type
  ) then
    select string_agg(block_type, ', ' order by sort_order) into v_allowed
    from public.project_type_block_types where project_type = v_project_type;
    raise exception 'Block type "%" is not allowed in % projects. Allowed: %',
      new.block_type, v_project_type, v_allowed
      using errcode = 'check_violation';
  end if;

  select metadata_schema into v_schema from public.script_block_types where key = new.block_type;
  if v_schema is not null
     and not extensions.jsonb_matches_schema(v_schema::json, coalesce(new.metadata, '{}'::jsonb)) then
    raise exception 'Metadata for "%" block does not match its schema: %', new.block_type, v_schema::text
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger script_blocks_validate_block
  before insert or update of block_type, metadata, scene_id, project_id on public.script_blocks
  for each row execute function public.validate_script_block();

-- Changing a project's type -------------------------------------------------

create or replace function public.validate_project_type_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bad text;
begin
  if new.project_type is not distinct from old.project_type then
    return new;
  end if;

  select string_agg(distinct s.unit_type, ', ') into v_bad
  from public.scenes s
  where s.project_id = new.id
    and not exists (
      select 1 from public.project_type_unit_types u
      where u.project_type = new.project_type and u.unit_type = s.unit_type
    );
  if v_bad is not null then
    raise exception 'Cannot change project to %: it has % units that type does not allow', new.project_type, v_bad
      using errcode = 'check_violation';
  end if;

  select string_agg(distinct b.block_type, ', ') into v_bad
  from public.script_blocks b
  where b.project_id = new.id
    and not exists (
      select 1 from public.project_type_block_types t
      where t.project_type = new.project_type and t.block_type = b.block_type
    );
  if v_bad is not null then
    raise exception 'Cannot change project to %: it has % blocks that type does not allow', new.project_type, v_bad
      using errcode = 'check_violation';
  end if;

  -- Leaf flags follow the new configuration.
  update public.scenes s
  set is_leaf = u.is_leaf
  from public.project_type_unit_types u
  where s.project_id = new.id and u.project_type = new.project_type and u.unit_type = s.unit_type
    and s.is_leaf is distinct from u.is_leaf;

  return new;
end;
$$;

-- Plain AFTER UPDATE (no column list): project_type may be changed by the
-- projects_sync_project_type trigger rather than by the client's SET list.
create trigger projects_validate_type_change
  after update on public.projects
  for each row execute function public.validate_project_type_change();
