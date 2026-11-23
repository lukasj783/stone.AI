-- ElevenLabs narration and dialogue clips.
--
-- Each spoken script block gets one clip: an `assets` row (type 'audio') for the file and
-- a `voice_lines` row tying it to the scene, block and character. Voice choices live in
-- characters.metadata.tts and projects.settings.audio, so no new columns are needed.
--
-- The backend uploads to the public `output-audio` bucket (override with
-- AUDIO_STORAGE_BUCKET), the same way images go to `output-images`.

insert into storage.buckets (id, name, public)
values ('output-audio', 'output-audio', true)
on conflict (id) do nothing;

-- Regenerating a line replaces the clip of its script block.
create index if not exists voice_lines_script_block_idx
  on public.voice_lines (script_block_id);

create index if not exists voice_lines_project_scene_idx
  on public.voice_lines (project_id, scene_id);
