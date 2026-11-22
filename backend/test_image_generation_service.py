import unittest
from unittest.mock import MagicMock, patch

from schemas.image_generation import CreateImageRequest, CreateImageResponse
from services.image_generation_service import generate_provider_images

IMAGE = CreateImageResponse(model="any", images=["https://example.com/image.png"])


class WaveSpeedByDefaultTests(unittest.TestCase):
    @patch("services.image_generation_service.generate_wavespeed_images", return_value=IMAGE)
    @patch("services.image_generation_service.generate_images")
    def test_replicate_request_is_sent_to_wavespeed(self, generate_replicate: MagicMock, generate_wavespeed: MagicMock) -> None:
        with patch.dict("os.environ", {"IMAGE_PROVIDER": ""}):
            generate_provider_images(CreateImageRequest(model="nanobanana", provider="replicate", prompt="A space captain", aspect_ratio="21:9"))

        generate_replicate.assert_not_called()
        sent = generate_wavespeed.call_args.kwargs["payload"]
        self.assertEqual((sent.provider, sent.model, sent.aspect_ratio), ("wavespeed", "google/nano-banana-pro/text-to-image", "21:9"))

    @patch("services.image_generation_service.generate_wavespeed_images", return_value=IMAGE)
    @patch("services.image_generation_service.generate_images")
    def test_reference_request_uses_wavespeed_edit(self, generate_replicate: MagicMock, generate_wavespeed: MagicMock) -> None:
        with patch.dict("os.environ", {"IMAGE_PROVIDER": "wavespeed"}):
            generate_provider_images(CreateImageRequest(
                model="nanobanana", provider="replicate", prompt="A space captain",
                image_mapping={"reference": "https://example.com/reference.png"},
            ))

        generate_replicate.assert_not_called()
        self.assertEqual(generate_wavespeed.call_args.kwargs["payload"].model, "google/nano-banana-pro/edit")

    @patch("services.image_generation_service.generate_wavespeed_images", return_value=IMAGE)
    def test_wavespeed_model_ids_pass_through(self, generate_wavespeed: MagicMock) -> None:
        generate_provider_images(CreateImageRequest(model="openai/gpt-image-2/edit", provider="wavespeed", prompt="p", image_input=["https://example.com/a.png"]))

        self.assertEqual(generate_wavespeed.call_args.kwargs["payload"].model, "openai/gpt-image-2/edit")


class ReplicateOptOutTests(unittest.TestCase):
    @patch("services.image_generation_service.generate_wavespeed_images", return_value=IMAGE)
    @patch("services.image_generation_service.generate_images")
    def test_image_provider_replicate_retries_failures_on_wavespeed(self, generate_replicate: MagicMock, generate_wavespeed: MagicMock) -> None:
        generate_replicate.side_effect = RuntimeError("Request was throttled")
        with patch.dict("os.environ", {"IMAGE_PROVIDER": "replicate"}):
            response = generate_provider_images(CreateImageRequest(model="nanobanana", provider="replicate", prompt="A space captain"))

        generate_replicate.assert_called_once()
        self.assertEqual(response.images, ["https://example.com/image.png"])
        self.assertEqual(generate_wavespeed.call_args.kwargs["payload"].model, "google/nano-banana-pro/text-to-image")


if __name__ == "__main__":
    unittest.main()
