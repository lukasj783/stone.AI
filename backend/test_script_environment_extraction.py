import unittest

from routers.story import _extract_script_environments


class ScriptEnvironmentExtractionTests(unittest.TestCase):
    def test_aggregates_explicit_location_variants_with_source_evidence(self) -> None:
        environments = _extract_script_environments([
            {
                "id": "scene-1",
                "slugline_raw": "INT. ORBITAL STATION - DAY",
                "location": "Orbital Station",
                "location_type": "INT",
                "time_of_day": "DAY",
            },
            {
                "id": "scene-2",
                "slugline_raw": "EXT. ORBITAL STATION - NIGHT",
                "location": " orbital   station ",
                "location_type": "EXT",
                "time_of_day": "NIGHT",
            },
        ])

        self.assertEqual(environments, [{
            "name": "Orbital Station",
            "source_scene_ids": ["scene-1", "scene-2"],
            "source_sluglines": [
                "INT. ORBITAL STATION - DAY",
                "EXT. ORBITAL STATION - NIGHT",
            ],
            "location_types": ["INT", "EXT"],
            "time_of_day_values": ["DAY", "NIGHT"],
        }])

    def test_ignores_scenes_without_an_explicit_location(self) -> None:
        environments = _extract_script_environments([{
            "id": "scene-1",
            "slugline_raw": "MARA RUNS THROUGH A DARK HALLWAY",
            "location": None,
            "location_type": None,
            "time_of_day": None,
        }])

        self.assertEqual(environments, [])


if __name__ == "__main__":
    unittest.main()