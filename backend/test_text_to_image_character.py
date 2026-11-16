import asyncio
import unittest
from unittest.mock import MagicMock, patch

from routers.text_to_image import generate_character_images, generate_script_character_images
from schemas.image_generation import (
    CharacterView,
    CreateImageRequest,
    CreateImageResponse,
    GenerateScriptCharacterRequest,
)
from services.character_views import build_character_view_prompt, build_script_character_profile
from services.project_visual_style import DEFAULT_VISUAL_STYLE


class TextToImageCharacterTests(unittest.TestCase):
    def test_script_profile_keeps_structured_facts_when_image_prompt_exists(self) -> None:
        profile = build_script_character_profile({
            "name": "Mara Voss",
            "role": "Station engineer",
            "age": 42,
            "gender": "woman",
            "race": "Latina",
            "appearance": "Short silver-streaked hair",
            "personality": "Pragmatic",
            "metadata": {"image_prompt": "Wears a patched orange flight jacket."},
        })

        self.assertIn("- Role: Station engineer", profile)
        self.assertIn("- Age: 42", profile)
        self.assertIn("- Gender: woman", profile)
        self.assertIn("- Race: Latina", profile)
        self.assertIn("Do not change or contradict", profile)
        self.assertIn("Wears a patched orange flight jacket.", profile)

    def test_profile_prompts_describe_opposite_subject_directions(self) -> None:
        left_prompt = build_character_view_prompt("A brave knight", CharacterView.left_profile).lower()
        right_prompt = build_character_view_prompt("A brave knight", CharacterView.right_profile).lower()

        self.assertIn("facing left", left_prompt)
        self.assertIn("camera viewing the character's left side", left_prompt)
        self.assertIn("facing right", right_prompt)
        self.assertIn("camera viewing the character's right side", right_prompt)
        self.assertIn("do not mirror or flip", left_prompt)
        self.assertNotEqual(left_prompt, right_prompt)

    def test_script_generation_sends_canonical_facts_to_every_view(self) -> None:
        character = {
            "id": "character-123",
            "name": "Mara Voss",
            "role": "Station engineer",
            "age": 42,
            "gender": "woman",
            "race": "Latina",
            "appearance": "Short silver-streaked hair",
            "personality": "Pragmatic",
            "metadata": {"source": "script", "image_prompt": "Wears a patched orange flight jacket."},
        }
        provider_responses = [
            CreateImageResponse(model="nanobanana", images=[f"https://example.com/{index}.png"])
            for index in range(6)
        ]
        with patch("routers.text_to_image.load_script_character", return_value=character), patch(
            "routers.text_to_image.resolve_scene_visual_style", return_value=DEFAULT_VISUAL_STYLE
        ), patch(
            "routers.text_to_image.generate_provider_images", side_effect=provider_responses
        ) as generate_provider, patch(
            "routers.text_to_image.persist_character_generation",
            side_effect=lambda project_id, payload, keyframes: ("job-123", keyframes),
        ), patch("routers.text_to_image.attach_generation_to_character"):
            response = asyncio.run(generate_script_character_images(GenerateScriptCharacterRequest(
                project_id="project-123",
                character_id="character-123",
                model="nanobanana",
                seed=1234,
            )))

        self.assertEqual(len(response.keyframes or []), 6)
        self.assertEqual(generate_provider.call_count, 6)
        for call in generate_provider.call_args_list:
            prompt = call.args[0].prompt
            self.assertIn("- Role: Station engineer", prompt)
            self.assertIn("- Age: 42", prompt)
            self.assertIn("- Gender: woman", prompt)
            self.assertIn("- Race: Latina", prompt)
            self.assertIn("Do not change or contradict", prompt)
            self.assertIn("Photorealistic live-action", prompt)

    @patch("routers.text_to_image.persist_character_generation")
    @patch("routers.text_to_image.generate_provider_images")
    @patch("routers.text_to_image.resolve_scene_visual_style", return_value=DEFAULT_VISUAL_STYLE)
    def test_character_generation_requests_six_ordered_views(
        self,
        resolve_scene_visual_style: MagicMock,
        generate_provider: MagicMock,
        persist_generation: MagicMock,
    ) -> None:
        generate_provider.side_effect = [
            CreateImageResponse(model="nanobanana", images=[f"https://example.com/{index}.png"])
            for index in range(6)
        ]
        payload = CreateImageRequest(
            model="nanobanana",
            provider="replicate",
            prompt="A brave knight",
            seed=1234,
            project_id="project-123",
        )
        persist_generation.side_effect = lambda project_id, persisted_payload, keyframes: (
            "job-123",
            keyframes,
        )

        response = asyncio.run(generate_character_images(payload))

        self.assertEqual(generate_provider.call_count, 6)
        persist_generation.assert_called_once()
        self.assertEqual(response.generation_job_id, "job-123")
        self.assertEqual(len(response.images), 6)
        self.assertEqual(
            [keyframe.view.value for keyframe in response.keyframes or []],
            [
                "front",
                "left_three_quarter",
                "left_profile",
                "back",
                "right_profile",
                "right_three_quarter",
            ],
        )
        self.assertEqual({call.args[0].seed for call in generate_provider.call_args_list}, {1234})
        self.assertTrue(all(call.args[0].num_images == 1 for call in generate_provider.call_args_list))
        self.assertTrue(all("Do not create a collage" in call.args[0].prompt for call in generate_provider.call_args_list))
        self.assertTrue(all("Photorealistic live-action" in call.args[0].prompt for call in generate_provider.call_args_list))


if __name__ == "__main__":
    unittest.main()