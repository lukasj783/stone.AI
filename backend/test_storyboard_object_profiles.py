import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from services import storyboard_generation as sg


def _plan(description: str) -> dict:
    return {
        "beats": [{"block": {"id": "b1", "block_type": "action"}, "text": description, "kind": "action"}],
        "description": description,
        "camera_angle": "medium shot, eye level",
        "shot_size": "medium shot",
        "beat_line": f"SHOT: {description}",
        "speaker": None,
        "character_labels": [],
        "character_facing": {},
        "prop_labels": [],
        "planner": "llm",
    }


class PromptTests(unittest.TestCase):
    def test_props_line_carries_the_profile(self) -> None:
        tamucola = {"name": "Tamucola", "tags": [], "profile_text": "Tamucola: 330 ml; green glass"}
        frames = sg._build_frames_from_shot_plans(
            [_plan("A hand sets a Tamucola on the counter.")], {"location": "Kiosk"}, [], None, [tamucola],
        )
        self.assertIn("PROPS:\n- Tamucola: 330 ml; green glass", frames[0]["prompt"])

    def test_props_line_falls_back_to_the_name(self) -> None:
        frames = sg._build_frames_from_shot_plans(
            [_plan("A hand sets a Tamucola on the counter.")], {"location": "Kiosk"}, [], None, [{"name": "Tamucola", "tags": []}],
        )
        self.assertIn("PROPS:\n- Tamucola", frames[0]["prompt"])

    def test_location_line_uses_environment_profile(self) -> None:
        self.assertEqual(
            sg._describe_location({"location": "Local Kiosk", "time_of_day": "DAY"}, {"profile_text": "Small wooden kiosk; blue paint"}),
            "Local Kiosk, DAY: Small wooden kiosk; blue paint",
        )

    def test_location_line_falls_back_to_description(self) -> None:
        self.assertEqual(
            sg._describe_location({"location": "Local Kiosk"}, {"description": "Small wooden kiosk"}),
            "Local Kiosk: Small wooden kiosk",
        )


class _FakeQuery:
    def __init__(self, rows):
        self.rows = rows

    def __getattr__(self, name):
        return lambda *args, **kwargs: self

    def execute(self):
        return SimpleNamespace(data=self.rows)


class GatherTests(unittest.TestCase):
    def test_objects_and_environment_carry_sheet_and_profile(self) -> None:
        prop = {
            "id": "o1", "name": "Tamucola", "description": None, "tags": [], "primary_asset_id": None,
            "metadata": {"profile": {"size": "330 ml"}, "object_sheet": {"asset_id": "a1", "url": "https://s/sheet.jpg"}},
        }
        plain = {"id": "o2", "name": "Crate", "description": None, "tags": [], "primary_asset_id": None, "metadata": {}}
        kiosk = {
            "id": "e1", "name": "LOCAL KIOSK", "description": "Small wooden kiosk", "primary_asset_id": None,
            "metadata": {"profile": {"lighting": "hard noon sun"}},
        }
        tables = {"props": [prop, plain], "environments": [kiosk], "scenes": {"location": "Local Kiosk"}}
        supabase = MagicMock()
        supabase.table.side_effect = lambda name: _FakeQuery(tables.get(name, []))
        with patch.object(sg, "require_supabase_client", return_value=supabase), patch.object(
            sg, "_attach_importance_tiers"
        ), patch.object(sg, "character_type_map", return_value={}):
            _, environment, objects = sg._gather_scene_linked_entities("project-1", "scene-1", [])
        by_name = {obj["name"]: obj for obj in objects}
        self.assertEqual(by_name["Tamucola"]["sheet_url"], "https://s/sheet.jpg")
        self.assertEqual(by_name["Tamucola"]["profile_text"], "Tamucola: 330 ml")
        self.assertIsNone(by_name["Crate"]["sheet_url"])
        self.assertEqual(by_name["Crate"]["profile_text"], "Crate")
        self.assertEqual(environment["profile_text"], "Small wooden kiosk; hard noon sun")

    def test_unmatched_location_does_not_borrow_another_places_profile(self) -> None:
        kiosk = {
            "id": "e1", "name": "LOCAL KIOSK", "description": "Small wooden kiosk", "primary_asset_id": None,
            "metadata": {"profile": {"lighting": "hard noon sun"}},
        }
        tables = {"props": [], "environments": [kiosk], "scenes": {"location": "Moon Base"}}
        supabase = MagicMock()
        supabase.table.side_effect = lambda name: _FakeQuery(tables.get(name, []))
        with patch.object(sg, "require_supabase_client", return_value=supabase), patch.object(
            sg, "_attach_importance_tiers"
        ), patch.object(sg, "character_type_map", return_value={}):
            _, environment, _ = sg._gather_scene_linked_entities("project-1", "scene-1", [])
        self.assertEqual((environment or {}).get("profile_text", ""), "")
        self.assertEqual(sg._describe_location({"location": "Moon Base"}, environment), "Moon Base")


if __name__ == "__main__":
    unittest.main()
