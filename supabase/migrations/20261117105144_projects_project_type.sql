-- Universal Script Engine: project type and script format become real columns.
--
-- The frontend still writes settings.videoType; a trigger keeps project_type in
-- sync with it so older clients keep working, and fills script_format with the
-- project type's default when it is missing or not allowed.

alter table public.projects
  add column project_type text references public.project_types(key),
  add column script_format text references public.script_formats(key);

update public.projects
set project_type = coalesce(
  (select key from public.project_types where key = settings->>'videoType'),
  'feature_film'
);

update public.projects p
set script_format = f.script_format
from public.project_type_formats f
where f.project_type = p.project_type and f.is_default;

alter table public.projects
  alter column project_type set not null,
  alter column script_format set not null,
  add constraint projects_format_allowed_fk
    foreign key (project_type, script_format)
    references public.project_type_formats (project_type, script_format);

create index projects_project_type_idx on public.projects (project_type);

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

create trigger projects_sync_project_type
  before insert or update on public.projects
  for each row execute function public.projects_sync_project_type();
