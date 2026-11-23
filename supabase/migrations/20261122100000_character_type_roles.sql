-- Character types decide how a character exists in the production, not only what it is
-- called: whether it is seen on camera or only heard, whether it talks straight to the
-- lens, and which type-specific details it carries (a spokesperson's brand, a host's
-- show). Each project type lists the character types it offers.
--
-- Characters gain:
--   voice         how they sound (tone, accent, pace, pitch, delivery), for every speaker
--   type_details  the details their type asks for (keys from character_types.detail_fields)
--   on_camera     null follows the type; true/false overrides it for one character
--                 (a narrator revealed on screen, an interviewer who is only heard)
-- Manual edits stay in metadata.manual_overrides, as for the other profile fields.

alter table public.character_types
  add column if not exists presence text not null default 'on_camera',
  add column if not exists addresses_camera boolean not null default false,
  add column if not exists detail_fields jsonb not null default '[]'::jsonb;

alter table public.character_types
  add constraint character_types_presence_check check (presence in ('on_camera', 'voice_only')),
  add constraint character_types_detail_fields_is_array check (jsonb_typeof(detail_fields) = 'array');

comment on column public.character_types.presence is
  'on_camera: seen in shots and needs a character sheet. voice_only: heard, never drawn.';
comment on column public.character_types.addresses_camera is
  'Speaks straight to the lens (presenters, hosts, spokespeople) rather than to other characters.';
comment on column public.character_types.detail_fields is
  'Type-specific profile fields, in display order: [{"key", "label", "hint"}].';

update public.character_types set description = 'Lead character.' where key = 'main';
update public.character_types set description = 'Supporting character.' where key = 'supporting';
update public.character_types set description = 'Background person.' where key = 'extra';

update public.character_types set
  description = 'Off-camera voice: a narrator or announcer. Heard, never seen.',
  presence = 'voice_only',
  detail_fields = '[
    {"key": "narration_style", "label": "Narration style", "hint": "e.g. warm storyteller, energetic announcer, calm documentary voice"},
    {"key": "persona", "label": "Who the voice is", "hint": "e.g. the brand, an older Amina looking back, an unnamed guide"},
    {"key": "point_of_view", "label": "Point of view", "hint": "e.g. first person (I, we) or third person"}
  ]'::jsonb
where key = 'narrator';

update public.character_types set
  description = 'On-camera brand representative in an advert.',
  addresses_camera = true,
  detail_fields = '[
    {"key": "brand", "label": "Brand represented", "hint": "e.g. Pepsi"},
    {"key": "spokesperson_kind", "label": "Kind", "hint": "e.g. brand ambassador, celebrity, expert, real customer"},
    {"key": "brand_look", "label": "Brand look", "hint": "Brand colours, uniform or outfit they always wear"},
    {"key": "product_interaction", "label": "With the product", "hint": "e.g. holds the can, takes a sip, shows the label"}
  ]'::jsonb
where key = 'spokesperson';

update public.character_types set
  description = 'On-camera show or programme host.',
  addresses_camera = true,
  detail_fields = '[
    {"key": "show_name", "label": "Show name", "hint": "The programme they host"},
    {"key": "hosting_style", "label": "Hosting style", "hint": "e.g. relaxed and witty, formal news anchor"},
    {"key": "usual_setting", "label": "Usual setting", "hint": "e.g. studio desk, walking through a market"},
    {"key": "signature_line", "label": "Signature line", "hint": "A greeting or catchphrase they repeat"}
  ]'::jsonb
where key = 'host';

update public.character_types set
  description = 'On-camera presenter who explains to the audience.',
  addresses_camera = true,
  detail_fields = '[
    {"key": "expertise", "label": "Topic / expertise", "hint": "e.g. physics teacher, tech reviewer"},
    {"key": "presenting_style", "label": "Presenting style", "hint": "e.g. enthusiastic, calm and precise"},
    {"key": "usual_setting", "label": "Usual setting", "hint": "e.g. whiteboard, kitchen, green screen"}
  ]'::jsonb
where key = 'presenter';

update public.character_types set
  description = 'On-camera teacher in an educational video.',
  addresses_camera = true,
  detail_fields = '[
    {"key": "subject", "label": "Subject", "hint": "What they teach"},
    {"key": "teaching_style", "label": "Teaching style", "hint": "e.g. patient step by step, quick tips"},
    {"key": "usual_setting", "label": "Usual setting", "hint": "e.g. classroom, workshop bench"}
  ]'::jsonb
where key = 'instructor';

update public.character_types set
  description = 'Person asking interview questions; on camera unless set to voice only.',
  detail_fields = '[
    {"key": "interview_style", "label": "Interview style", "hint": "e.g. friendly and conversational, probing journalist"},
    {"key": "organisation", "label": "Outlet / organisation", "hint": "Who they ask the questions for"}
  ]'::jsonb
where key = 'interviewer';

update public.character_types set
  description = 'Person interviewed in a documentary.',
  detail_fields = '[
    {"key": "credential", "label": "Title / credential", "hint": "Shown in their name caption, e.g. Head of Research, KEMRI"},
    {"key": "connection", "label": "Connection to the story", "hint": "e.g. survivor, eyewitness, expert"}
  ]'::jsonb
where key = 'interviewee';

-- Which character types each project type offers, in the order they are listed.
create table if not exists public.project_type_character_types (
  project_type text not null references public.project_types(key) on delete cascade,
  character_type text not null references public.character_types(key) on delete cascade,
  sort_order integer not null default 0,
  primary key (project_type, character_type)
);

insert into public.project_type_character_types (project_type, character_type, sort_order)
select pt, ct, ord
from (values
  ('feature_film',  array['main','supporting','extra','narrator']),
  ('short_film',    array['main','supporting','extra','narrator']),
  ('music_video',   array['main','supporting','extra']),
  ('documentary',   array['interviewee','interviewer','narrator','host','main','supporting','extra']),
  ('advertisement', array['spokesperson','narrator','main','supporting','extra']),
  ('explainer',     array['presenter','host','narrator','main','supporting','extra']),
  ('educational',   array['instructor','presenter','narrator','main','supporting','extra'])
) as cfg(pt, types),
lateral unnest(types) with ordinality as t(ct, ord)
on conflict (project_type, character_type) do update set sort_order = excluded.sort_order;

alter table public.project_type_character_types enable row level security;
create policy "read config" on public.project_type_character_types for select to anon, authenticated using (true);

alter table public.characters
  add column if not exists voice jsonb not null default '{}'::jsonb,
  add column if not exists type_details jsonb not null default '{}'::jsonb,
  add column if not exists on_camera boolean;

alter table public.characters
  add constraint characters_voice_is_object check (jsonb_typeof(voice) = 'object'),
  add constraint characters_type_details_is_object check (jsonb_typeof(type_details) = 'object');

comment on column public.characters.voice is
  'How the character sounds, keyed by tone, accent, pace, pitch, delivery.';
comment on column public.characters.type_details is
  'Details asked for by the character type (character_types.detail_fields keys).';
comment on column public.characters.on_camera is
  'Null follows the character type''s presence; true or false overrides it for this character.';
