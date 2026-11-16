import logging

from supabase import Client, create_client

from core.config import get_settings


logger = logging.getLogger(__name__)

MISSING_CREDENTIALS_MESSAGE = (
    "Supabase client not initialized: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
    "in backend/.env or in the process environment"
)


def _missing_credentials(url: str | None, key: str | None) -> list[str]:
    return [
        name
        for name, value in (("SUPABASE_URL", url), ("SUPABASE_SERVICE_ROLE_KEY", key))
        if not value
    ]


def get_supabase_client() -> Client | None:
    """Build a service-role Supabase client, or None when credentials are absent.

    Callers that cannot continue without the client must use
    ``require_supabase_client``, which raises an actionable error instead of
    letting a None propagate into ``None.table(...)``.
    """
    settings = get_settings()
    url = settings.supabase_url
    key = settings.supabase_service_role_key

    missing = _missing_credentials(url, key)
    # ``missing`` is only non-empty when one of the two values is falsy, so this
    # guard also narrows both to ``str`` for ``create_client``.
    if not url or not key:
        logger.warning("%s (missing: %s)", MISSING_CREDENTIALS_MESSAGE, ", ".join(missing))
        return None

    try:
        return create_client(url, key)
    except Exception as error:  # noqa: BLE001 - surface every client construction failure
        logger.warning("Supabase client creation failed for %s: %s", url, error)
        return None


def require_supabase_client() -> Client:
    """Return the Supabase client or raise a RuntimeError explaining what is missing."""
    client = get_supabase_client()
    if client is None:
        raise RuntimeError(MISSING_CREDENTIALS_MESSAGE)
    return client
