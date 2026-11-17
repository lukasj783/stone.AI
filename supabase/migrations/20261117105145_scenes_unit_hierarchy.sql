-- Universal Script Engine: scenes become generic script units.
--
-- A row in scenes is now any unit (Act, Chapter, Lesson, Scene, Section...).
-- parent_id builds the tree; is_leaf marks units that hold script blocks, shots
-- and storyboards. is_leaf is set by the validation trigger from configuration.

alter table public.scenes
  add column unit_type text not null default 'scene' references public.script_unit_types(key),
  add column parent_id uuid references public.scenes(id) on delete cascade,
  add column is_leaf boolean not null default true;

alter table public.scenes
  add constraint scenes_parent_not_self check (parent_id is null or parent_id <> id);

create index scenes_project_parent_sort_idx on public.scenes (project_id, parent_id, sort_order);
