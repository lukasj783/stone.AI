import asyncio
import unittest
from io import BytesIO
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from PIL import Image

from schemas.image_generation import CreateImageResponse
from services import object_sheet as osh
from services.character_sheet import SheetReference, sheet_model_id
from services.project_visual_style import DEFAULT_VISUAL_STYLE

TAMUCOLA = {
    "id": "object-1", "name": "Tamucola", "description": None, "tags": [],
    "metadata": {"profile": {"size": "330 ml", "colors": "green glass, red label"}},
}


def _png() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (1920, 1080), (214, 214, 212)).save(buffer, format="PNG")
    return buffer.getvalue()


class PromptTests(unittest.TestCase):
    def test_prompt_asks_for_one_object_in_four_views_and_a_detail(self) -> None:
        prompt = osh.build_object_sheet_prompt("Tamucola: 330 ml; green glass")
        for word in ("front", "back", "side", "three-quarter", "close-up", "ONE"):
            self.assertIn(word, prompt)
        self.assertIn("Tamucola: 330 ml; green glass", prompt)
        self.assertIn("Image 1 is an empty grey canvas", prompt)

    def test_direction_is_included(self) -> None:
        prompt = osh.build_object_sheet_prompt("Tamucola", "Make the cap silver")
        self.assertIn("Make the cap silver", prompt)

    def test_reference_lines_follow_the_canvas(self) -> None:
        prompt = osh.build_object_sheet_prompt("Tamucola", references=[
            SheetReference("https://x/photo.png", "object"), SheetReference("https://x/art.png", "style"),
        ])
        self.assertIn("Image 2", prompt)
        self.assertIn("Image 3", prompt)
        self.assertNotIn("Image 4", prompt)

    def test_unknown_reference_tag_becomes_object(self) -> None:
        self.assertEqual(osh.normalize_object_reference_tag("face"), "object")
        self.assertEqual(osh.normalize_object_reference_tag(None), "object")
        self.assertEqual(osh.normalize_object_reference_tag(" Style "), "style")


class GenerateObjectSheetTests(unittest.TestCase):
    def _run(self, *, prop=TAMUCOLA, has_approved: bool = False, direction: str = "", references=None, model=None):
        supabase = MagicMock()
        supabase.table.return_value.insert.return_value.execute.return_value.data = [{"id": "job-1"}]
        with patch.object(osh, "load_object", return_value=prop), patch.object(
            osh, "require_supabase_client", return_value=supabase
        ), patch.object(
            osh, "generate_provider_images",
            return_value=CreateImageResponse(model="m", images=["https://provider/sheet.png"]),
        ) as provider, patch.object(osh, "_download", return_value=_png()), patch.object(
            osh, "_store_object_sheet_asset", return_value=("sheet-asset", "https://store/sheet.jpg")
        ), patch.object(osh, "_link") as link, patch.object(
            osh, "_has_approved_object_sheet", return_value=has_approved
        ), patch.object(osh, "approve_object_sheet", return_value={
            "approved": True, "sheet_asset_id": "sheet-asset", "sheet_url": "https://store/sheet.jpg",
        }) as approve, patch.object(osh, "blank_canvas_url", return_value="https://store/canvas.png"), patch.object(
            osh, "resolve_scene_visual_style", return_value=DEFAULT_VISUAL_STYLE
        ):
            result = osh.generate_object_sheet("project-1", "object-1", direction=direction, references=references, model=model)
        return result, provider, link, approve

    def test_name_only_object_is_refused(self) -> None:
        with patch.object(osh, "generate_provider_images") as provider:
            with self.assertRaises(ValueError) as raised:
                self._run(prop={"id": "object-1", "name": "Tamucola", "metadata": {}})
        self.assertIn("Describe the object", str(raised.exception))
        provider.assert_not_called()

    def test_name_only_object_with_a_reference_is_allowed(self) -> None:
        result, provider, _, _ = self._run(
            prop={"id": "object-1", "name": "Tamucola", "metadata": {}},
            references=[SheetReference("https://x/photo.png", "object")],
        )
        provider.assert_called_once()
        self.assertEqual(result["sheet_asset_id"], "sheet-asset")

    def test_first_sheet_is_approved_automatically(self) -> None:
        result, _, link, approve = self._run(has_approved=False)
        self.assertEqual(link.call_args.args[4], osh.OBJECT_CANDIDATE_ROLE)
        approve.assert_called_once()
        self.assertIs(result["approved"], True)

    def test_later_sheet_stays_a_candidate(self) -> None:
        result, _, _, approve = self._run(has_approved=True)
        approve.assert_not_called()
        self.assertIs(result["approved"], False)
        self.assertEqual(result["sheet_url"], "https://store/sheet.jpg")
        self.assertEqual(result["generation_job_id"], "job-1")

    def test_canvas_is_image_one_and_model_is_a_storyboard_model(self) -> None:
        references = [SheetReference("https://x/photo.png", "object")]
        _, provider, _, _ = self._run(references=references)
        payload = provider.call_args.args[0]
        self.assertEqual(payload.image_input, ["https://store/canvas.png", "https://x/photo.png"])
        self.assertEqual(payload.model, sheet_model_id(None))
        self.assertEqual(payload.aspect_ratio, "16:9")
        self.assertEqual(payload.resolution, "2k")
        self.assertEqual(payload.provider, "wavespeed")
        self.assertIn("Tamucola: 330 ml; green glass, red label", payload.prompt)

    def test_more_than_four_references_are_cut_to_four(self) -> None:
        references = [SheetReference(f"https://x/{index}.png", "object") for index in range(6)]
        _, provider, _, _ = self._run(references=references)
        self.assertEqual(len(provider.call_args.args[0].image_input), 1 + osh.MAX_OBJECT_REFERENCES)


class ApproveObjectSheetTests(unittest.TestCase):
    def test_approving_a_foreign_asset_fails(self) -> None:
        supabase = MagicMock()
        query = supabase.table.return_value.select.return_value
        query.eq.return_value = query
        query.limit.return_value = query
        query.execute.return_value.data = []
        with patch.object(osh, "require_supabase_client", return_value=supabase):
            with self.assertRaises(ValueError) as raised:
                osh.approve_object_sheet("project-1", "object-1", "someone-elses-asset")
        self.assertEqual(str(raised.exception), "That object sheet was not found for this object")
        supabase.table.return_value.update.assert_not_called()
        supabase.table.return_value.insert.assert_not_called()
        supabase.table.return_value.delete.assert_not_called()

    def test_approving_a_candidate_links_it_and_records_it_on_the_object(self) -> None:
        supabase = MagicMock()
        candidate = {"metadata": {"generation_job_id": "job-1", "direction": "silver cap", "model": "m",
                                  "references": [{"url": "https://x/p.png", "tag": "object"}]}}

        def table(name: str):
            mock = MagicMock()
            chain = mock.select.return_value
            chain.eq.return_value = chain
            chain.limit.return_value = chain
            chain.single.return_value = chain
            if name == "asset_links":
                chain.execute.return_value.data = [candidate]
            elif name == "assets":
                chain.execute.return_value.data = [{"url": "https://store/sheet.jpg"}]
            else:
                chain.execute.return_value.data = {"metadata": {"profile": {"size": "330 ml"}}}
            tables.setdefault(name, mock)
            return tables[name]

        tables: dict[str, MagicMock] = {}
        supabase.table.side_effect = table
        with patch.object(osh, "require_supabase_client", return_value=supabase), patch.object(osh, "_link") as link:
            result = osh.approve_object_sheet("project-1", "object-1", "sheet-asset")
        self.assertEqual(result, {"approved": True, "sheet_asset_id": "sheet-asset", "sheet_url": "https://store/sheet.jpg"})
        self.assertEqual(link.call_args.args[4], osh.OBJECT_SHEET_ROLE)
        self.assertIs(link.call_args.kwargs["replace"], True)
        values = tables["props"].update.call_args.args[0]
        self.assertNotIn("primary_asset_id", values, "an approved sheet leaves the gallery's main image alone")
        self.assertEqual(values["metadata"]["profile"], {"size": "330 ml"})
        sheet = values["metadata"]["object_sheet"]
        self.assertEqual(sheet["asset_id"], "sheet-asset")
        self.assertEqual(sheet["url"], "https://store/sheet.jpg")
        self.assertEqual(sheet["direction"], "silver cap")


class VersionsTests(unittest.TestCase):
    def test_versions_are_newest_first_and_mark_the_approved_one(self) -> None:
        supabase = MagicMock()

        def table(name: str):
            mock = MagicMock()
            chain = mock.select.return_value
            chain.eq.return_value = chain
            chain.in_.return_value = chain
            chain.order.return_value = chain
            if name == "asset_links":
                chain.execute.return_value.data = [
                    {"asset_id": "a1", "target_id": "object-1", "role": osh.OBJECT_CANDIDATE_ROLE, "created_at": "2026-11-01"},
                    {"asset_id": "a2", "target_id": "object-1", "role": osh.OBJECT_CANDIDATE_ROLE, "created_at": "2026-11-02"},
                    {"asset_id": "a1", "target_id": "object-1", "role": osh.OBJECT_SHEET_ROLE, "created_at": "2026-11-03"},
                    {"asset_id": "a9", "target_id": "object-2", "role": osh.OBJECT_CANDIDATE_ROLE, "created_at": "2026-11-04"},
                ]
            else:
                chain.execute.return_value.data = [{"id": "a1", "url": "https://s/1.jpg"}, {"id": "a2", "url": "https://s/2.jpg"}]
            return mock

        supabase.table.side_effect = lambda name: tables.setdefault(name, table(name))
        tables: dict[str, MagicMock] = {}
        with patch.object(osh, "require_supabase_client", return_value=supabase):
            versions = osh.object_sheet_versions("project-1", "object-1")
        self.assertEqual([version["asset_id"] for version in versions], ["a2", "a1"])
        self.assertEqual([version["approved"] for version in versions], [False, True])
        self.assertEqual(versions[0]["url"], "https://s/2.jpg")


class EndpointTests(unittest.TestCase):
    def test_name_only_object_is_a_400(self) -> None:
        from routers.text_to_image import generate_object_sheet_endpoint

        with patch("routers.text_to_image.generate_object_sheet", side_effect=ValueError("Describe the object first")):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(generate_object_sheet_endpoint(
                    project_id="project-1", object_id="object-1", prompt="", model=None,
                    visual_style=None, images=None, image_tags=None,
                ))
        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("Describe the object", raised.exception.detail)

    def test_approving_an_unknown_sheet_is_a_404(self) -> None:
        from routers.text_to_image import approve_object_sheet_endpoint
        from schemas.image_generation import ApproveObjectSheetRequest

        with patch("routers.text_to_image.approve_object_sheet", side_effect=ValueError("That object sheet was not found for this object")):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(approve_object_sheet_endpoint(ApproveObjectSheetRequest(
                    project_id="project-1", object_id="object-1", asset_id="nope",
                )))
        self.assertEqual(raised.exception.status_code, 404)

    def test_object_reference_tags_are_kept(self) -> None:
        from routers.text_to_image import _upload_references
        from services.object_sheet import normalize_object_reference_tag

        uploads = [MagicMock(filename="p.png", content_type="image/png"), MagicMock(filename="s.png", content_type="image/png")]
        for upload in uploads:
            upload.read = MagicMock(return_value=asyncio.sleep(0, result=b"img"))
        with patch("routers.text_to_image.upload_reference_image", side_effect=["https://u/p.png", "https://u/s.png"]):
            references = asyncio.run(_upload_references(uploads, ["object", "style"], normalize=normalize_object_reference_tag))
        self.assertEqual([reference.tag for reference in references], ["object", "style"])


class ObjectListResponseTests(unittest.TestCase):
    def test_response_carries_the_sheet_and_versions(self) -> None:
        from routers.story import _object_profile_response

        response = _object_profile_response(
            {"id": "o1", "name": "T", "metadata": {"object_sheet": {"asset_id": "a1", "url": "https://s/1.jpg"}}},
            sheet_versions=[{"asset_id": "a1", "url": "https://s/1.jpg", "approved": True, "created_at": "x"}],
        )
        self.assertEqual(response.sheet.asset_id, "a1")
        self.assertEqual(response.sheet.url, "https://s/1.jpg")
        self.assertEqual(len(response.sheet_versions), 1)
        self.assertIs(response.sheet_versions[0].approved, True)

    def test_object_without_sheet_has_none(self) -> None:
        from routers.story import _object_profile_response

        response = _object_profile_response({"id": "o1", "name": "T", "metadata": {}})
        self.assertIsNone(response.sheet)
        self.assertEqual(response.sheet_versions, [])


if __name__ == "__main__":
    unittest.main()
