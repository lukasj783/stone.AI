import unittest
from unittest.mock import MagicMock, patch

from schemas.image_generation import CreateImageRequest, CreateImageResponse
from services.image_generation_service import generate_provider_images


class ImageGenerationServiceTests(unittest.TestCase):
    @patch("services.image_generation_service.generate_wavespeed_images")
    @patch("services.image_generation_service.generate_images")
    def test_retries_a_failed_replicate_text_request_with_wavespeed(
        self,
        generate_replicate: MagicMock,
        generate_wavespeed: MagicMock,
    ) -> None:
        generate_replicate.side_effect = RuntimeError("Request was throttled")
        generate_wavespeed.return_value = CreateImageResponse(
            model="google/nano-banana-pro/text-to-image-multi",
            images=["https://example.com/image.png"],
        )
        payload = CreateImageRequest(model="nanobanana", provider="replicate", prompt="A space captain")

        response = generate_provider_images(payload)

        self.assertEqual(response.images, ["https://example.com/image.png"])
        generate_wavespeed.assert_called_once()
        fallback_payload = generate_wavespeed.call_args.kwargs["payload"]
        self.assertEqual(fallback_payload.provider, "wavespeed")
        self.assertEqual(fallback_payload.model, "google/nano-banana-pro/text-to-image-multi")

    @patch("services.image_generation_service.generate_wavespeed_images")
    @patch("services.image_generation_service.generate_images")
    def test_retries_a_failed_replicate_reference_request_with_wavespeed_edit(
        self,
        generate_replicate: MagicMock,
        generate_wavespeed: MagicMock,
    ) -> None:
        generate_replicate.side_effect = RuntimeError("Provider unavailable")
        generate_wavespeed.return_value = CreateImageResponse(
            model="google/nano-banana-pro/edit",
            images=["https://example.com/image.png"],
        )
        payload = CreateImageRequest(
            model="nanobanana",
            provider="replicate",
            prompt="A space captain",
            image_mapping={"reference": "https://example.com/reference.png"},
        )

        generate_provider_images(payload)

        fallback_payload = generate_wavespeed.call_args.kwargs["payload"]
        self.assertEqual(fallback_payload.provider, "wavespeed")
        self.assertEqual(fallback_payload.model, "google/nano-banana-pro/edit")


if __name__ == "__main__":
    unittest.main()