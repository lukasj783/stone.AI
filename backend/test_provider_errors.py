import unittest

import httpx
import requests
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from replicate.exceptions import ReplicateError

from core.provider_errors import classify_provider_error, describe_error, install_provider_error_handlers
from services.gemini_client import GeminiError
from services.wavespeed_service import WaveSpeedServiceError, wavespeed_error_from

REPLICATE_URL = "https://api.replicate.com/v1/models/google/gemini-3.5-flash/predictions"


def http_error(status: int, url: str = REPLICATE_URL) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", url)
    response = httpx.Response(status, request=request)
    return httpx.HTTPStatusError(f"Client error '{status}' for url '{url}'", request=request, response=response)


class ClassifyProviderErrorTests(unittest.TestCase):
    def test_payment_required_means_out_of_credit(self) -> None:
        error = classify_provider_error(http_error(402))
        assert error is not None
        self.assertEqual(error.code, "provider_out_of_credit")
        self.assertEqual(error.provider, "Replicate")
        self.assertEqual(error.status_code, 503)
        self.assertIn("out of credit", error.message)
        self.assertNotIn("api.replicate.com", error.message)
        self.assertEqual(error.action_url, "https://replicate.com/account/billing")

    def test_rejected_token(self) -> None:
        for status in (401, 403):
            error = classify_provider_error(http_error(status))
            assert error is not None
            self.assertEqual(error.code, "provider_auth_failed")
            self.assertIn("REPLICATE_API_TOKEN", error.message)

    def test_rate_limited(self) -> None:
        error = classify_provider_error(http_error(429))
        assert error is not None
        self.assertEqual(error.code, "provider_rate_limited")
        self.assertEqual(error.status_code, 429)

    def test_provider_outage(self) -> None:
        error = classify_provider_error(http_error(503))
        assert error is not None
        self.assertEqual(error.code, "provider_unavailable")
        self.assertEqual(error.status_code, 502)

    def test_timeout_and_network_failures(self) -> None:
        request = httpx.Request("POST", REPLICATE_URL)
        timeout = classify_provider_error(httpx.ReadTimeout("timed out", request=request))
        assert timeout is not None
        self.assertEqual(timeout.code, "provider_timeout")
        self.assertEqual(timeout.status_code, 504)
        offline = classify_provider_error(httpx.ConnectError("no route", request=request))
        assert offline is not None
        self.assertEqual(offline.code, "provider_unavailable")

    def test_replicate_sdk_error(self) -> None:
        error = classify_provider_error(ReplicateError(status=402, title="Insufficient credit"))
        assert error is not None
        self.assertEqual(error.code, "provider_out_of_credit")
        self.assertEqual(error.provider, "Replicate")

    def test_finds_the_provider_error_behind_a_wrapper(self) -> None:
        try:
            try:
                raise http_error(402)
            except httpx.HTTPStatusError as inner:
                raise GeminiError("Gemini failed") from inner
        except GeminiError as wrapped:
            error = classify_provider_error(wrapped)
        assert error is not None
        self.assertEqual(error.code, "provider_out_of_credit")

    def test_other_hosts_are_named_generically(self) -> None:
        error = classify_provider_error(http_error(402, "https://api.example.com/v1/run"))
        assert error is not None
        self.assertEqual(error.provider, "The AI provider")
        self.assertIsNone(error.action_url)

    def test_ordinary_errors_are_not_provider_errors(self) -> None:
        self.assertIsNone(classify_provider_error(ValueError("bad input")))
        self.assertIsNone(classify_provider_error(http_error(404)))


def sdk_submit_error(status: int, body: str) -> RuntimeError:
    """What wavespeed-python raises when a submission is refused."""
    return RuntimeError(f"Failed to submit prediction: HTTP {status}: {body}")


def wavespeed_error(error: Exception, action: str = "Image generation failed") -> Exception:
    """The service-level error for an SDK failure, raised and caught so its chain is real."""
    try:
        try:
            raise error
        except Exception as inner:
            raise wavespeed_error_from(action, inner) from inner
    except Exception as wrapped:
        return wrapped


class WaveSpeedErrorTests(unittest.TestCase):
    def test_insufficient_credits_code_on_submit(self) -> None:
        error = wavespeed_error(sdk_submit_error(400, '{"code":1407,"message":"insufficient_credits"}'))
        failure = classify_provider_error(error)
        assert failure is not None
        self.assertEqual(failure.code, "provider_out_of_credit")
        self.assertEqual(failure.provider, "WaveSpeed")
        self.assertEqual(failure.action_url, "https://wavespeed.ai/top-up")
        self.assertEqual(failure.action_label, "Add credit on WaveSpeed")

    def test_insufficient_credits_in_a_failed_prediction(self) -> None:
        sdk = RuntimeError("Prediction failed (task_id: abc123): insufficient_credits: top up your account")
        failure = classify_provider_error(wavespeed_error(sdk))
        assert failure is not None
        self.assertEqual(failure.code, "provider_out_of_credit")

    def test_rejected_key(self) -> None:
        sdk = sdk_submit_error(401, '{"code":401,"message":"Invalid API key. Verify the key on your dashboard."}')
        failure = classify_provider_error(wavespeed_error(sdk))
        assert failure is not None
        self.assertEqual(failure.code, "provider_auth_failed")
        self.assertIn("WAVESPEED_API_KEY", failure.message)

    def test_content_moderation(self) -> None:
        sdk = RuntimeError("Prediction failed (task_id: abc): content moderation: sensitive content detected")
        failure = classify_provider_error(wavespeed_error(sdk))
        assert failure is not None
        self.assertEqual(failure.code, "provider_content_blocked")
        self.assertEqual(failure.status_code, 422)
        submit = sdk_submit_error(400, '{"code":1200,"message":"The content contains sensitive information"}')
        failure = classify_provider_error(wavespeed_error(submit))
        assert failure is not None
        self.assertEqual(failure.code, "provider_content_blocked")

    def test_prediction_timeout(self) -> None:
        failure = classify_provider_error(wavespeed_error(TimeoutError("Prediction timed out after 600 seconds")))
        assert failure is not None
        self.assertEqual(failure.code, "provider_timeout")
        self.assertEqual(failure.provider, "WaveSpeed")

    def test_connection_failure_is_named_after_the_wrapping_provider(self) -> None:
        try:
            try:
                raise requests.ConnectionError("connection refused")
            except requests.ConnectionError as inner:
                raise RuntimeError("Failed to submit prediction after 6 attempts") from inner
        except RuntimeError as sdk:
            failure = classify_provider_error(wavespeed_error(sdk))
        assert failure is not None
        self.assertEqual(failure.code, "provider_unavailable")
        self.assertEqual(failure.provider, "WaveSpeed")

    def test_other_refusals_keep_wavespeeds_reason_without_raw_http(self) -> None:
        error = wavespeed_error(sdk_submit_error(400, '{"code":1401,"message":"Invalid parameter: size"}'))
        self.assertIsNone(classify_provider_error(error))
        self.assertEqual(str(error), "Image generation failed: WaveSpeed rejected the request: Invalid parameter: size")
        self.assertNotIn("HTTP 400", describe_error(error))

    def test_existing_service_errors_pass_through(self) -> None:
        original = WaveSpeedServiceError("No images were returned by WaveSpeed.")
        self.assertIs(wavespeed_error_from("Image generation failed", original), original)


class RequestsLibraryTests(unittest.TestCase):
    def test_http_error_from_requests(self) -> None:
        response = requests.Response()
        response.status_code = 429
        response.url = "https://api.wavespeed.ai/api/v3/bytedance/seedance"
        failure = classify_provider_error(requests.HTTPError("429 Too Many Requests", response=response))
        assert failure is not None
        self.assertEqual(failure.code, "provider_rate_limited")
        self.assertEqual(failure.provider, "WaveSpeed")

    def test_timeout_from_requests(self) -> None:
        failure = classify_provider_error(requests.ReadTimeout("read timed out"))
        assert failure is not None
        self.assertEqual(failure.code, "provider_timeout")


class DescribeErrorTests(unittest.TestCase):
    def test_provider_failures_get_the_clear_message(self) -> None:
        self.assertIn("out of credit", describe_error(http_error(402)))

    def test_other_errors_keep_their_text(self) -> None:
        self.assertEqual(describe_error(ValueError("Scene has no shots")), "Scene has no shots")


def build_app() -> TestClient:
    app = FastAPI()
    install_provider_error_handlers(app)

    @app.post("/wrapped")
    def wrapped() -> None:
        try:
            raise http_error(402)
        except Exception as error:
            raise HTTPException(status_code=500, detail=f"Object extraction failed: {error}") from error

    @app.post("/uncaught")
    def uncaught() -> None:
        raise http_error(429)

    @app.post("/bad-request")
    def bad_request() -> None:
        raise HTTPException(status_code=400, detail="No screenplay blocks were found for this project")

    @app.post("/wavespeed-as-400")
    def wavespeed_as_400() -> None:
        try:
            raise wavespeed_error(sdk_submit_error(400, '{"code":1407,"message":"insufficient_credits"}'))
        except Exception as error:
            raise HTTPException(status_code=400, detail=f"Image generation failed: {error}") from error

    @app.post("/plain-500")
    def plain_500() -> None:
        try:
            raise ValueError("boom")
        except ValueError as error:
            raise HTTPException(status_code=500, detail=f"Save failed: {error}") from error

    return TestClient(app)


class ProviderErrorResponseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = build_app()

    def test_wrapped_provider_error_gets_a_clear_message(self) -> None:
        response = self.client.post("/wrapped")
        self.assertEqual(response.status_code, 503)
        body = response.json()
        self.assertTrue(body["detail"].startswith("Object extraction failed: Replicate is out of credit"))
        self.assertNotIn("api.replicate.com", body["detail"])
        self.assertEqual(body["error"]["code"], "provider_out_of_credit")
        self.assertEqual(body["error"]["action_url"], "https://replicate.com/account/billing")
        self.assertEqual(body["error"]["action_label"], "Add credit on Replicate")

    def test_uncaught_provider_error_is_handled(self) -> None:
        response = self.client.post("/uncaught")
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["error"]["code"], "provider_rate_limited")

    def test_provider_failure_reported_as_400_is_still_explained(self) -> None:
        response = self.client.post("/wavespeed-as-400")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "provider_out_of_credit")
        self.assertIn("WaveSpeed is out of credit", response.json()["detail"])

    def test_other_errors_are_unchanged(self) -> None:
        response = self.client.post("/bad-request")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "No screenplay blocks were found for this project"})
        response = self.client.post("/plain-500")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json(), {"detail": "Save failed: boom"})


if __name__ == "__main__":
    unittest.main()
