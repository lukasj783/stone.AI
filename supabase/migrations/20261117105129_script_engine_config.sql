-- Universal Script Engine: configuration tables.
--
-- Project type decides which script formats, unit types (Act, Chapter, Lesson...)
-- and block types (Action, Narration, Interview...) a project may use. Everything
-- here is reference data: readable by every client, writable only by migrations.

create table public.script_formats (
  key text primary key,
  label text not null,
  renderer text not null check (renderer in ('screenplay', 'two_column', 'treatment', 'instructional')),
  description text,
  sort_order integer not null default 0
);

create table public.project_types (
  key text primary key,
  label text not null,
  description text,
  is_narrative boolean not null default false,
  requires_outline boolean not null default false,
  sort_order integer not null default 0
);

create table public.script_unit_types (
  key text primary key,
  label text not null,
  description text
);

create table public.script_block_types (
  key text primary key,
  label text not null,
  description text,
  -- Which column the block belongs to in a two-column (AV) script.
  lane text not null check (lane in ('video', 'audio', 'both', 'structure')),
  -- Visual blocks are what the storyboard turns into shots.
  is_visual boolean not null default false,
  -- Whether the block is spoken by a character (dialogue, interview, narration).
  speaker_role text not null default 'none' check (speaker_role in ('none', 'optional', 'required')),
  -- JSON Schema for script_blocks.metadata of this type (validated by trigger).
  metadata_schema jsonb,
  sort_order integer not null default 0
);

create table public.character_types (
  key text primary key,
  label text not null,
  description text,
  sort_order integer not null default 0
);

create table public.project_type_formats (
  project_type text not null references public.project_types(key) on delete cascade,
  script_format text not null references public.script_formats(key) on delete cascade,
  is_default boolean not null default false,
  primary key (project_type, script_format)
);
create unique index project_type_formats_one_default
  on public.project_type_formats (project_type) where is_default;

create table public.project_type_unit_types (
  project_type text not null references public.project_types(key) on delete cascade,
  unit_type text not null references public.script_unit_types(key) on delete cascade,
  -- 1 is the outermost level. A unit's parent must sit at a lower level.
  level integer not null check (level >= 1),
  -- Only leaf units hold script blocks, shots and storyboards.
  is_leaf boolean not null default false,
  primary key (project_type, unit_type)
);
create unique index project_type_unit_types_one_leaf
  on public.project_type_unit_types (project_type) where is_leaf;

create table public.project_type_block_types (
  project_type text not null references public.project_types(key) on delete cascade,
  block_type text not null references public.script_block_types(key) on delete cascade,
  sort_order integer not null default 0,
  primary key (project_type, block_type)
);

-- ---------------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------------

insert into public.script_formats (key, label, renderer, description, sort_order) values
  ('screenplay',    'Screenplay',              'screenplay',    'Industry screenplay: scene headings, action, dialogue.', 1),
  ('av_two_column', 'Two-Column (AV) Script',  'two_column',    'Video on the left, audio on the right. Used for documentaries, ads and explainers.', 2),
  ('treatment',     'Treatment',               'treatment',     'Prose description of visuals cut to music or lyrics.', 3),
  ('instructional', 'Instructional Script',    'instructional', 'Lesson script: narration, demonstrations, on-screen key points and checks.', 4);

insert into public.project_types (key, label, description, is_narrative, requires_outline, sort_order) values
  ('feature_film',  'Feature Film',  'Full-length narrative film.',                         true,  true,  1),
  ('short_film',    'Short Film',    'Short narrative film with a complete story.',         true,  true,  2),
  ('music_video',   'Music Video',   'Visuals cut to a song.',                              false, false, 3),
  ('documentary',   'Documentary',   'Explores or explains real events, people or places.', false, false, 4),
  ('advertisement', 'Advertisement', 'Commercial promoting a product or service.',          false, false, 5),
  ('explainer',     'Explainer',     'Short video explaining a product, idea or process.',  false, false, 6),
  ('educational',   'Educational',   'Lesson-based teaching video.',                        false, false, 7);

insert into public.script_unit_types (key, label, description) values
  ('act',      'Act',      'Major dramatic movement of a narrative.'),
  ('sequence', 'Sequence', 'Group of units forming one continuous movement.'),
  ('scene',    'Scene',    'Continuous action in one place and time.'),
  ('chapter',  'Chapter',  'Major thematic part of a documentary.'),
  ('segment',  'Segment',  'Timed section of an ad, explainer or music video.'),
  ('module',   'Module',   'Group of lessons in a course.'),
  ('lesson',   'Lesson',   'One teaching session.'),
  ('section',  'Section',  'Part of a lesson covering one point.');

insert into public.character_types (key, label, description, sort_order) values
  ('main',         'Main',         'Lead character.',                          1),
  ('supporting',   'Supporting',   'Supporting character.',                    2),
  ('extra',        'Extra',        'Background person.',                       3),
  ('presenter',    'Presenter',    'On-camera presenter.',                     4),
  ('host',         'Host',         'Show or programme host.',                  5),
  ('narrator',     'Narrator',     'Off-camera narrating voice.',              6),
  ('interviewee',  'Interviewee',  'Person interviewed in a documentary.',     7),
  ('interviewer',  'Interviewer',  'Person asking interview questions.',       8),
  ('spokesperson', 'Spokesperson', 'Brand representative in an advert.',       9),
  ('instructor',   'Instructor',   'Teacher in an educational video.',        10);

insert into public.script_block_types (key, label, description, lane, is_visual, speaker_role, metadata_schema, sort_order) values
  -- Screenplay
  ('scene_heading', 'Scene Heading', 'INT./EXT. LOCATION - TIME.', 'structure', false, 'none', null, 1),
  ('action',        'Action',        'What is seen on screen.',    'video',     true,  'none', null, 2),
  ('dialogue',      'Dialogue',      'Spoken line by a character.', 'audio',    false, 'required',
    '{"type":"object","properties":{"emotion":{"type":"string"},"delivery":{"type":"string"}}}', 3),
  ('parenthetical', 'Parenthetical', 'Direction for how a line is delivered.', 'audio', false, 'optional', null, 4),
  ('transition',    'Transition',    'CUT TO:, DISSOLVE TO:.',     'structure', false, 'none', null, 5),
  ('shot',          'Shot',          'Explicit camera shot.',      'video',     true,  'none',
    '{"type":"object","properties":{"shot_size":{"type":"string"},"camera_angle":{"type":"string"},"camera_motion":{"type":"string"}}}', 6),
  ('title',         'Title Card',    'Full-screen title or caption card.', 'video', true, 'none', null, 7),
  ('montage',       'Montage',       'Series of quick images.',    'video',     true,  'none', null, 8),
  -- Documentary / AV
  ('narration',     'Narration',     'Narrator voice.',            'audio',     false, 'optional', null, 10),
  ('voice_over',    'Voice-Over',    'Off-screen voice, e.g. an announcer.', 'audio', false, 'optional', null, 11),
  ('interview',     'Interview',     'Interview answer (and optionally the question).', 'audio', false, 'required',
    '{"type":"object","properties":{"interviewer_id":{"type":"string","format":"uuid"},"interviewer_name":{"type":"string"},"question":{"type":"string"},"timestamp":{"type":"string","pattern":"^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$"},"lower_third":{"type":"string"},"location":{"type":"string"}}}', 12),
  ('b_roll',        'B-Roll',        'Supporting footage.',        'video',     true,  'none', null, 13),
  ('archival',      'Archival',      'Archive footage or photos.', 'video',     true,  'none',
    '{"type":"object","properties":{"source":{"type":"string"},"year":{"type":"string"},"rights":{"type":"string"}}}', 14),
  ('graphic',       'Graphic / Animation', 'Motion graphic, map, chart or animation.', 'video', true, 'none', null, 15),
  ('lower_third',   'Lower Third',   'Name/title caption overlay.', 'video',    false, 'none', null, 16),
  ('natural_sound', 'Natural Sound', 'Ambient / location sound.',   'audio',    false, 'none', null, 17),
  ('music',         'Music',         'Music cue.',                  'audio',    false, 'none',
    '{"type":"object","properties":{"mood":{"type":"string"},"track":{"type":"string"},"timestamp":{"type":"string"}}}', 18),
  ('sfx',           'Sound Effect',  'Sound effect cue.',           'audio',    false, 'none', null, 19),
  ('on_screen_text','On-Screen Text','Text overlay (super).',       'video',    false, 'none', null, 20),
  -- Advertisement / explainer
  ('visual',        'Visual',        'What is seen on screen.',     'video',    true,  'none',
    '{"type":"object","properties":{"duration_seconds":{"type":"number","minimum":0}}}', 30),
  ('product_shot',  'Product Shot',  'Hero shot of the product.',   'video',    true,  'none',
    '{"type":"object","properties":{"prop_id":{"type":"string","format":"uuid"}}}', 31),
  ('demonstration', 'Demonstration', 'Showing how something is done or used.', 'video', true, 'none', null, 32),
  ('call_to_action','Call to Action','End card / closing ask.',    'both',     true,  'optional', null, 33),
  ('disclaimer',    'Disclaimer',    'Legal text.',                 'video',    false, 'none', null, 34),
  -- Educational
  ('instruction',   'Instruction',   'Instructor explains a step.', 'audio',    false, 'optional', null, 40),
  ('key_point',     'Key Point',     'Summary point shown on screen.', 'video', false, 'none', null, 41),
  ('quiz',          'Quiz',          'Knowledge check.',            'video',    false, 'none',
    '{"type":"object","properties":{"question":{"type":"string"},"options":{"type":"array","items":{"type":"string"}},"answer":{"type":"string"}}}', 42),
  -- Music video
  ('lyric',         'Lyric',         'Lyric line.',                 'audio',    false, 'none',
    '{"type":"object","properties":{"timestamp":{"type":"string"}}}', 50),
  ('performance',   'Performance',   'Artist performing.',          'video',    true,  'none', null, 51),
  ('narrative_visual','Story Visual','Story footage between performance.', 'video', true, 'none', null, 52);

insert into public.project_type_formats (project_type, script_format, is_default) values
  ('feature_film',  'screenplay',    true),
  ('short_film',    'screenplay',    true),
  ('music_video',   'treatment',     true),
  ('music_video',   'av_two_column', false),
  ('documentary',   'av_two_column', true),
  ('documentary',   'screenplay',    false),
  ('advertisement', 'av_two_column', true),
  ('advertisement', 'screenplay',    false),
  ('explainer',     'av_two_column', true),
  ('explainer',     'instructional', false),
  ('educational',   'instructional', true),
  ('educational',   'av_two_column', false);

insert into public.project_type_unit_types (project_type, unit_type, level, is_leaf) values
  ('feature_film',  'act',      1, false),
  ('feature_film',  'sequence', 2, false),
  ('feature_film',  'scene',    3, true),
  ('short_film',    'act',      1, false),
  ('short_film',    'sequence', 2, false),
  ('short_film',    'scene',    3, true),
  ('music_video',   'sequence', 1, false),
  ('music_video',   'segment',  2, true),
  ('documentary',   'chapter',  1, false),
  ('documentary',   'sequence', 2, false),
  ('documentary',   'scene',    3, true),
  ('advertisement', 'segment',  1, false),
  ('advertisement', 'scene',    2, true),
  ('explainer',     'segment',  1, false),
  ('explainer',     'scene',    2, true),
  ('educational',   'module',   1, false),
  ('educational',   'lesson',   2, false),
  ('educational',   'section',  3, true);

insert into public.project_type_block_types (project_type, block_type, sort_order)
select pt, bt, ord
from (values
  ('feature_film',  array['scene_heading','action','dialogue','parenthetical','transition','shot','title','montage']),
  ('short_film',    array['scene_heading','action','dialogue','parenthetical','transition','shot','title','montage']),
  ('music_video',   array['performance','narrative_visual','lyric','b_roll','on_screen_text','music','transition','title']),
  ('documentary',   array['narration','interview','b_roll','archival','graphic','lower_third','natural_sound','music','sfx','on_screen_text','title','action','dialogue','transition']),
  ('advertisement', array['visual','product_shot','voice_over','dialogue','on_screen_text','sfx','music','call_to_action','disclaimer','title','action','transition']),
  ('explainer',     array['narration','visual','graphic','demonstration','on_screen_text','key_point','voice_over','sfx','music','call_to_action','title']),
  ('educational',   array['narration','instruction','demonstration','visual','graphic','on_screen_text','key_point','quiz','title','music'])
) as cfg(pt, blocks),
lateral unnest(blocks) with ordinality as b(bt, ord);

-- ---------------------------------------------------------------------------
-- Access: read-only reference data
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['script_formats','project_types','script_unit_types','script_block_types',
                           'character_types','project_type_formats','project_type_unit_types','project_type_block_types']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "read config" on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end
$$;
