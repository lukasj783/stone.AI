"""Run the configured Gemini text model on Replicate over plain HTTP.

replicate-python 1.0.x fails to parse predictions for official models because the
API returns "version": null for them, so every text call goes through this helper.
"""

import time

import httpx

from core.config import get_settings


REPLICATE_API_BASE = "https://api.replicate.com/v1"
HTTP_TIMEOUT_SECONDS = 90.0
DEFAULT_DEADLINE_SECONDS = 300.0
VALID_THINKING_LEVELS = {"none", "low", "high"}


class GeminiError(RuntimeError):
    """The text model could not produce an answer."""


def run_gemini(
    prompt: str,
    *,
    system_instruction: str | None = None,
    thinking_level: str | None = None,
    temperature: float | None = None,
    images: list[str] | None = None,
    deadline_seconds: float = DEFAULT_DEADLINE_SECONDS,
) -> str:
    """Run the text model; ``images`` are public image URLs it can look at (max 10)."""
    settings = get_settings()
    if not settings.replicate_api_token:
        raise GeminiError("REPLICATE_API_TOKEN is not configured")
    owner, _, name = settings.gemini_model.partition("/")
    if not owner or not name:
        raise GeminiError(f"GEMINI_MODEL must look like 'owner/name', got '{settings.gemini_model}'")

    payload: dict[str, object] = {"prompt": prompt}
    level = (thinking_level or settings.gemini_thinking_level or "none").strip().lower()
    if level in VALID_THINKING_LEVELS:
        payload["thinking_level"] = level
    if system_instruction:
        payload["system_instruction"] = system_instruction
    if temperature is not None:
        payload["temperature"] = temperature
    if images:
        payload["images"] = images[:10]

    headers = {"Authorization": f"Bearer {settings.replicate_api_token}", "Prefer": "wait"}
    with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, headers=headers) as client:
        response = client.post(f"{REPLICATE_API_BASE}/models/{owner}/{name}/predictions", json={"input": payload})
        response.raise_for_status()
        prediction = response.json()
        deadline = time.monotonic() + deadline_seconds
        while prediction.get("status") in {"starting", "processing"}:
            if time.monotonic() > deadline:
                raise GeminiError("Gemini prediction timed out")
            time.sleep(1.0)
            poll = client.get(prediction["urls"]["get"])
            poll.raise_for_status()
            prediction = poll.json()

    if prediction.get("status") != "succeeded":
        raise GeminiError(f"Gemini prediction {prediction.get('status')}: {prediction.get('error') or 'no error given'}")
    output = prediction.get("output")
    if isinstance(output, str):
        return output
    if isinstance(output, list):
        return "".join(str(chunk) for chunk in output)
    raise GeminiError("Gemini returned no text")
