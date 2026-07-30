import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from routers.image_to_image import GPT_IMAGE_2_EDIT_MODEL, generate_from_upload
from schemas.image_generation import CreateImageRequest, CreateImageResponse
from services.wavespeed_service import WaveSpeedServiceError, generate_wavespeed_images


class FakeUpload:
    content_type = "image/png"

    async def read(self) -> bytes:
        return b"reference-image"


class GPTImage2EditTests(unittest.IsolatedAsyncioTestCase):
    @patch("services.wavespeed_service._create_wavespeed_client")
    def test_sends_documented_edit_parameters(self, create_client: MagicMock) -> None:
        client = create_client.return_value
        client.run.return_value = {"outputs": ["https://example.com/edited.png"]}
        payload = CreateImageRequest(
            model=GPT_IMAGE_2_EDIT_MODEL,
            provider="wavespeed",
            prompt="Put the character in silver armor.",
            aspect_ratio="1:1",
            resolution="1K",
            output_format="png",
            num_images=4,
            image_mapping={"reference": "https://example.com/reference.png"},
        )

        response = generate_wavespeed_images(payload)

        self.assertEqual(response.images, ["https://example.com/edited.png"])
        model, params = client.run.call_args.args
        self.assertEqual(model, GPT_IMAGE_2_EDIT_MODEL)
        self.assertEqual(params["images"], ["https://example.com/reference.png"])
        self.assertEqual(params["resolution"], "1k")
        self.assertEqual(params["quality"], "medium")
        self.assertEqual(params["aspect_ratio"], "1:1")
        self.assertNotIn("num_images", params)

    def test_requires_an_input_image(self) -> None:
        payload = CreateImageRequest(
            model=GPT_IMAGE_2_EDIT_MODEL,
            provider="wavespeed",
            prompt="Put the character in silver armor.",
        )

        with self.assertRaises(WaveSpeedServiceError):
            generate_wavespeed_images(payload)

    async def test_upload_route_requires_gpt_guidance(self) -> None:
        with self.assertRaises(HTTPException) as context:
            await generate_from_upload(
                image=FakeUpload(),
                guidance_prompt="",
                model=GPT_IMAGE_2_EDIT_MODEL,
                provider="wavespeed",
            )

        self.assertEqual(context.exception.status_code, 400)

    @patch("routers.image_to_image.generate_provider_images")
    @patch("routers.image_to_image.get_supabase_client")
    async def test_upload_route_returns_provider_outputs_without_splitting(
        self,
        get_supabase_client: MagicMock,
        generate_provider: MagicMock,
    ) -> None:
        bucket = MagicMock()
        bucket.get_public_url.return_value = "https://example.com/reference.png"
        get_supabase_client.return_value.storage.from_.return_value = bucket
        generate_provider.return_value = CreateImageResponse(
            model=GPT_IMAGE_2_EDIT_MODEL,
            images=["https://example.com/edited-a.png", "https://example.com/edited-b.png"],
        )

        response = await generate_from_upload(
            image=FakeUpload(),
            guidance_prompt="Put the character in silver armor.",
            model=GPT_IMAGE_2_EDIT_MODEL,
            provider="wavespeed",
        )

        self.assertEqual(
            response.images,
            ["https://example.com/edited-a.png", "https://example.com/edited-b.png"],
        )
        generate_provider.assert_called_once()


if __name__ == "__main__":
    unittest.main()