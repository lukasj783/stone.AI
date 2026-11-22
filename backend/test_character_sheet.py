import asyncio
import unittest
from io import BytesIO
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from PIL import Image, ImageDraw

from routers.text_to_image import generate_character_sheet
from schemas.image_generation import CreateImageResponse
from services import character_sheet as cs
from services import sheet_review as sr
from services.project_visual_style import DEFAULT_VISUAL_STYLE

BACKGROUND = (214, 214, 212)
CHARACTER = {
    "id": "character-1", "name": "Mara Voss", "role": "Station engineer", "age": 42, "gender": "woman",
    "appearance": "Short silver-streaked hair", "metadata": {"source": "script"},
}


def draw_sheet(width: int = 1920, height: int = 1080) -> Image.Image:
    """A face close-up blob in the left third and four full-body figures on the right."""
    image = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(image)
    draw.ellipse((150, 160, 500, 620), fill=(190, 140, 110))  # head
    draw.rectangle((110, 620, 540, 900), fill=(60, 60, 120))  # shoulders
    for index in range(4):
        left = 760 + index * 280
        draw.rectangle((left, 120, left + 150, 980), fill=(40 + index * 40, 90, 80))
    return image


def _png(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class PromptTests(unittest.TestCase):
    def test_prompt_lists_tagged_references_in_order_with_direction(self) -> None:
        prompt = cs.build_model_sheet_prompt("- Name: Mara", "Give her a scar over the left eye", [
            cs.SheetReference("https://x/face.png", "face"),
            cs.SheetReference("https://x/coat.png", "outfit"),
            cs.SheetReference("https://x/art.png", "style"),
        ])
        face, outfit, style = (prompt.index(f"Image {index}:") for index in (2, 3, 4))
        self.assertLess(face, outfit)
        self.assertLess(outfit, style)
        self.assertIn("Image 1 is an empty grey canvas", prompt)
        self.assertIn("Image 2: use this person's face", prompt)
        self.assertIn("Image 4: use only the art style", prompt)
        self.assertIn("Give her a scar over the left eye", prompt)
        self.assertIn("face close-up", prompt)
        self.assertIn("back view", prompt)
        self.assertIn("No text", prompt)

    def test_prompt_without_references_has_no_reference_section(self) -> None:
        self.assertNotIn("Reference images", cs.build_model_sheet_prompt("- Name: Mara"))

    def test_unknown_tags_default_to_face(self) -> None:
        self.assertEqual(cs.normalize_reference_tag("Outfit "), "outfit")
        self.assertEqual(cs.normalize_reference_tag("hair"), "face")
        self.assertEqual(cs.normalize_reference_tag(None), "face")

    def test_character_without_facts_needs_a_prompt_or_reference(self) -> None:
        blank = {"name": "Clerk", "metadata": {"source": "script"}}
        with self.assertRaises(ValueError):
            cs.character_block_for(blank, DEFAULT_VISUAL_STYLE, "", False)
        self.assertIn("Clerk", cs.character_block_for(blank, DEFAULT_VISUAL_STYLE, "Tired night clerk", False))
        self.assertIn("Clerk", cs.character_block_for(blank, DEFAULT_VISUAL_STYLE, "", True))


class FaceCropTests(unittest.TestCase):
    def test_face_box_holds_the_close_up_and_not_the_turnaround(self) -> None:
        sheet = draw_sheet()
        left, top, right, bottom = cs.face_panel_box(sheet)
        self.assertLessEqual(left, 110)
        self.assertGreaterEqual(right, 540)
        self.assertLess(right, 760, "the first turnaround figure must stay out of the face crop")
        self.assertLessEqual(top, 160)
        self.assertAlmostEqual((right - left) / (bottom - top), 3 / 4, delta=0.02)

    def test_busy_sheet_falls_back_to_the_left_panel(self) -> None:
        noisy = Image.effect_noise((1920, 1080), 120).convert("RGB")
        left, top, right, bottom = cs.face_panel_box(noisy)
        self.assertGreaterEqual(left, 0)
        self.assertLessEqual(right, int(1920 * cs.FACE_PANEL_SHARE) + 1)
        self.assertAlmostEqual((right - left) / (bottom - top), 3 / 4, delta=0.02)


PASSING_REVIEW = sr.SheetReview(ok=True, method="vision", face_closeup=True, views=list(sr.REQUIRED_VIEWS), face_box=[100, 50, 800, 300])


class GenerateModelSheetTests(unittest.TestCase):
    def _run(self, has_approved: bool, references: list[cs.SheetReference] | None = None, model: str | None = None):
        supabase = MagicMock()
        supabase.table.return_value.insert.return_value.execute.return_value.data = [{"id": "job-1"}]
        with patch.object(cs, "load_project_character", return_value=CHARACTER), patch.object(
            cs, "require_supabase_client", return_value=supabase
        ), patch.object(
            cs, "generate_provider_images",
            return_value=CreateImageResponse(model="nanobanana", images=["https://provider/sheet.png"]),
        ) as provider, patch.object(cs, "_download", return_value=_png(draw_sheet())), patch.object(
            cs, "_store_image_asset", return_value=("sheet-asset", "https://store/sheet.png")
        ), patch.object(cs, "_link") as link, patch.object(
            cs, "_has_approved_sheet", return_value=has_approved
        ), patch.object(cs, "approve_model_sheet", return_value={
            "approved": True, "face_closeup_asset_id": "face-asset", "face_closeup_url": "https://store/face.png",
        }) as approve, patch.object(cs, "review_sheet", return_value=PASSING_REVIEW), patch.object(
            cs, "blank_canvas_url", return_value="https://store/canvas.png"
        ):
            result = cs.generate_model_sheet("project-1", "character-1", direction="Older", references=references, model=model)
        return result, provider, link, approve

    def test_first_sheet_is_approved_automatically(self) -> None:
        result, provider, link, approve = self._run(has_approved=False)
        payload = provider.call_args.args[0]
        self.assertEqual(payload.aspect_ratio, "16:9")
        self.assertEqual(payload.provider, "wavespeed")
        self.assertEqual(payload.model, "google/nano-banana-2/edit")
        self.assertEqual(payload.image_input, ["https://store/canvas.png"], "prompt-only sheets still give the edit model its canvas")
        self.assertIn("- Role: Station engineer", payload.prompt)
        self.assertEqual(link.call_args.args[4], cs.CANDIDATE_ROLE)
        approve.assert_called_once()
        self.assertTrue(result["approved"])
        self.assertEqual(result["face_closeup_url"], "https://store/face.png")

    def test_later_sheets_stay_candidates(self) -> None:
        result, _, _, approve = self._run(has_approved=True)
        approve.assert_not_called()
        self.assertFalse(result["approved"])
        self.assertEqual(result["sheet_url"], "https://store/sheet.png")

    def test_references_are_sent_in_order(self) -> None:
        references = [cs.SheetReference("https://x/face.png", "face"), cs.SheetReference("https://x/coat.png", "outfit")]
        _, provider, _, _ = self._run(has_approved=True, references=references, model="openai/gpt-image-2.6-sunburst/edit")
        payload = provider.call_args.args[0]
        self.assertEqual(payload.image_input, ["https://store/canvas.png", "https://x/face.png", "https://x/coat.png"])
        self.assertEqual(payload.model, "openai/gpt-image-2.6-sunburst/edit")
        self.assertEqual(payload.provider, "wavespeed")

    def test_replicate_and_unknown_models_are_rejected(self) -> None:
        for model in ("nanobanana", "nanobanana2", "google/nano-banana-pro/text-to-image"):
            with self.assertRaises(ValueError):
                cs.sheet_model_id(model)
        self.assertEqual(cs.sheet_model_id(None), "google/nano-banana-2/edit")
        self.assertEqual(cs.sheet_model_id("bytedance/seedream-v5.5/edit"), "bytedance/seedream-v5.5/edit")


class DraftSheetTests(unittest.TestCase):
    def test_draft_needs_a_description_or_reference(self) -> None:
        with self.assertRaises(ValueError):
            cs.draft_model_sheet("project-1", description="  ")

    def test_draft_prompt_uses_the_description_and_records_it(self) -> None:
        with patch.object(cs, "_render_sheet", return_value=("sheet-asset", "https://store/sheet.png", None, {"generation_job_id": "job-1", "review": {"ok": True}})) as render:
            result = cs.draft_model_sheet("project-1", description="A courier in a red raincoat")
        prompt = render.call_args.args[3]
        self.assertIn("Character description:\nA courier in a red raincoat", prompt)
        self.assertIn("face close-up", prompt)
        self.assertTrue(render.call_args.kwargs["settings"]["draft"])
        self.assertEqual(render.call_args.kwargs["settings"]["direction"], "A courier in a red raincoat")
        self.assertEqual(result["sheet_asset_id"], "sheet-asset")
        self.assertEqual(result["review"], {"ok": True})

    def _supabase_with_asset(self, metadata: dict | None) -> MagicMock:
        supabase = MagicMock()
        assets = supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value
        assets.data = [] if metadata is None else [{"id": "sheet-asset", "metadata": metadata}]
        supabase.table.return_value.insert.return_value.execute.return_value.data = [{"id": "character-9"}]
        return supabase

    def test_saving_a_draft_creates_the_character_and_approves_the_sheet(self) -> None:
        supabase = self._supabase_with_asset({"kind": "model_sheet", "draft": True, "visual_style": "Realistic", "direction": "Courier"})
        with patch.object(cs, "require_supabase_client", return_value=supabase), patch.object(cs, "_link") as link, patch.object(
            cs, "approve_model_sheet", return_value={"approved": True, "sheet_asset_id": "sheet-asset"}
        ) as approve:
            result = cs.create_character_from_sheet("project-1", "sheet-asset", " Rook ", "Courier", "Red raincoat")
        inserted = supabase.table.return_value.insert.call_args.args[0]
        self.assertEqual(inserted["name"], "Rook")
        self.assertEqual(inserted["metadata"], {"source": "manual", "visual_style": "Realistic"})
        self.assertEqual(link.call_args.args[4], cs.CANDIDATE_ROLE)
        self.assertNotIn("draft", link.call_args.args[5])
        approve.assert_called_once_with("project-1", "character-9", "sheet-asset")
        self.assertEqual(result["character_id"], "character-9")

    def test_only_draft_sheets_can_be_saved(self) -> None:
        for metadata in (None, {"kind": "model_sheet"}, {"kind": "face_closeup", "draft": True}):
            with patch.object(cs, "require_supabase_client", return_value=self._supabase_with_asset(metadata)):
                with self.assertRaises(ValueError):
                    cs.create_character_from_sheet("project-1", "sheet-asset", "Rook")


def draw_portrait(width: int = 1920, height: int = 1080) -> Image.Image:
    """What an edit model returns when it just retouches the reference: one person, no turnaround."""
    image = Image.new("RGB", (width, height), BACKGROUND)
    ImageDraw.Draw(image).ellipse((700, 100, 1200, 1000), fill=(190, 140, 110))
    return image


class RenderRetryTests(unittest.TestCase):
    def _render(self, reviews: list[sr.SheetReview]):
        supabase = MagicMock()
        supabase.table.return_value.insert.return_value.execute.return_value.data = [{"id": "job-1"}]
        with patch.object(cs, "require_supabase_client", return_value=supabase), patch.object(
            cs, "generate_provider_images",
            return_value=CreateImageResponse(model="nanobanana", images=["https://provider/sheet.png"]),
        ) as provider, patch.object(cs, "_download", return_value=_png(draw_sheet())), patch.object(
            cs, "_store_image_asset", return_value=("sheet-asset", "https://store/sheet.png")
        ) as store, patch.object(cs, "review_sheet", side_effect=reviews), patch.object(
            cs, "blank_canvas_url", return_value="https://store/canvas.png"
        ), patch.dict("os.environ", {"CHARACTER_SHEET_ATTEMPTS": "3"}):
            try:
                result = cs._render_sheet(
                    "project-1", "character-1", "Mara", "BASE PROMPT", [cs.SheetReference("https://x/face.png", "face")],
                    model="google/nano-banana-2/edit", style_label="Realistic", settings={},
                )
            except cs.SheetIncompleteError as error:
                return None, error, provider, store, supabase
        return result, None, provider, store, supabase

    def test_rejected_sheet_is_regenerated_with_the_problems_named(self) -> None:
        missing_back = sr.SheetReview(ok=False, method="vision", face_closeup=True, views=["front"], problems=["missing back view"])
        result, error, provider, store, _ = self._render([missing_back, PASSING_REVIEW])
        self.assertIsNone(error)
        self.assertEqual(provider.call_count, 2)
        first, second = (call.args[0].prompt for call in provider.call_args_list)
        self.assertEqual(first, "BASE PROMPT")
        self.assertIn("rejected because it missing back view", second)
        self.assertIn("four full-body figures", second)
        self.assertEqual(result[3]["review"]["face_box"], [100, 50, 800, 300])
        self.assertEqual(result[3]["attempts"], 2)
        self.assertEqual(result[3]["model"], "google/nano-banana-2/edit")
        store.assert_called_once()

    def test_sheet_that_never_passes_is_not_stored(self) -> None:
        failing = sr.SheetReview(ok=False, method="layout", problems=["no face close-up in the left third"])
        _, error, provider, store, supabase = self._render([failing, failing, failing])
        self.assertIsNotNone(error)
        self.assertIn("after 3 tries", str(error))
        self.assertIn("no face close-up", str(error))
        self.assertEqual(provider.call_count, 3)
        store.assert_not_called()
        update = supabase.table.return_value.update.call_args.args[0]
        self.assertEqual(update["status"], "failed")
        self.assertEqual(len(update["settings"]["review_attempts"]), 3)

    def test_reference_prompt_forbids_returning_the_reference(self) -> None:
        prompt = cs.build_model_sheet_prompt("- Name: Mara", "", [cs.SheetReference("https://x/face.png", "face")])
        self.assertIn("Do not return or retouch a reference image", prompt)


class SheetReviewTests(unittest.TestCase):
    def test_complete_answer_passes(self) -> None:
        review = sr.review_from_answer({
            "face_closeup": True, "face_box": [80, 40, 820, 310], "views": ["front", "three-quarter", "profile", "back"],
            "full_body": True, "one_character": True, "matches_references": True, "text_or_labels": False, "problems": "",
        }, has_references=True)
        self.assertTrue(review.ok)
        self.assertEqual(review.views, list(sr.REQUIRED_VIEWS))
        self.assertEqual(review.face_box, [80, 40, 820, 310])

    def test_missing_views_and_reference_mismatch_fail(self) -> None:
        review = sr.review_from_answer({
            "face_closeup": True, "views": ["front", "profile"], "full_body": True, "one_character": True,
            "matches_references": False, "problems": "back view is absent",
        }, has_references=True)
        self.assertFalse(review.ok)
        self.assertIn("missing three-quarter view, back view", review.problems)
        self.assertIn("does not match the reference images", review.problems)

    def test_portrait_without_face_panel_fails(self) -> None:
        review = sr.review_from_answer({"face_closeup": False, "views": [], "full_body": False, "one_character": True}, has_references=False)
        self.assertFalse(review.ok)
        self.assertIn("no face close-up", review.problems)
        self.assertIsNone(review.face_box)

    @patch.dict("os.environ", {"CHARACTER_SHEET_REVIEW": "vision"})
    def test_vision_answer_is_parsed_from_wrapped_json(self) -> None:
        answer = 'Here you go:\n```json\n{"face_closeup": true, "views": ["front","three_quarter","profile","back"], "full_body": true, "one_character": true}\n```'
        with patch.object(sr, "run_gemini", return_value=answer) as gemini:
            review = sr.review_sheet(draw_sheet(), "https://store/sheet.png", [("https://x/face.png", "face")])
        self.assertTrue(review.ok)
        self.assertEqual(review.method, "vision")
        self.assertEqual(gemini.call_args.kwargs["images"], ["https://store/sheet.png", "https://x/face.png"])
        self.assertIn("Image 2 is a reference for the character's face", gemini.call_args.args[0])

    @patch.dict("os.environ", {"CHARACTER_SHEET_REVIEW": "vision"})
    def test_vision_failure_falls_back_to_layout_check(self) -> None:
        with patch.object(sr, "run_gemini", side_effect=RuntimeError("402 Payment Required")):
            good = sr.review_sheet(draw_sheet(), "https://store/sheet.png")
            bad = sr.review_sheet(draw_portrait(), "https://store/portrait.png")
        self.assertEqual(good.method, "layout")
        self.assertTrue(good.ok, good.problems)
        self.assertFalse(bad.ok)

    def test_layout_check_counts_figures(self) -> None:
        self.assertTrue(sr.layout_review(draw_sheet()).ok)
        portrait = sr.layout_review(draw_portrait())
        self.assertFalse(portrait.face_closeup)
        self.assertTrue(any("full-body figures" in problem for problem in portrait.problems))

    def test_face_crop_uses_the_reviewed_box(self) -> None:
        sheet = draw_sheet()
        left, top, right, bottom = cs.face_panel_box(sheet, [148, 78, 833, 281])  # the drawn head and shoulders
        self.assertLessEqual(left, 150)
        self.assertGreaterEqual(right, 500)
        self.assertLess(right, 760)
        self.assertAlmostEqual((right - left) / (bottom - top), 3 / 4, delta=0.02)


class ReviewModeTests(unittest.TestCase):
    @patch.dict("os.environ", {}, clear=False)
    def test_layout_check_is_the_default_and_never_calls_replicate(self) -> None:
        import os
        os.environ.pop("CHARACTER_SHEET_REVIEW", None)
        with patch.object(sr, "run_gemini") as gemini:
            review = sr.review_sheet(draw_sheet(), "https://store/sheet.png", [("https://x/face.png", "face")])
        gemini.assert_not_called()
        self.assertEqual(review.method, "layout")
        self.assertTrue(review.ok, review.problems)


class EndpointTests(unittest.TestCase):
    def test_more_than_four_reference_images_is_rejected(self) -> None:
        uploads = [MagicMock(filename=f"{index}.png", content_type="image/png") for index in range(5)]
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(generate_character_sheet(
                project_id="project-1", character_id="character-1", prompt="", model=None,
                visual_style=None, images=uploads, image_tags=None,
            ))
        self.assertEqual(raised.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
