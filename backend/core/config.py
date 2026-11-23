import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


logger = logging.getLogger(__name__)

# Resolved from this file so the backend works regardless of the process CWD.
ENV_PATH = Path(__file__).resolve().parents[1] / ".env"

# Google Gemini 3.5 Flash on Replicate: frontier-level reasoning at Flash latency.
# Override with GEMINI_MODEL if you need to pin a specific model slug.
DEFAULT_GEMINI_MODEL = "google/gemini-3.5-flash"
VALID_GEMINI_THINKING_LEVELS = ("none", "low", "high")

# ElevenLabs' newest TTS model (90+ languages incl. Swahili, audio tags such as [whispers]).
# Generated lines are saved and played later, so the slower, more expressive model is the
# default; "eleven_v4_turbo" trades quality for ~100 ms latency in live use.
DEFAULT_ELEVENLABS_MODEL = "eleven_v4"
DEFAULT_ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128"
# Voice Design (text description -> new voice); the v3 design model is the newest.
DEFAULT_ELEVENLABS_DESIGN_MODEL = "eleven_ttv_v3"


@dataclass
class Settings:
    replicate_api_token: str | None
    cors_origins: list[str]
    supabase_url: str | None
    supabase_service_role_key: str | None
    redis_url: str
    shot_video_poll_seconds: int
    gemini_model: str
    gemini_thinking_level: str
    elevenlabs_api_key: str | None = None
    elevenlabs_model: str = DEFAULT_ELEVENLABS_MODEL
    elevenlabs_output_format: str = DEFAULT_ELEVENLABS_OUTPUT_FORMAT
    elevenlabs_design_model: str = DEFAULT_ELEVENLABS_DESIGN_MODEL
    # Parallel TTS requests per scene; ElevenLabs caps concurrency by plan.
    elevenlabs_max_concurrency: int = 2
    audio_storage_bucket: str = "output-audio"


def _parse_origins(raw: str | None) -> list[str]:
    if not raw:
        return ["*"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def _parse_thinking_level(raw: str | None) -> str:
    level = (raw or "none").strip().lower()
    return level if level in VALID_GEMINI_THINKING_LEVELS else "none"


def _clean(value: str | None) -> str | None:
    """Normalise an env value: strip whitespace/quotes and treat blanks as unset."""
    if value is None:
        return None
    cleaned = " ".join(value.split())
    return cleaned or None


def _load_env_file(env_path: Path | None = None) -> None:
    """Load ``backend/.env`` without letting blank env vars shadow real values."""
    path = env_path or ENV_PATH
    if not path.exists():
        logger.debug("No .env file found at %s; relying on the process environment", path)
        return

    for line in path.read_text(encoding="utf-8-sig").splitlines():
        stripped = line.strip()
        if stripped.startswith("export "):
            stripped = stripped[len("export "):].strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue

        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'").strip()

        # An existing but blank value (common with shells, Docker and CI) must not
        # win over the value declared in .env, otherwise clients silently fall back
        # to None and fail later with "NoneType has no attribute ...".
        if key and not (os.environ.get(key) or "").strip():
            os.environ[key] = value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    _load_env_file()
    supabase_url = _clean(os.getenv("SUPABASE_URL"))
    return Settings(
        replicate_api_token=_clean(os.getenv("REPLICATE_API_TOKEN")),
        cors_origins=_parse_origins(os.getenv("CORS_ORIGINS")),
        supabase_url=supabase_url.rstrip("/") if supabase_url else None,
        supabase_service_role_key=_clean(os.getenv("SUPABASE_SERVICE_ROLE_KEY")),
        redis_url=_clean(os.getenv("REDIS_URL")) or "redis://localhost:6379/0",
        shot_video_poll_seconds=max(2, int(os.getenv("SHOT_VIDEO_POLL_SECONDS", "5"))),
        gemini_model=(os.getenv("GEMINI_MODEL") or DEFAULT_GEMINI_MODEL).strip(),
        gemini_thinking_level=_parse_thinking_level(os.getenv("GEMINI_THINKING_LEVEL")),
        elevenlabs_api_key=_clean(os.getenv("ELEVENLABS_API_KEY")),
        elevenlabs_model=_clean(os.getenv("ELEVENLABS_MODEL")) or DEFAULT_ELEVENLABS_MODEL,
        elevenlabs_output_format=_clean(os.getenv("ELEVENLABS_OUTPUT_FORMAT")) or DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
        elevenlabs_design_model=_clean(os.getenv("ELEVENLABS_DESIGN_MODEL")) or DEFAULT_ELEVENLABS_DESIGN_MODEL,
        elevenlabs_max_concurrency=max(1, int(os.getenv("ELEVENLABS_MAX_CONCURRENCY", "2"))),
        audio_storage_bucket=_clean(os.getenv("AUDIO_STORAGE_BUCKET")) or "output-audio",
    )


def reload_settings() -> Settings:
    """Re-read .env and the process environment (used after runtime env changes)."""
    get_settings.cache_clear()
    return get_settings()
