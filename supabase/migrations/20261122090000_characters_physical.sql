-- Structured, permanent physical identity for characters (height, build, skin tone,
-- face, eyes, hair, facial hair, distinguishing marks, glasses, demeanor).
-- Script extraction writes it; manual edits stay in metadata.manual_overrides under
-- the same keys. Costume and per-shot state (expression, pose) do not belong here.

alter table public.characters
  add column if not exists physical jsonb not null default '{}'::jsonb;

alter table public.characters
  add constraint characters_physical_is_object check (jsonb_typeof(physical) = 'object');

comment on column public.characters.physical is
  'Permanent physical identity from the script, keyed by height, build, skin_tone, face, eyes, hair, facial_hair, distinguishing_marks, glasses, demeanor.';
