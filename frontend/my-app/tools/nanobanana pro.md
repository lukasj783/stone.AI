# Replicate Models Quick Guide

This file summarizes how to authenticate and run models with the Replicate Python client.

## 1) Authentication

Replicate uses an API token. Store it in an environment variable (do not hardcode in source).

### PowerShell environment variable

```powershell
$env:REPLICATE_API_TOKEN = "<paste-your-token-here>"
```

### `.env` file option

```env
REPLICATE_API_TOKEN=<paste-your-token-here>
```

Replicate clients automatically read `REPLICATE_API_TOKEN` if available.

## 2) Verify token

```powershell
curl https://api.replicate.com/v1/account `
  -H "Authorization: Bearer $env:REPLICATE_API_TOKEN"
```

Expected result: JSON with your account information.

If it fails, confirm the variable is set:

```powershell
echo $env:REPLICATE_API_TOKEN
```

## 3) Python setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install replicate
```

In `main.py`:

```python
import replicate
```

## 4) Run a model (`replicate.run`)

Use `run()` when you want the output directly.

```python
import replicate

input = {
  "prompt": "How engineers see the San Francisco Bridge",
  "aspect_ratio": "4:3",
  "output_format": "png",
}

output = replicate.run(
  "google/nano-banana-pro",
  input=input,
)

print(output.url)

with open("output.png", "wb") as file:
  file.write(output.read())
```

## 5) Prediction lifecycle

Long-running jobs move through states:

- `starting`
- `processing`
- `succeeded`
- `failed`
- `canceled`

If using prediction objects, call `prediction.reload()` to fetch the latest status.

## 6) Webhooks (event-based updates)

Use webhooks instead of polling when you have a server endpoint.

```python
import replicate

input = {
  "prompt": "How engineers see the San Francisco Bridge",
  "aspect_ratio": "4:3",
  "output_format": "png",
}

callback_url = "https://my.app/webhooks/replicate"

replicate.predictions.create(
  model="google/nano-banana-pro",
  input=input,
  webhook=callback_url,
  webhook_events_filter=["completed"],
)
```

Common webhook events include: `start`, `output`, `logs`, `completed`.

## 7) Access prediction object

Use `predictions.create()` when you need metadata (id, status, logs), not only output.

```python
import replicate

input = {
  "prompt": "How engineers see the San Francisco Bridge",
  "aspect_ratio": "4:3",
  "output_format": "png",
}

prediction = replicate.predictions.create(
  model="google/nano-banana-pro",
  input=input,
)

print(prediction.id, prediction.status)
```

To fetch updates later:

```python
# prediction = replicate.predictions.get(prediction_id)
prediction.reload()
```

## 8) Cancel prediction

Cancel when users abort flows, to reduce unnecessary runtime cost.

```python
import replicate

input = {
  "prompt": "How engineers see the San Francisco Bridge",
  "aspect_ratio": "4:3",
  "output_format": "png",
}

prediction = replicate.predictions.create(
  model="google/nano-banana-pro",
  input=input,
)

prediction.cancel()
```

## 9) Async methods

Replicate's Python client supports `asyncio`. Most methods have async variants prefixed with `async_...`.

## 10) Schemas
