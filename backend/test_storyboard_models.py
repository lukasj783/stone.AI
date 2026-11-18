import unittest
from unittest import mock

from schemas.image_generation import CreateImageRequest, GenerateStoryboardRequest, RegenerateShotFrameRequest
from services import storyboard_generation as sg
from services import wavespeed_service
from services.storyboard_models import (
    DEFAULT_STORYBOARD_MODEL,
    STORYBOARD_MODELS,
    TEXT_ONLY_FALLBACK_MODEL,
    storyboard_model,
)

REFS = [f"https://img.test/{index}.png" for index in range(20)]


class RegistryTests(unittest.TestCase):
    def test_all_requested_models_are_listed(self) -> None:
        self.assertEqual(set(STORYBOARD_MODELS), {
            "openai/gpt-image-2.5-sunburst/edit",
            "openai/gpt-image-2.6-sunburst/edit",
            "openai/gpt-image-2.6-flare/edit",
            "google/nano-banana-2.1/edit",
            "google/nano-banana-2/edit",
            "bytedance/seedream-v5.0-lite/edit",
            "bytedance/seedream-v5.0-flash/edit",
            "bytedance/seedream-v5.5/edit",
        })
        self.assertEqual(DEFAULT_STORYBOARD_MODEL, "google/nano-banana-2/edit")

    def test_default_is_wavespeed_in_request_schemas(self) -> None:
        request = GenerateStoryboardRequest(project_id="p", scene_id="s")
        self.assertEqual((request.provider, request.model), ("wavespeed", DEFAULT_STORYBOARD_MODEL))
        regenerate = RegenerateShotFrameRequest(project_id="p", shot_id="s")
        self.assertEqual((regenerate.provider, regenerate.model), ("wavespeed", DEFAULT_STORYBOARD_MODEL))

    def test_nano_banana_params(self) -> None:
        params = storyboard_model("google/nano-banana-2/edit").build_params("shot", REFS, "16:9", "1k", "jpg")
        self.assertEqual(len(params["images"]), 14)
        self.assertEqual(
            {key: params[key] for key in ("aspect_ratio", "resolution", "output_format")},
            {"aspect_ratio": "16:9", "resolution": "1k", "output_format": "jpeg"},
        )
        self.assertFalse(params["enable_sync_mode"])

    def test_nano_banana_21_matches_wavespeed_example(self) -> None:
        model = storyboard_model("google/nano-banana-2.1/edit")
        params = model.build_params("shot", REFS[:2], "16:9", "1k", "png")
        self.assertTrue(model.verified)
        self.assertEqual(
            {key: params[key] for key in ("aspect_ratio", "resolution", "output_format", "enable_web_search", "enable_image_search")},
            {"aspect_ratio": "16:9", "resolution": "1k", "output_format": "png", "enable_web_search": False, "enable_image_search": False},
        )

    def test_gpt_image_26_models_match_wavespeed_examples(self) -> None:
        for model_id in ("openai/gpt-image-2.6-sunburst/edit", "openai/gpt-image-2.6-flare/edit"):
            model = storyboard_model(model_id)
            params = model.build_params("shot", REFS, "16:9", "1k", "png")
            self.assertTrue(model.verified, model_id)
            self.assertEqual(len(params["images"]), 16)
            self.assertEqual((params["quality"], params["complexity"], params["output_format"]), ("medium", "high", "png"))
            self.assertNotIn("frame_count", params)  # animation setting from the examples, not wanted for stills
            self.assertNotIn("frame_duration_ms", params)

    def test_every_storyboard_model_is_confirmed(self) -> None:
        self.assertEqual([model.id for model in STORYBOARD_MODELS.values() if not model.verified], [])

    def test_gpt_image_params(self) -> None:
        params = storyboard_model("openai/gpt-image-2.5-sunburst/edit").build_params("shot", REFS, "21:9", "8k", "webp")
        self.assertEqual(len(params["images"]), 16)
        self.assertEqual((params["aspect_ratio"], params["resolution"], params["output_format"]), ("16:9", "1k", "webp"))

    def test_seedream_v55_matches_wavespeed_example(self) -> None:
        model = storyboard_model("bytedance/seedream-v5.5/edit")
        params = model.build_params("shot", REFS[:3], "16:9", "1k", "png")
        self.assertTrue(model.verified)
        self.assertEqual(
            {key: params[key] for key in ("aspect_ratio", "resolution", "output_format", "background")},
            {"aspect_ratio": "16:9", "resolution": "1k", "output_format": "png", "background": "auto"},
        )
        self.assertNotIn("size", params)

    def test_seedream_uses_pixel_size(self) -> None:
        params = storyboard_model("bytedance/seedream-v5.0-lite/edit").build_params("shot", REFS[:3], "16:9", "1k", "jpg")
        self.assertEqual(params["size"], "2560*1440")
        self.assertEqual(params["output_format"], "jpeg")
        self.assertNotIn("aspect_ratio", params)
        self.assertNotIn("resolution", params)

    def test_seedream_lite_matches_wavespeed_example(self) -> None:
        params = storyboard_model("bytedance/seedream-v5.0-lite/edit").build_params("p", REFS[:1], None, None, "jpeg")
        self.assertTrue(storyboard_model("bytedance/seedream-v5.0-lite/edit").verified)
        self.assertEqual((params["prompt"], params["images"], params["output_format"]), ("p", REFS[:1], "jpeg"))

    def test_seedream_flash_matches_wavespeed_example(self) -> None:
        model = storyboard_model("bytedance/seedream-v5.0-flash/edit")
        params = model.build_params("shot", REFS[:2], "16:9", "1k", "jpeg")
        self.assertTrue(model.verified)
        self.assertEqual((params["aspect_ratio"], params["resolution"], params["output_format"]), ("16:9", "1k", "jpeg"))
        self.assertNotIn("size", params)
        self.assertNotIn("background", params)

    def test_unknown_model_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            storyboard_model("replicate/whatever")
        self.assertEqual(storyboard_model(None).id, DEFAULT_STORYBOARD_MODEL)


class StoryboardRequestTests(unittest.TestCase):
    def test_shot_with_references_uses_chosen_edit_model(self) -> None:
        request = sg._storyboard_image_request("wavespeed", "bytedance/seedream-v5.5/edit", "p", REFS[:2], "proj")
        self.assertEqual((request.model, request.provider, request.image_input), ("bytedance/seedream-v5.5/edit", "wavespeed", REFS[:2]))

    def test_shot_without_references_falls_back_to_text_model(self) -> None:
        request = sg._storyboard_image_request("wavespeed", "openai/gpt-image-2.5-sunburst/edit", "p", [], "proj")
        self.assertEqual((request.model, request.image_input), (TEXT_ONLY_FALLBACK_MODEL, None))

    def test_unknown_wavespeed_model_fails_before_generation(self) -> None:
        with self.assertRaises(ValueError):
            sg._storyboard_image_request("wavespeed", "nanobanana", "p", REFS[:1], "proj")

    def test_replicate_still_accepted_when_asked_for(self) -> None:
        request = sg._storyboard_image_request("replicate", "nanobanana", "p", [], "proj")
        self.assertEqual((request.model, request.provider), ("nanobanana", "replicate"))


class WaveSpeedCallTests(unittest.TestCase):
    def test_registry_model_sends_its_own_params(self) -> None:
        client = mock.Mock()
        client.run.return_value = {"outputs": ["https://out.test/frame.png"]}
        with mock.patch.object(wavespeed_service, "_create_wavespeed_client", return_value=client):
            response = wavespeed_service.generate_wavespeed_images(CreateImageRequest(
                model="openai/gpt-image-2.6-flare/edit", provider="wavespeed", prompt="A frame",
                aspect_ratio="16:9", resolution="1k", output_format="jpg", image_input=REFS[:3],
            ))
        model, params = client.run.call_args.args
        self.assertEqual(model, "openai/gpt-image-2.6-flare/edit")
        self.assertEqual(params["images"], REFS[:3])
        self.assertEqual((params["aspect_ratio"], params["output_format"]), ("16:9", "jpeg"))
        self.assertEqual(response.images, ["https://out.test/frame.png"])


if __name__ == "__main__":
    unittest.main()


class FrameEncodingTests(unittest.TestCase):
    def test_png_frames_become_bounded_jpegs(self) -> None:
        import io
        from PIL import Image
        buffer = io.BytesIO()
        Image.new("RGB", (2752, 1536), (40, 60, 110)).save(buffer, "PNG")
        out, width, height = sg._storyboard_frame_jpeg(buffer.getvalue())
        with Image.open(io.BytesIO(out)) as decoded:
            self.assertEqual(decoded.format, "JPEG")
        self.assertEqual((width, height), (1920, 1072))

    def test_small_frames_are_not_upscaled(self) -> None:
        import io
        from PIL import Image
        buffer = io.BytesIO()
        Image.new("RGBA", (1344, 768), (0, 0, 0, 0)).save(buffer, "PNG")
        _, width, height = sg._storyboard_frame_jpeg(buffer.getvalue())
        self.assertEqual((width, height), (1344, 768))

    def test_undecodable_bytes_are_kept(self) -> None:
        self.assertEqual(sg._storyboard_frame_jpeg(b"not an image"), (b"not an image", None, None))
