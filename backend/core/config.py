import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Settings:
    replicate_api_token: str | None
    cors_origins: list[str]
    supabase_url: str | None
    supabase_service_role_key: str | None
    redis_url: str
    shot_video_poll_seconds: int


def _parse_origins(raw: str | None) -> list[str]:
    if not raw:
        return ["*"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def _load_env_file() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue

        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")

        if key and key not in os.environ:
            os.environ[key] = value


def get_settings() -> Settings:
    _load_env_file()
    return Settings(
        replicate_api_token=os.getenv("REPLICATE_API_TOKEN"),
        cors_origins=_parse_origins(os.getenv("CORS_ORIGINS")),
        supabase_url=os.getenv("SUPABASE_URL"),
        supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
        redis_url=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
        shot_video_poll_seconds=max(2, int(os.getenv("SHOT_VIDEO_POLL_SECONDS", "5"))),
    )
