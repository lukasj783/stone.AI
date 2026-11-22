import unittest

from services.character_views import build_script_character_profile, effective_character_profile, physical_summary


class ScriptCharacterProfileTests(unittest.TestCase):
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

    def test_manual_overrides_win_over_script_facts(self) -> None:
        profile = build_script_character_profile({
            "name": "Mara Voss",
            "role": "Station engineer",
            "metadata": {"manual_overrides": {"role": "Chief engineer"}},
        })
        self.assertIn("- Role: Chief engineer", profile)
        self.assertNotIn("Station engineer", profile)

    def test_physical_facts_are_listed_in_order_with_overrides(self) -> None:
        profile = build_script_character_profile({
            "name": "John Mwangi",
            "physical": {"hair": "Short black hair", "height": "180 cm", "unknown": "dropped", "eyes": "  "},
            "metadata": {"manual_overrides": {"hair": "Shaved head", "distinguishing_marks": "Scar over left eyebrow"}},
        })
        self.assertIn("- Height: 180 cm", profile)
        self.assertIn("- Hair: Shaved head", profile)
        self.assertIn("- Distinguishing marks: Scar over left eyebrow", profile)
        self.assertNotIn("Short black hair", profile)
        self.assertNotIn("dropped", profile)
        self.assertNotIn("Eyes", profile)
        self.assertLess(profile.index("Height"), profile.index("Hair"))

    def test_physical_facts_alone_are_enough_to_build_a_profile(self) -> None:
        profile = build_script_character_profile({"physical": {"build": "Athletic"}})
        self.assertIn("- Build: Athletic", profile)


class EffectiveProfileTests(unittest.TestCase):
    def test_physical_is_always_a_dict(self) -> None:
        self.assertEqual(effective_character_profile({"name": "A"})["physical"], {})
        self.assertEqual(effective_character_profile({"name": "A", "physical": None})["physical"], {})

    def test_summary_joins_labels(self) -> None:
        summary = physical_summary({"physical": {"build": "Athletic", "skin_tone": "Dark brown"}})
        self.assertEqual(summary, "Build: Athletic; Skin tone: Dark brown")


if __name__ == "__main__":
    unittest.main()
