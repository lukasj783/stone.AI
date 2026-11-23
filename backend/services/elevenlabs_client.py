"""Thin ElevenLabs REST client: text to speech and the account's voice list.

Plain ``httpx`` instead of the ``elevenlabs`` SDK keeps the dependency list unchanged and
the calls easy to mock. Endpoints (https://elevenlabs.io/docs/api-reference):

* ``POST /v1/text-to-speech/{voice_id}``: one line of speech, returned as audio bytes.
* ``GET /v2/voices``: premade voices plus the account's own (cloned or designed) voices.
* ``POST /v1/voices/add``: Instant Voice Clone from audio samples (multipart form).
* ``POST /v1/text-to-voice/design``: voice previews from a text description (Voice Design).
* ``POST /v1/text-to-voice``: save the chosen preview as a voice in the account.
"""

import base64

from dataclasses import dataclass
from typing import Any

import httpx


API_BASE_URL = "https://api.elevenlabs.io"
TTS_TIMEOUT_SECONDS = 180.0
VOICES_TIMEOUT_SECONDS = 30.0
MAX_VOICES_PAGE_SIZE = 100


class ElevenLabsError(RuntimeError):
    """An ElevenLabs request failed; the message is safe to show to the user."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class ElevenLabsVoice:
    voice_id: str
    name: str
    category: str | None = None
    description: str | None = None
    preview_url: str | None = None
    labels: dict[str, str] | None = None


DESIGN_TEXT_MIN_CHARS = 100
DESIGN_TEXT_MAX_CHARS = 1000


@dataclass(frozen=True)
class VoicePreview:
    """One designed voice candidate: an id to save it with and a short mp3 sample."""

    generated_voice_id: str
    audio_base64: str
    media_type: str = "audio/mpeg"
    duration_seconds: float | None = None


@dataclass(frozen=True)
class ClonedVoice:
    voice_id: str
    # ElevenLabs wants the speaker to pass its voice captcha before the clone can be used.
    requires_verification: bool = False


def _error_message(response: httpx.Response) -> str:
    """ElevenLabs puts the reason in ``detail`` (a string or {status, message, data})."""
    try:
        payload = response.json()
    except ValueError:
        payload = None
    detail = payload.get("detail") if isinstance(payload, dict) else None
    library_match = False
    if isinstance(detail, dict):
        data = detail.get("data")
        library_match = isinstance(data, dict) and bool(data.get("library_voice_match") or data.get("library_voice_id"))
        detail = detail.get("message") or detail.get("status")
    reason = str(detail).strip() if detail else (response.text or "").strip()[:300]
    if library_match:
        reason += " (the samples match a protected voice in the ElevenLabs Voice Library, so it cannot be cloned)"
    return f"ElevenLabs returned {response.status_code}: {reason or 'no details'}"


def _headers(api_key: str, accept: str = "application/json") -> dict[str, str]:
    if not api_key:
        raise ElevenLabsError("ElevenLabs is not configured: set ELEVENLABS_API_KEY in backend/.env")
    return {"xi-api-key": api_key, "accept": accept}


def synthesize_speech(
    *,
    api_key: str,
    voice_id: str,
    text: str,
    model_id: str,
    output_format: str,
    language_code: str | None = None,
    client: httpx.Client | None = None,
) -> bytes:
    """Speak ``text`` (audio tags included) with ``voice_id`` and return the audio bytes."""
    body: dict[str, Any] = {"text": text, "model_id": model_id}
    if language_code:
        body["language_code"] = language_code
    request = dict(
        url=f"{API_BASE_URL}/v1/text-to-speech/{voice_id}",
        params={"output_format": output_format},
        headers=_headers(api_key, accept="audio/*"),
        json=body,
        timeout=TTS_TIMEOUT_SECONDS,
    )
    try:
        response = client.post(**request) if client else httpx.post(**request)
    except httpx.HTTPError as error:
        raise ElevenLabsError(f"Could not reach ElevenLabs: {error}") from error
    if response.status_code >= 400:
        raise ElevenLabsError(_error_message(response), response.status_code)
    if not response.content:
        raise ElevenLabsError("ElevenLabs returned no audio")
    return response.content


def clone_voice(
    *,
    api_key: str,
    name: str,
    samples: list[tuple[str, bytes, str]],
    description: str | None = None,
    remove_background_noise: bool = False,
    client: httpx.Client | None = None,
) -> ClonedVoice:
    """Instant Voice Clone from ``samples`` [(filename, bytes, content type)], added to the account."""
    if not samples:
        raise ElevenLabsError("Add at least one audio sample to clone a voice")
    data: dict[str, str] = {"name": name, "remove_background_noise": "true" if remove_background_noise else "false"}
    if description and description.strip():
        data["description"] = description.strip()
    request = dict(
        url=f"{API_BASE_URL}/v1/voices/add",
        headers=_headers(api_key),
        data=data,
        files=[("files", sample) for sample in samples],
        timeout=TTS_TIMEOUT_SECONDS,
    )
    try:
        response = client.post(**request) if client else httpx.post(**request)
    except httpx.HTTPError as error:
        raise ElevenLabsError(f"Could not reach ElevenLabs: {error}") from error
    if response.status_code >= 400:
        raise ElevenLabsError(_error_message(response), response.status_code)
    payload = response.json()
    voice_id = payload.get("voice_id") if isinstance(payload, dict) else None
    if not voice_id:
        raise ElevenLabsError("ElevenLabs did not return a voice id for the clone")
    return ClonedVoice(voice_id=str(voice_id), requires_verification=bool(payload.get("requires_verification")))


def _post_json(url: str, api_key: str, body: dict[str, Any], client: httpx.Client | None, params: dict[str, str] | None = None) -> Any:
    request = dict(url=url, headers=_headers(api_key), json=body, params=params, timeout=TTS_TIMEOUT_SECONDS)
    try:
        response = client.post(**request) if client else httpx.post(**request)
    except httpx.HTTPError as error:
        raise ElevenLabsError(f"Could not reach ElevenLabs: {error}") from error
    if response.status_code >= 400:
        raise ElevenLabsError(_error_message(response), response.status_code)
    try:
        return response.json()
    except ValueError as error:
        raise ElevenLabsError("ElevenLabs returned an unreadable response") from error


def design_voice(
    *,
    api_key: str,
    voice_description: str,
    model_id: str,
    text: str | None = None,
    client: httpx.Client | None = None,
) -> list[VoicePreview]:
    """Voice Design: previews of new voices that match ``voice_description``.

    ``text`` is what the previews say (100-1000 characters); without it ElevenLabs writes
    a sample that fits the description.
    """
    body: dict[str, Any] = {"voice_description": voice_description, "model_id": model_id}
    sample = " ".join((text or "").split())
    if sample:
        if not DESIGN_TEXT_MIN_CHARS <= len(sample) <= DESIGN_TEXT_MAX_CHARS:
            raise ElevenLabsError(
                f"Preview text must be {DESIGN_TEXT_MIN_CHARS}-{DESIGN_TEXT_MAX_CHARS} characters (it is {len(sample)})"
            )
        body["text"] = sample
    else:
        body["auto_generate_text"] = True
    payload = _post_json(f"{API_BASE_URL}/v1/text-to-voice/design", api_key, body, client)

    previews: list[VoicePreview] = []
    for item in payload.get("previews", []) if isinstance(payload, dict) else []:
        if not isinstance(item, dict) or not item.get("generated_voice_id"):
            continue
        audio = item.get("audio_base_64") or item.get("audio_base64") or ""
        try:
            if not base64.b64decode(audio, validate=True):
                continue
        except (ValueError, TypeError):
            continue  # an unplayable preview is not worth showing
        duration = item.get("duration_secs")
        previews.append(VoicePreview(
            generated_voice_id=str(item["generated_voice_id"]),
            audio_base64=str(audio),
            media_type=str(item.get("media_type") or "audio/mpeg"),
            duration_seconds=float(duration) if isinstance(duration, int | float) else None,
        ))
    if not previews:
        raise ElevenLabsError("ElevenLabs returned no voice previews; try a more detailed description")
    return previews


def save_designed_voice(
    *,
    api_key: str,
    voice_name: str,
    voice_description: str,
    generated_voice_id: str,
    client: httpx.Client | None = None,
) -> str:
    """Keep one Voice Design preview as a voice in the account; returns its voice_id."""
    payload = _post_json(f"{API_BASE_URL}/v1/text-to-voice", api_key, {
        "voice_name": voice_name,
        "voice_description": voice_description,
        "generated_voice_id": generated_voice_id,
    }, client)
    voice_id = payload.get("voice_id") if isinstance(payload, dict) else None
    if not voice_id:
        raise ElevenLabsError("ElevenLabs did not return a voice id for the designed voice")
    return str(voice_id)


def list_voices(*, api_key: str, search: str | None = None, client: httpx.Client | None = None) -> list[ElevenLabsVoice]:
    """Voices this API key can use: premade voices plus the account's own."""
    params: dict[str, Any] = {"page_size": MAX_VOICES_PAGE_SIZE}
    if search and search.strip():
        params["search"] = search.strip()
    request = dict(
        url=f"{API_BASE_URL}/v2/voices", params=params,
        headers=_headers(api_key), timeout=VOICES_TIMEOUT_SECONDS,
    )
    try:
        response = client.get(**request) if client else httpx.get(**request)
    except httpx.HTTPError as error:
        raise ElevenLabsError(f"Could not reach ElevenLabs: {error}") from error
    if response.status_code >= 400:
        raise ElevenLabsError(_error_message(response), response.status_code)

    voices: list[ElevenLabsVoice] = []
    payload = response.json()
    for item in payload.get("voices", []) if isinstance(payload, dict) else []:
        if not isinstance(item, dict) or not item.get("voice_id"):
            continue
        labels = item.get("labels")
        voices.append(ElevenLabsVoice(
            voice_id=str(item["voice_id"]),
            name=str(item.get("name") or item["voice_id"]),
            category=item.get("category"),
            description=item.get("description"),
            preview_url=item.get("preview_url"),
            labels={str(k): str(v) for k, v in labels.items() if v} if isinstance(labels, dict) else None,
        ))
    return voices
