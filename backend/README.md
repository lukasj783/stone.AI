# Backend API

## Environment Variables

Create a `.env` file in `backend` (or set environment variables in your shell):

```env
REPLICATE_API_TOKEN=<paste-your-token-here>
CORS_ORIGINS=http://localhost:3000
SUPABASE_URL=<your-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
WAVESPEED_API_KEY=<your-wavespeed-api-key>
REDIS_URL=redis://localhost:6379/0
SHOT_VIDEO_POLL_SECONDS=5
```

`CORS_ORIGINS` accepts comma-separated origins.

### ElevenLabs voices (narration and dialogue)

```env
ELEVENLABS_API_KEY=<your-elevenlabs-api-key>
# Optional:
ELEVENLABS_MODEL=eleven_v4              # eleven_v4_turbo for low-latency use
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
ELEVENLABS_MAX_CONCURRENCY=2            # parallel requests; your plan caps this
AUDIO_STORAGE_BUCKET=output-audio
```

Apply `supabase/migrations/20261123090000_voice_line_audio.sql` to create the public
`output-audio` bucket. The studio's **Audio → Voices** page assigns an ElevenLabs voice
to each character and a narrator, then voices a scene line by line. Screenplay
parentheticals become ElevenLabs audio tags (`(whispering)` → `[whispers]`,
`(beat)` → `[short pause]`); directions that are not about the voice (`V.O.`,
`to Amina`, `pointing to the bottle`) are left out and listed under each line.

**Voice cloning** (ElevenLabs Instant Voice Clone, paid plans only): the Voices page's
**Clone a voice** form uploads up to 10 recordings (20 MB each) of one speaker and can hand
the clone straight to a character or the narrator. The request is refused unless the user
confirms the speaker agreed to it; the confirmation time is stored with the voice
(`characters.metadata.tts.clone`, `projects.settings.audio.narrator_clone`). ElevenLabs may
still require the speaker to pass its voice captcha on elevenlabs.io before the clone
can speak, and it blocks samples that match protected Voice Library voices.

**Voice design** (ElevenLabs Voice Design, `ELEVENLABS_DESIGN_MODEL`, default `eleven_ttv_v3`):
**Design** on the Voices page writes a voice description from the character's profile
(age, gender, tone, accent, pace, pitch, personality and the project language) and uses
their own script lines as preview text, so a Swahili character's previews speak
Swahili. ElevenLabs returns a few previews; the one you keep is saved to the account and
assigned. No recordings or consent step are involved, which suits fictional characters.

- `GET /api/story/audio/voices/design/suggestion?project_id=...&target=<character id|narrator>`
- `POST /api/story/audio/voices/design` `{project_id, description, sample_text?}` → previews (base64 mp3)
- `POST /api/story/audio/voices/design/save` `{project_id, generated_voice_id, voice_name, description, character_id? | as_narrator?}`
- `GET /api/story/audio/voices` ElevenLabs voices for the key
- `POST /api/story/audio/voices/clone` multipart: `project_id`, `name`, `files[]`, `consent_confirmed=true`, optional `description`, `remove_background_noise`, `character_id` or `as_narrator`
- `GET /api/story/audio/overview?project_id=...` cast, narrator, language, scenes
- `PUT /api/story/audio/settings` narrator voice, `language_code` (`sw` = Swahili), `narrate_action`
- `PUT /api/story/audio/characters/voice` set or clear a character's voice
- `GET /api/story/audio/scene?project_id=...&scene_id=...` lines as they will be sent
- `POST /api/story/audio/scene/generate` voice a scene, or only `block_ids`

## Run

```powershell
cd backend
python main.py
```

## Storyboard Shot Video Worker

Apply `supabase_shot_video_batches.sql` after `supabase_studio_schema.sql`. The
Storyboard workspace queues every completed storyboard image in a project as a
Seedance 2.0 image-to-video job. FastAPI enqueues work only; Redis and a Celery
worker submit and poll WaveSpeed independently.

Start Redis, then run the API and worker in separate terminals:

```powershell
redis-server
cd backend
python main.py
celery -A core.celery_app.celery_app worker --loglevel=INFO --concurrency=3
```

The worker needs public Supabase `output-images` URLs so WaveSpeed can read the
storyboard stills, and it writes completed MP4s to `output-videos`.

## Generate All Scenes at Once (storyboard batches)

Apply `supabase/migrations/20261126090000_storyboard_batches.sql`. A batch runs on the
Celery workers when Redis and both storyboard workers are running (`run_storyboard_workers.py`,
or double-click `start_storyboard_workers.bat` on Windows). Otherwise it runs on worker threads
inside the backend (the fallback), and a Celery batch whose Redis or workers stay gone for 60
seconds is finished there.

```env
STORYBOARD_FALLBACK=on            # off: only run batches on Celery
STORYBOARD_BATCH_CONCURRENCY=30   # frames drawn at the same time
STORYBOARD_PLAN_CONCURRENCY=10    # scenes planned at the same time
WAVESPEED_IMAGE_TIMEOUT_SECONDS=600
```

Set `STORYBOARD_FALLBACK=off` in production, or whenever the backend runs as more than one
process: the fallback keeps its work in one process's memory, so another process would report
its batches as stopped. With it off, starting a batch while Celery is down returns a clear error
(HTTP 503), and a running batch waits in Redis until the workers come back.

## Endpoints

- `GET /` health check
- `POST /api/images/generate`
- `POST /api/video/shot-batches` queue all completed storyboard shots in a project
- `GET /api/video/shot-batches/{batch_id}?project_id=...` read batch progress
- `POST /api/video/shot-batches/{batch_id}/retry-failed` retry failed shots only

Request body example:

```json
{
  "model": "seedream45",
  "prompt": "A futuristic skyline at sunset",
  "aspect_ratio": "16:9",
  "num_images": 1
}
```
