import unittest

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from replicate.exceptions import ReplicateError

from core.provider_errors import classify_provider_error, install_provider_error_handlers
from services.gemini_client import GeminiError

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

    def test_other_errors_are_unchanged(self) -> None:
        response = self.client.post("/bad-request")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "No screenplay blocks were found for this project"})
        response = self.client.post("/plain-500")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json(), {"detail": "Save failed: boom"})


if __name__ == "__main__":
    unittest.main()
