-- When a project's type changes and the client did not pick a format in the same
-- update, move it to the new type's default format (e.g. film -> advertisement
-- switches screenplay -> av_two_column even though ads also allow screenplay).

create or replace function public.projects_sync_project_type()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  settings_type text := nullif(new.settings->>'videoType', '');
begin
  if tg_op = 'INSERT' then
    if new.project_type is null then
      new.project_type := coalesce(
        (select key from public.project_types where key = settings_type),
        'feature_film'
      );
    end if;
  elsif new.project_type is not distinct from old.project_type
        and settings_type is distinct from (old.settings->>'videoType')
        and exists (select 1 from public.project_types where key = settings_type) then
    -- Legacy client changed settings.videoType only.
    new.project_type := settings_type;
  end if;

  -- Keep settings.videoType mirroring the column for clients that read it.
  new.settings := coalesce(new.settings, '{}'::jsonb) || jsonb_build_object('videoType', new.project_type);

  if tg_op = 'UPDATE'
     and new.project_type is distinct from old.project_type
     and new.script_format is not distinct from old.script_format then
    new.script_format := null;
  end if;

  if new.script_format is null
     or not exists (
       select 1 from public.project_type_formats
       where project_type = new.project_type and script_format = new.script_format
     ) then
    new.script_format := (
      select script_format from public.project_type_formats
      where project_type = new.project_type and is_default
    );
  end if;
  return new;
end;
$$;
