import unittest

from services.environment_text_to_image import build_script_environment_prompt


class EnvironmentPromptTests(unittest.TestCase):
    def test_script_facts_only(self) -> None:
        prompt = build_script_environment_prompt({"name": "Local Kiosk", "metadata": {"time_of_day_values": ["DAY"]}})
        self.assertIn("- Environment: Local Kiosk", prompt)
        self.assertIn("- Time of day: DAY", prompt)
        self.assertNotIn("Description", prompt)

    def test_description_and_profile_are_included(self) -> None:
        prompt = build_script_environment_prompt({
            "name": "Local Kiosk",
            "description": "Small wooden kiosk",
            "metadata": {"profile": {"look": "blue paint", "lighting": "hard noon sun", "fixed_features": "red fridge on the left"}},
        })
        self.assertIn("- Description: Small wooden kiosk", prompt)
        self.assertIn("- Look / architecture: blue paint", prompt)
        self.assertIn("- Lighting & colour palette: hard noon sun", prompt)
        self.assertIn("- Fixed features (must appear): red fridge on the left", prompt)


if __name__ == "__main__":
    unittest.main()
