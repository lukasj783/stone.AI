import unittest
from unittest.mock import MagicMock, patch

from schemas.image_generation import CreateImageRequest
from services.storyboard_models import GPT_IMAGE_EDIT_MODEL
from services.wavespeed_service import WaveSpeedServiceError, generate_wavespeed_images


def _payload(model: str = GPT_IMAGE_EDIT_MODEL, **extra) -> CreateImageRequest:
    return CreateImageRequest(
        model=model,
        provider="wavespeed",
        prompt="Put the character in silver armor.",
        **extra,
    )


class GPTImageEditTests(unittest.TestCase):
    """The GPT Image edit model (the same one storyboards use) through the generic WaveSpeed path."""

    def test_uses_the_storyboard_gpt_model(self) -> None:
        self.assertEqual(GPT_IMAGE_EDIT_MODEL, "openai/gpt-image-2.6-sunburst/edit")

    @patch("services.wavespeed_service._create_wavespeed_client")
    def test_sends_documented_edit_parameters(self, create_client: MagicMock) -> None:
        client = create_client.return_value
        client.run.return_value = {"outputs": ["https://example.com/edited.png"]}

        response = generate_wavespeed_images(_payload(
            aspect_ratio="1:1",
            resolution="1K",
            output_format="png",
            num_images=4,
            image_mapping={"reference": "https://example.com/reference.png"},
        ))

        self.assertEqual(response.images, ["https://example.com/edited.png"])
        model, params = client.run.call_args.args
        self.assertEqual(model, GPT_IMAGE_EDIT_MODEL)
        self.assertEqual(params["images"], ["https://example.com/reference.png"])
        self.assertEqual(params["resolution"], "1k")
        self.assertEqual(params["quality"], "medium")
        self.assertEqual(params["complexity"], "high")
        self.assertEqual(params["aspect_ratio"], "1:1")
        self.assertNotIn("num_images", params)

    @patch("services.wavespeed_service._create_wavespeed_client")
    def test_old_gpt_image_2_id_is_upgraded(self, create_client: MagicMock) -> None:
        client = create_client.return_value
        client.run.return_value = {"outputs": ["https://example.com/edited.png"]}

        response = generate_wavespeed_images(_payload(
            model="openai/gpt-image-2/edit",
            image_mapping={"reference": "https://example.com/reference.png"},
        ))

        self.assertEqual(client.run.call_args.args[0], GPT_IMAGE_EDIT_MODEL)
        self.assertEqual(response.model, GPT_IMAGE_EDIT_MODEL)

    @patch("services.wavespeed_service._create_wavespeed_client")
    def test_waits_a_bounded_time_for_the_image(self, create_client: MagicMock) -> None:
        # Without a limit the SDK polls forever and allows 10 hours per HTTP read.
        client = create_client.return_value
        client.run.return_value = {"outputs": ["https://example.com/edited.png"]}

        generate_wavespeed_images(_payload(image_mapping={"reference": "https://example.com/reference.png"}))

        self.assertEqual(client.run.call_args.kwargs["timeout"], 600.0)

    @patch.dict("os.environ", {"WAVESPEED_IMAGE_TIMEOUT_SECONDS": "90"})
    @patch("services.wavespeed_service._create_wavespeed_client")
    def test_image_wait_limit_can_be_configured(self, create_client: MagicMock) -> None:
        client = create_client.return_value
        client.run.return_value = {"outputs": ["https://example.com/edited.png"]}

        generate_wavespeed_images(_payload(image_mapping={"reference": "https://example.com/reference.png"}))

        self.assertEqual(client.run.call_args.kwargs["timeout"], 90.0)

    def test_requires_an_input_image(self) -> None:
        with self.assertRaises(WaveSpeedServiceError):
            generate_wavespeed_images(_payload())


if __name__ == "__main__":
    unittest.main()
