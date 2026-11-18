import unittest

from services import storyboard_generation as sg
from services.storyboard_references import (
    build_frame_references,
    describe_references,
    normalize_facing,
    shot_framing,
)
from services.storyboard_shot_planner import normalize_shot_plans


def _character(name: str, *views: str, face: bool = True) -> dict:
    urls = {view: f"http://img/{name}/{view}.png" for view in views}
    if face:
        urls["face_closeup"] = f"http://img/{name}/face.png"
    return {"id": name, "name": name, "views": urls}


ALL_VIEWS = ("front", "left_three_quarter", "left_profile", "back", "right_profile", "right_three_quarter")
ENVIRONMENT = {"image_url": "http://img/location.png"}
PROP = {"name": "Revolver", "image_url": "http://img/revolver.png"}
ENVIRONMENT_GALLERY = {"image_url": "http://img/loc.png", "references": [
    {"url": "http://img/loc.png", "angle": "primary"},
    {"url": "http://img/loc-detail.png", "angle": "detail"},
    {"url": "http://img/loc-reverse.png", "angle": "reverse"},
    {"url": "http://img/loc-wide.png", "angle": "wide"},
    {"url": "http://img/loc-upload.png", "angle": "custom"},
]}
PROP_GALLERY = {"name": "Revolver", "image_url": "http://img/gun.png", "references": [
    {"url": "http://img/gun.png", "angle": "primary"},
    {"url": "http://img/gun-side.png", "angle": "side"},
    {"url": "http://img/gun-detail.png", "angle": "detail"},
]}


def _views(references) -> list[str]:
    return [reference.label for reference in references]


class FramingTests(unittest.TestCase):
    def test_shot_sizes_group_into_framings(self) -> None:
        self.assertEqual(shot_framing("extreme close-up"), "close")
        self.assertEqual(shot_framing("medium close-up"), "close")
        self.assertEqual(shot_framing("insert shot"), "close")
        self.assertEqual(shot_framing("medium shot"), "medium")
        self.assertEqual(shot_framing("over-the-shoulder shot"), "medium")
        self.assertEqual(shot_framing("wide establishing shot"), "wide")
        self.assertEqual(shot_framing("full shot"), "wide")
        self.assertEqual(shot_framing(None), "medium")

    def test_facing_is_normalized(self) -> None:
        self.assertEqual(normalize_facing(" Profile  Screen-Left "), "profile screen left")
        self.assertIsNone(normalize_facing("sideways"))


class SelectionTests(unittest.TestCase):
    def test_close_up_leads_with_face_then_front(self) -> None:
        voss = _character("VOSS", *ALL_VIEWS)
        refs = build_frame_references([voss], {}, "close-up", ENVIRONMENT, [], 6)
        self.assertEqual(_views(refs), ["VOSS, face close-up", "VOSS, front view", "VOSS, left 3/4 view", "location, main view"])

    def test_wide_shot_uses_full_body_views_not_face(self) -> None:
        voss = _character("VOSS", *ALL_VIEWS)
        refs = build_frame_references([voss], {}, "wide shot", ENVIRONMENT, [], 6)
        self.assertEqual(_views(refs)[:3], ["VOSS, front view", "VOSS, left 3/4 view", "VOSS, right 3/4 view"])
        self.assertNotIn("VOSS, face close-up", _views(refs))

    def test_facing_away_sends_back_view_first_and_no_face(self) -> None:
        voss = _character("VOSS", *ALL_VIEWS)
        refs = build_frame_references([voss], {id(voss): "away from camera"}, "close-up", None, [], 6)
        self.assertEqual(_views(refs)[0], "VOSS, back view")
        self.assertNotIn("VOSS, face close-up", _views(refs))

    def test_profile_matches_screen_direction(self) -> None:
        voss = _character("VOSS", *ALL_VIEWS)
        left = build_frame_references([voss], {id(voss): "profile screen left"}, "medium shot", None, [], 6)
        right = build_frame_references([voss], {id(voss): "profile screen right"}, "medium shot", None, [], 6)
        self.assertEqual(_views(left)[:2], ["VOSS, left profile view", "VOSS, face close-up"])
        self.assertEqual(_views(right)[0], "VOSS, right profile view")

    def test_two_characters_both_get_references_and_location_is_kept(self) -> None:
        voss, mara = _character("VOSS", *ALL_VIEWS), _character("MARA", *ALL_VIEWS)
        refs = build_frame_references([voss, mara], {}, "medium shot", ENVIRONMENT, [PROP], 6)
        labels = _views(refs)
        self.assertEqual(len(refs), 6)
        self.assertEqual(sum(label.startswith("VOSS") for label in labels), 2)
        self.assertEqual(sum(label.startswith("MARA") for label in labels), 2)
        self.assertIn("location, main view", labels)
        self.assertIn("prop: Revolver, main view", labels)

    def test_over_the_shoulder_shows_back_of_near_character_and_face_of_far(self) -> None:
        voss, mara = _character("VOSS", *ALL_VIEWS), _character("MARA", *ALL_VIEWS)
        facing = {id(voss): "away from camera", id(mara): "toward camera"}
        refs = build_frame_references([voss, mara], facing, "over-the-shoulder shot", ENVIRONMENT, [], 6)
        self.assertEqual(_views(refs)[0], "VOSS, back view")
        self.assertEqual(_views(refs)[3:5], ["MARA, front view", "MARA, face close-up"])

    def test_missing_views_fall_back_to_what_exists(self) -> None:
        voss = _character("VOSS", "front", face=False)
        refs = build_frame_references([voss], {id(voss): "away from camera"}, "close-up", None, [], 6)
        self.assertEqual(_views(refs), ["VOSS, front view"])
        primary_only = {"id": "x", "name": "X", "views": {}, "image_url": "http://img/x.png"}
        self.assertEqual(_views(build_frame_references([primary_only], {}, "close-up", None, [], 6)), ["X, front view"])

    def test_ten_slots_are_shared_in_rounds(self) -> None:
        voss, mara = _character("VOSS", *ALL_VIEWS), _character("MARA", *ALL_VIEWS)
        refs = build_frame_references([voss, mara], {}, "wide shot", ENVIRONMENT_GALLERY, [PROP_GALLERY], 10)
        labels = _views(refs)
        self.assertEqual(len(refs), 10)
        self.assertEqual(sum(label.startswith("VOSS") for label in labels), 3)
        self.assertEqual(sum(label.startswith("MARA") for label in labels), 3)
        self.assertEqual([label for label in labels if label.startswith("location")],
                         ["location, main view", "location, extra-wide view", "location, reverse angle"])
        self.assertEqual([label for label in labels if label.startswith("prop")], ["prop: Revolver, main view"])

    def test_many_characters_still_get_one_view_each(self) -> None:
        cast = [_character(name, *ALL_VIEWS) for name in ("A", "B", "C", "D", "E")]
        refs = build_frame_references(cast, {}, "medium shot", ENVIRONMENT, [PROP], 6)
        labels = _views(refs)
        self.assertEqual([label.split(",")[0] for label in labels[:5]], ["A", "B", "C", "D", "E"])
        self.assertEqual(labels[5], "location, main view")

    def test_prompt_labels_each_image_in_order(self) -> None:
        voss = _character("VOSS", "front")
        text = describe_references(build_frame_references([voss], {}, "close-up", ENVIRONMENT, [], 6))
        self.assertIn("- Image 1: VOSS, face close-up", text)
        self.assertIn("- Image 2: VOSS, front view", text)
        self.assertIn("- Image 3: location, main view", text)
        self.assertIsNone(describe_references([]))


class EntityGalleryTests(unittest.TestCase):
    def test_close_up_prefers_object_detail_and_location_detail(self) -> None:
        refs = build_frame_references([], {}, "insert shot", ENVIRONMENT_GALLERY, [PROP_GALLERY], 10)
        self.assertEqual(_views(refs), [
            "location, detail view",
            "prop: Revolver, detail view", "prop: Revolver, main view", "prop: Revolver, side angle",
        ])

    def test_medium_shot_takes_two_of_each(self) -> None:
        refs = build_frame_references([], {}, "medium shot", ENVIRONMENT_GALLERY, [PROP_GALLERY], 10)
        self.assertEqual(_views(refs), [
            "location, main view", "location, reverse angle",
            "prop: Revolver, main view", "prop: Revolver, side angle",
        ])

    def test_uploads_without_an_angle_are_used_after_named_angles(self) -> None:
        only_uploads = {"references": [
            {"url": "http://img/a.png", "angle": "primary"}, {"url": "http://img/b.png", "angle": "custom"},
        ]}
        refs = build_frame_references([], {}, "wide shot", only_uploads, [], 10)
        self.assertEqual(_views(refs), ["location, main view", "location, reference"])

    def test_gallery_puts_main_image_first(self) -> None:
        entity = {"id": "e1", "primary_asset_id": "a2"}
        links = [
            {"target_id": "e1", "asset_id": "a1", "metadata": {"angle": "reverse"}},
            {"target_id": "e1", "asset_id": "a2", "metadata": {"angle": "detail"}},
            {"target_id": "other", "asset_id": "a3", "metadata": {}},
        ]
        urls = {"a1": "http://a1", "a2": "http://a2", "a3": "http://a3"}
        self.assertEqual(sg._entity_gallery(entity, links, urls), [
            {"url": "http://a2", "angle": "primary"}, {"url": "http://a1", "angle": "reverse"},
        ])


class PipelineTests(unittest.TestCase):
    def test_planner_facing_is_validated(self) -> None:
        plans = normalize_shot_plans({"shots": [{
            "lines": [1], "description": "Voss turns away.", "shot_size": "close-up", "camera_angle": "eye level",
            "characters": ["VOSS"], "character_facing": {"VOSS": "Away from camera", "MARA": "upside down"},
        }]}, {1})
        self.assertEqual(plans[0]["character_facing"], {"VOSS": "away from camera"})

    def test_frames_use_planner_facing_and_shot_size(self) -> None:
        voss = _character("Voss", *ALL_VIEWS)
        voss["tags"] = []
        plan = {
            "beats": [{"block": {"id": "b1", "block_type": "action"}, "text": "Voss walks off.", "kind": "action"}],
            "description": "Voss walks away down the corridor.",
            "camera_angle": "wide shot, eye level",
            "shot_size": "wide shot",
            "beat_line": "SHOT: Voss walks away down the corridor.",
            "speaker": None,
            "character_labels": ["VOSS"],
            "character_facing": {"VOSS": "away from camera"},
            "prop_labels": [],
            "planner": "llm",
        }
        frames = sg._build_frames_from_shot_plans([plan], {"location": "Corridor"}, [voss], ENVIRONMENT, [])
        self.assertEqual(frames[0]["image_references"][0], "http://img/Voss/back.png")
        self.assertIn("- Image 1: VOSS, back view", frames[0]["prompt"])

    def test_latest_generation_views_win_and_face_is_kept(self) -> None:
        links = [
            {"asset_id": "new-front", "role": "keyframe", "metadata": {"view": "front", "generation_job_id": "job2"}},
            {"asset_id": "old-front", "role": "keyframe", "metadata": {"view": "front", "generation_job_id": "job1"}},
            {"asset_id": "face", "role": "face_closeup", "metadata": {}},
        ]
        urls = {"new-front": "http://new", "old-front": "http://old", "face": "http://face"}
        self.assertEqual(
            sg._character_views_from_links(links, urls, "job2"),
            {"front": "http://new", "face_closeup": "http://face"},
        )


if __name__ == "__main__":
    unittest.main()
