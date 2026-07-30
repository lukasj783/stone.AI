import sys
from types import ModuleType
import unittest
from unittest.mock import MagicMock, patch


try:
    import supabase  # noqa: F401
except ModuleNotFoundError:
    supabase_stub = ModuleType("supabase")
    supabase_stub.Client = object
    supabase_stub.create_client = lambda *_args, **_kwargs: None
    sys.modules["supabase"] = supabase_stub

try:
    import replicate  # noqa: F401
except ModuleNotFoundError:
    replicate_stub = ModuleType("replicate")
    replicate_stub.Client = object
    sys.modules["replicate"] = replicate_stub

try:
    import wavespeed  # noqa: F401
except ModuleNotFoundError:
    wavespeed_stub = ModuleType("wavespeed")
    wavespeed_stub.Client = object
    sys.modules["wavespeed"] = wavespeed_stub

from schemas.image_generation import CreateImageResponse
from services.project_visual_style import resolve_visual_style
from services.storyboard_generation import regenerate_single_shot_frame


class StoryboardGenerationTests(unittest.TestCase):
    def test_anime_style_contract_excludes_photorealism(self) -> None:
        contract = resolve_visual_style("Anime")

        self.assertIn("2D cinematic anime", contract.prompt_block())
        self.assertIn("photorealistic", contract.prompt_block())

    @patch("services.storyboard_generation._persist_frame_image")
    @patch("services.storyboard_generation.generate_provider_images")
    @patch("services.storyboard_generation.get_supabase_client")
    def test_regeneration_creates_job_before_persisting_output(
        self,
        get_supabase_client: MagicMock,
        generate_provider_images: MagicMock,
        persist_frame_image: MagicMock,
    ) -> None:
        project_id = "project-id"
        shot_id = "shot-id"
        job_id = "job-id"
        shot = {
            "id": shot_id,
            "project_id": project_id,
            "scene_id": "scene-id",
            "shot_number": 1,
            "description": "A cinematic frame",
            "prompt": "Original prompt",
            "status": "complete",
            "sort_order": 0,
        }
        shot_query = MagicMock()
        shot_query.select.return_value = shot_query
        shot_query.eq.return_value = shot_query
        shot_query.single.return_value = shot_query
        shot_query.execute.return_value = MagicMock(data=shot)
        job_query = MagicMock()
        job_query.insert.return_value = job_query
        job_query.update.return_value = job_query
        job_query.eq.return_value = job_query
        job_query.execute.return_value = MagicMock(data=[{"id": job_id}])
        generic_query = MagicMock()
        generic_query.delete.return_value = generic_query
        generic_query.eq.return_value = generic_query
        generic_query.execute.return_value = MagicMock(data=[])
        idea_query = MagicMock()
        idea_query.select.return_value = idea_query
        idea_query.eq.return_value = idea_query
        idea_query.order.return_value = idea_query
        idea_query.limit.return_value = idea_query
        idea_query.maybe_single.return_value = idea_query
        idea_query.execute.return_value = MagicMock(data={"metadata": {"visualStyle": "Anime"}})
        supabase = MagicMock()
        supabase.table.side_effect = lambda table: {
            "shots": shot_query,
            "generation_jobs": job_query,
            "asset_links": generic_query,
            "project_documents": idea_query,
        }[table]
        get_supabase_client.return_value = supabase
        generate_provider_images.return_value = CreateImageResponse(
            model="nanobanana",
            images=["https://example.com/frame.jpg"],
        )
        persist_frame_image.return_value = "https://example.com/stored-frame.jpg"

        frame = regenerate_single_shot_frame(project_id, shot_id)

        self.assertEqual(frame.image_url, "https://example.com/stored-frame.jpg")
        self.assertEqual(job_query.insert.call_args.args[0]["shot_id"], shot_id)
        self.assertEqual(persist_frame_image.call_args.args[2], job_id)
        self.assertIn("2D cinematic anime", generate_provider_images.call_args.args[0].prompt)
        self.assertIn("photorealistic", generate_provider_images.call_args.args[0].prompt)


if __name__ == "__main__":
    unittest.main()