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
