"""Turn failures from paid AI providers (Replicate, WaveSpeed, ElevenLabs) into clear API errors.

Routes usually wrap any failure as ``HTTPException(500, f"<action> failed: {error}") from error``,
which would show people raw provider text such as "Client error '402 Payment Required' for url
..." or "HTTP 400: {"code":1407,...}". The handlers installed here look behind that wrapper: when
the cause is a provider failure (out of credit, rejected key, rate limit, outage, timeout, blocked
content), the response gets a status code that fits and a message people can act on, while every
other error passes through unchanged.

Response body: ``{"detail": "<message>", "error": {"code", "provider", "action_url", "action_label"}}``.
``detail`` stays a string, so callers that only read ``detail`` still show the clear message.

Background jobs that store an error for later use ``describe_error`` to get the same message.
"""

import re
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx
import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import JSONResponse, Response
from replicate.exceptions import ReplicateError

GENERIC_PROVIDER = "The AI provider"


@dataclass(frozen=True)
class ProviderInfo:
    name: str
    host: str
    billing_url: str | None
    key_name: str | None
    # Provider-specific application codes (WaveSpeed sends these in the JSON body).
    credit_codes: frozenset[int] = frozenset()
    content_blocked_codes: frozenset[int] = frozenset()


PROVIDERS = (
    ProviderInfo("Replicate", "replicate.com", "https://replicate.com/account/billing", "REPLICATE_API_TOKEN"),
    # https://wavespeed.ai/docs/error-codes: 1407 insufficient_credits, 1200 content moderation.
    ProviderInfo(
        "WaveSpeed", "wavespeed.ai", "https://wavespeed.ai/top-up", "WAVESPEED_API_KEY",
        credit_codes=frozenset({1407}), content_blocked_codes=frozenset({1200}),
    ),
    ProviderInfo("ElevenLabs", "elevenlabs.io", "https://elevenlabs.io/app/subscription", "ELEVENLABS_API_KEY"),
)
UNKNOWN_PROVIDER = ProviderInfo(GENERIC_PROVIDER, "", None, None)

OUT_OF_CREDIT_TEXT = re.compile(
    r"insufficient[_ ](credit|balance|fund)s?|out of credits?|not enough (credit|balance)s?|quota[_ ]exceeded",
    re.IGNORECASE,
)
CONTENT_BLOCKED_TEXT = re.compile(r"content[_ ]moderation|sensitive (content|information)|nsfw", re.IGNORECASE)


class ProviderServiceError(RuntimeError):
    """A provider call failed. Services raise a subclass with what the provider said, so it can be explained.

    ``status`` is the provider's HTTP status, ``code`` its application code (if it sends one) and
    ``provider_message`` its own wording, used to spot "insufficient credits" and the like.
    """

    provider = GENERIC_PROVIDER

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        code: int | None = None,
        provider_message: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.provider_message = provider_message


@dataclass(frozen=True)
class ProviderFailure:
    code: str
    provider: str
    status_code: int
    message: str
    action_url: str | None = None
    action_label: str | None = None


def _provider_named(name: str | None) -> ProviderInfo:
    return next((info for info in PROVIDERS if info.name == name), UNKNOWN_PROVIDER)


def _provider_for_url(url: str | None) -> ProviderInfo:
    host = (urlparse(url).hostname or "") if url else ""
    for info in PROVIDERS:
        if host == info.host or host.endswith(f".{info.host}"):
            return info
    return UNKNOWN_PROVIDER


def _out_of_credit(info: ProviderInfo) -> ProviderFailure:
    return ProviderFailure(
        code="provider_out_of_credit",
        provider=info.name,
        status_code=503,
        message=f"{info.name} is out of credit, so the AI model can't run. Add credit to the {info.name} account, then try again.",
        action_url=info.billing_url,
        action_label=f"Add credit on {info.name}" if info.billing_url else None,
    )


def _content_blocked(info: ProviderInfo) -> ProviderFailure:
    return ProviderFailure(
        code="provider_content_blocked",
        provider=info.name,
        status_code=422,
        message=f"{info.name} blocked this request because its safety check flagged the prompt or images. Change them, then try again.",
    )


def _timeout(info: ProviderInfo) -> ProviderFailure:
    return ProviderFailure(
        code="provider_timeout",
        provider=info.name,
        status_code=504,
        message=f"{info.name} took too long to answer. Try again.",
    )


def _unavailable(info: ProviderInfo) -> ProviderFailure:
    return ProviderFailure(
        code="provider_unavailable",
        provider=info.name,
        status_code=502,
        message=f"{info.name} can't be reached right now. Try again in a few minutes.",
    )


def _failure_for_status(status: int, info: ProviderInfo) -> ProviderFailure | None:
    if status == 402:
        return _out_of_credit(info)
    if status in (401, 403):
        key_hint = f"Check {info.key_name} in backend/.env." if info.key_name else "Check its API key in backend/.env."
        return ProviderFailure(
            code="provider_auth_failed",
            provider=info.name,
            status_code=503,
            message=f"{info.name} rejected the API key. {key_hint}",
        )
    if status == 429:
        return ProviderFailure(
            code="provider_rate_limited",
            provider=info.name,
            status_code=429,
            message=f"{info.name} is getting too many requests right now. Wait a minute, then try again.",
        )
    if status == 504:
        return _timeout(info)
    if status >= 500:
        return _unavailable(info)
    return None


def _failure_for_reply(info: ProviderInfo, status: int | None, code: int | None, text: str | None) -> ProviderFailure | None:
    """Classify from what a provider answered: its application code and wording first, then the HTTP status."""
    if (code is not None and code in info.credit_codes) or (text and OUT_OF_CREDIT_TEXT.search(text)):
        return _out_of_credit(info)
    if (code is not None and code in info.content_blocked_codes) or (text and CONTENT_BLOCKED_TEXT.search(text)):
        return _content_blocked(info)
    return _failure_for_status(status, info) if status else None


def _request_url(error: Exception) -> str | None:
    try:
        request = getattr(error, "request", None)
        return str(request.url) if request is not None else None
    except RuntimeError:  # httpx raises this when the error was created without a request
        return None


def _classify_one(error: BaseException, hint: ProviderInfo) -> ProviderFailure | None:
    if isinstance(error, ProviderServiceError):
        return _failure_for_reply(_provider_named(error.provider), error.status, error.code, error.provider_message)
    if isinstance(error, httpx.HTTPStatusError):
        return _failure_for_status(error.response.status_code, _provider_for_url(str(error.request.url)))
    if isinstance(error, httpx.TimeoutException):
        return _timeout(_provider_for_url(_request_url(error)))
    if isinstance(error, httpx.TransportError):
        return _unavailable(_provider_for_url(_request_url(error)))
    if isinstance(error, requests.HTTPError) and error.response is not None:
        response = error.response
        return _failure_for_reply(_provider_for_url(response.url), response.status_code, None, response.text)
    if isinstance(error, requests.Timeout):
        return _timeout(_provider_for_url(_request_url(error)))
    if isinstance(error, requests.ConnectionError):
        return _unavailable(_provider_for_url(_request_url(error)))
    if isinstance(error, ReplicateError) and error.status:
        return _failure_for_reply(_provider_named("Replicate"), error.status, None, error.detail)
    if isinstance(error, TimeoutError) and hint is not UNKNOWN_PROVIDER:
        return _timeout(hint)
    return None


def classify_provider_error(error: BaseException | None) -> ProviderFailure | None:
    """The provider failure behind ``error`` or anything it was raised from, if there is one."""
    hint = UNKNOWN_PROVIDER
    seen: set[int] = set()
    while error is not None and id(error) not in seen:
        seen.add(id(error))
        if isinstance(error, ProviderServiceError) and hint is UNKNOWN_PROVIDER:
            hint = _provider_named(error.provider)
        failure = _classify_one(error, hint)
        if failure:
            if failure.provider == GENERIC_PROVIDER and hint is not UNKNOWN_PROVIDER:
                # A network error deep in an SDK has no URL; name the provider whose service wrapped it.
                failure = _rename(failure, hint)
            return failure
        error = error.__cause__ or error.__context__
    return None


def _rename(failure: ProviderFailure, info: ProviderInfo) -> ProviderFailure:
    return ProviderFailure(
        code=failure.code,
        provider=info.name,
        status_code=failure.status_code,
        message=failure.message.replace(GENERIC_PROVIDER, info.name, 1),
        action_url=failure.action_url or (info.billing_url if failure.code == "provider_out_of_credit" else None),
        action_label=failure.action_label or (f"Add credit on {info.name}" if failure.code == "provider_out_of_credit" and info.billing_url else None),
    )


def describe_error(error: BaseException) -> str:
    """A message to show people for ``error``: the clear provider message when there is one, else its text."""
    failure = classify_provider_error(error)
    return failure.message if failure else str(error)


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
    if exc.status_code >= 400:
        # Follows ``raise ... from error`` and also a raise inside an ``except`` block. Some routes
        # report provider failures as 400s, so any error status is checked, not only 5xx.
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
    for error_type in (httpx.HTTPError, requests.RequestException, ReplicateError, ProviderServiceError):
        app.add_exception_handler(error_type, _provider_exception)
