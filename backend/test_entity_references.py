import unittest

from services.entity_references import ENVIRONMENT, OBJECT, angle_label, build_angle_prompt, entity_kind


class EntityReferenceTests(unittest.TestCase):
    def test_entity_types_resolve(self) -> None:
        self.assertIs(entity_kind("environment"), ENVIRONMENT)
        self.assertIs(entity_kind("prop"), OBJECT)
        self.assertIs(entity_kind("object"), OBJECT)
        with self.assertRaises(ValueError):
            entity_kind("character")

    def test_labels(self) -> None:
        self.assertEqual(angle_label(ENVIRONMENT, "primary"), "Establishing view")
        self.assertEqual(angle_label(ENVIRONMENT, "reverse"), "Reverse angle")
        self.assertEqual(angle_label(OBJECT, "detail"), "Detail close-up")
        self.assertEqual(angle_label(OBJECT, "custom"), "Uploaded reference")

    def test_environment_prompt_keeps_place_and_changes_only_camera(self) -> None:
        prompt = build_angle_prompt(ENVIRONMENT, {
            "name": "Warehouse", "description": "Abandoned dockside warehouse",
            "metadata": {"location_types": ["INT"], "time_of_day_values": ["NIGHT"]},
        }, "reverse", None)
        self.assertIn("Warehouse", prompt)
        self.assertIn("opposite direction", prompt)
        self.assertIn("Time of day: NIGHT", prompt)
        self.assertIn("Only the camera position changes.", prompt)
        self.assertIn("No people", prompt)

    def test_object_prompt_and_unknown_angle(self) -> None:
        prompt = build_angle_prompt(OBJECT, {"name": "Revolver", "metadata": {}}, "detail", None)
        self.assertIn("extreme close-up", prompt)
        with self.assertRaises(ValueError):
            build_angle_prompt(OBJECT, {"name": "Revolver"}, "reverse", None)


if __name__ == "__main__":
    unittest.main()
