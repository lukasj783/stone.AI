"""Turn failures from paid AI providers (Replicate, ...) into clear API errors.

Routes usually wrap any failure as ``HTTPException(500, f"<action> failed: {error}") from error``,
which would show people a raw httpx message such as "Client error '402 Payment Required' for url
...". The handlers installed here look behind that wrapper: when the cause is a provider failure
(out of credit, rejected token, rate limit, outage, timeout), the response gets a status code that
fits and a message people can act on, while every other error passes through unchanged.

Response body: ``{"detail": "<message>", "error": {"code", "provider", "action_url", "action_label"}}``.
``detail`` stays a string, so callers that only read ``detail`` still show the clear message.
"""

from dataclasses import dataclass
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import JSONResponse, Response
from replicate.exceptions import ReplicateError

GENERIC_PROVIDER = "The AI provider"

# Host suffix -> (display name, billing page, environment variable holding the key).
KNOWN_PROVIDERS: dict[str, tuple[str, str | None, str | None]] = {
    "replicate.com": ("Replicate", "https://replicate.com/account/billing", "REPLICATE_API_TOKEN"),
    "elevenlabs.io": ("ElevenLabs", "https://elevenlabs.io/app/subscription", "ELEVENLABS_API_KEY"),
}


@dataclass(frozen=True)
class ProviderFailure:
    code: str
    provider: str
    status_code: int
    message: str
    action_url: str | None = None
    action_label: str | None = None


def _provider_for_url(url: str | None) -> tuple[str, str | None, str | None]:
    host = (urlparse(url).hostname or "") if url else ""
    for suffix, details in KNOWN_PROVIDERS.items():
        if host == suffix or host.endswith(f".{suffix}"):
            return details
    return GENERIC_PROVIDER, None, None


def _failure_for_status(status: int, url: str | None) -> ProviderFailure | None:
    provider, billing_url, key_name = _provider_for_url(url)
    if status == 402:
        return ProviderFailure(
            code="provider_out_of_credit",
            provider=provider,
            status_code=503,
            message=f"{provider} is out of credit, so the AI model can't run. Add credit to the {provider} account, then try again.",
            action_url=billing_url,
            action_label=f"Add credit on {provider}" if billing_url else None,
        )
    if status in (401, 403):
        key_hint = f"Check {key_name} in backend/.env." if key_name else "Check its API key in backend/.env."
        return ProviderFailure(
            code="provider_auth_failed",
            provider=provider,
            status_code=503,
            message=f"{provider} rejected the API key. {key_hint}",
        )
    if status == 429:
        return ProviderFailure(
            code="provider_rate_limited",
            provider=provider,
            status_code=429,
            message=f"{provider} is getting too many requests right now. Wait a minute, then try again.",
        )
    if status >= 500:
        return _unavailable(provider)
    return None


def _unavailable(provider: str) -> ProviderFailure:
    return ProviderFailure(
        code="provider_unavailable",
        provider=provider,
        status_code=502,
        message=f"{provider} can't be reached right now. Try again in a few minutes.",
    )


def _classify_one(error: BaseException) -> ProviderFailure | None:
    if isinstance(error, httpx.HTTPStatusError):
        return _failure_for_status(error.response.status_code, str(error.request.url))
    if isinstance(error, httpx.TimeoutException):
        provider = _provider_for_url(_request_url(error))[0]
        return ProviderFailure(
            code="provider_timeout",
            provider=provider,
            status_code=504,
            message=f"{provider} took too long to answer. Try again.",
        )
    if isinstance(error, httpx.TransportError):
        return _unavailable(_provider_for_url(_request_url(error))[0])
    if isinstance(error, ReplicateError) and error.status:
        return _failure_for_status(error.status, "https://api.replicate.com")
    return None


def _request_url(error: httpx.RequestError) -> str | None:
    try:
        return str(error.request.url)
    except RuntimeError:  # raised when the error was created without a request
        return None


def classify_provider_error(error: BaseException | None) -> ProviderFailure | None:
    """The provider failure behind ``error`` or anything it was raised from, if there is one."""
    seen: set[int] = set()
    while error is not None and id(error) not in seen:
        seen.add(id(error))
        failure = _classify_one(error)
        if failure:
            return failure
        error = error.__cause__ or error.__context__
    return None


def _response(failure: ProviderFailure, action: str | None = None) -> JSONResponse:
    detail = f"{action}: {failure.message}" if action else failure.message
    return JSONResponse(
        status_code=failure.status_code,
        content={
            "detail": detail,
            "error": {
                "code": failure.code,
                "provider": failure.provider,
                "action_url": failure.action_url,
                "action_label": failure.action_label,
            },
        },
    )


def _action_prefix(detail: object, cause: BaseException | None) -> str | None:
    """"Object extraction failed" from "Object extraction failed: <raw error text>"."""
    if not isinstance(detail, str) or cause is None:
        return None
    raw = str(cause)
    if raw and detail.endswith(raw):
        prefix = detail[: -len(raw)].rstrip().rstrip(":").strip()
        return prefix or None
    return None


async def _http_exception(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, HTTPException)
    if exc.status_code >= 500:
        # Follows ``raise ... from error`` and also a raise inside an ``except`` block.
        failure = classify_provider_error(exc)
        if failure:
            return _response(failure, _action_prefix(exc.detail, exc.__cause__ or exc.__context__))
    return await http_exception_handler(request, exc)


async def _provider_exception(_request: Request, exc: Exception) -> JSONResponse:
    failure = classify_provider_error(exc)
    if failure:
        return _response(failure)
    raise exc


def install_provider_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(HTTPException, _http_exception)
    # Provider errors no route caught. Registered by type (not Exception) so the response
    # still passes through the CORS middleware and the browser can read it.
    for error_type in (httpx.HTTPError, ReplicateError):
        app.add_exception_handler(error_type, _provider_exception)
