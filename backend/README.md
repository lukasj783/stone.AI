# Backend API

## Environment Variables

Create a `.env` file in `backend` (or set environment variables in your shell):

```env
REPLICATE_API_TOKEN=<paste-your-token-here>
CORS_ORIGINS=http://localhost:3000
```

`CORS_ORIGINS` accepts comma-separated origins.

## Run

```powershell
cd backend
python main.py
```

## Endpoints

- `GET /` health check
- `POST /api/images/generate`

Request body example:

```json
{
  "model": "seedream45",
  "prompt": "A futuristic skyline at sunset",
  "aspect_ratio": "16:9",
  "num_images": 1
}
```
