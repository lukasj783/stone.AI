import os
import unittest
from unittest import mock

from services import storyboard_generation as sg
from services.storyboard_shot_planner import ShotPlanningError, normalize_shot_plans


SCENE = {"slugline_raw": "INT. WAREHOUSE - NIGHT", "location": "Warehouse", "time_of_day": "Night"}
CHARACTERS = [
    {"id": "c1", "name": "Voss", "tags": ["DETECTIVE"], "views": {"front": "http://img/voss.jpg"}},
    {"id": "c2", "name": "Mara", "tags": [], "views": {"front": "http://img/mara.jpg"}},
]
BLOCKS = [
    {"id": "b1", "block_type": "action", "content": "Voss kicks the door open and freezes at the body."},
    {"id": "b2", "block_type": "dialogue", "content": "Too late.", "character_name": "VOSS"},
    {"id": "b3", "block_type": "action", "content": "Mara steps out of the shadows."},
    {"id": "b4", "block_type": "action", "content": "She raises her hands."},
]


def _llm_shot(lines, description, characters=(), size="close-up", angle="low angle"):
    return {
        "lines": list(lines),
        "description": description,
        "shot_size": size,
        "camera_angle": angle,
        "characters": list(characters),
        "props": [],
    }


class ShotPlanningTests(unittest.TestCase):
    def setUp(self) -> None:
        self.beats = sg._build_scene_beats(BLOCKS)
        patcher = mock.patch.dict(os.environ, {}, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        for name in ("STORYBOARD_SHOT_PLANNER", "STORYBOARD_MAX_SHOTS"):
            os.environ.pop(name, None)

    def _plan(self, llm_result):
        with mock.patch.object(sg, "plan_scene_shots", **llm_result) as planner:
            plans, mode, error = sg._plan_scene_shots(self.beats, SCENE, BLOCKS, CHARACTERS, [])
        return plans, mode, error, planner

    def test_beats_are_the_three_action_lines(self) -> None:
        self.assertEqual([beat["block"]["id"] for beat in self.beats], ["b1", "b3", "b4"])

    def test_one_line_splits_into_shots_and_lines_merge(self) -> None:
        plans, mode, error, planner = self._plan({"return_value": [
            _llm_shot([1], "Voss kicks the warehouse door open.", ["Voss"], size="wide shot"),
            _llm_shot([1], "Voss freezes, staring at a body on the floor.", ["Voss"]),
            _llm_shot([2, 3], "Mara steps out of the shadows with her hands raised.", ["Mara"]),
        ]})
        self.assertEqual((mode, error), ("llm", None))
        frames = sg._build_frames_from_shot_plans(plans, SCENE, CHARACTERS, None, [])

        self.assertEqual([f["source_block_ids"] for f in frames], [["b1"], ["b1"], ["b3", "b4"]])
        self.assertEqual(frames[0]["camera_angle"], "wide shot, low angle")
        self.assertIn("SHOT: Voss freezes, staring at a body on the floor.", frames[1]["prompt"])
        self.assertEqual(frames[1]["character_ids"], ["c1"])
        self.assertEqual(frames[2]["character_ids"], ["c2"])
        self.assertEqual(frames[2]["image_references"], ["http://img/mara.jpg"])
        self.assertEqual(frames[2]["source_text"], "Mara steps out of the shadows. She raises her hands.")

        script_lines = planner.call_args.kwargs["script_lines"]
        self.assertEqual([line["number"] for line in script_lines], [1, None, 2, 3])
        self.assertEqual(script_lines[1]["label"], "DIALOGUE (VOSS)")

    def test_skipped_line_gets_a_deterministic_shot_in_script_order(self) -> None:
        plans, mode, _, _ = self._plan({"return_value": [
            _llm_shot([3], "Mara raises her hands.", ["Mara"]),
            _llm_shot([1], "Voss kicks the door open.", ["Voss"]),
        ]})
        self.assertEqual(mode, "llm")
        self.assertEqual([[b["block"]["id"] for b in p["beats"]] for p in plans], [["b1"], ["b3"], ["b4"]])
        self.assertEqual([p["planner"] for p in plans], ["llm", "deterministic", "llm"])
        self.assertEqual(plans[1]["beat_line"], "ACTION: Mara steps out of the shadows.")

    def test_planner_failure_falls_back_to_one_shot_per_line(self) -> None:
        plans, mode, error, _ = self._plan({"side_effect": ShotPlanningError("boom")})
        self.assertEqual((mode, error), ("deterministic", "boom"))
        self.assertEqual(len(plans), 3)
        self.assertEqual(
            [p["camera_angle"] for p in plans],
            ["wide establishing shot", "medium shot", "medium shot"],
        )

    def test_planner_can_be_switched_off(self) -> None:
        os.environ["STORYBOARD_SHOT_PLANNER"] = "false"
        plans, mode, _, planner = self._plan({"return_value": []})
        planner.assert_not_called()
        self.assertEqual((mode, len(plans)), ("deterministic", 3))

    def test_shot_cap_trims_extras_but_keeps_every_line_covered(self) -> None:
        os.environ["STORYBOARD_MAX_SHOTS"] = "3"
        plans, _, _, _ = self._plan({"return_value": [
            _llm_shot([1], "Voss kicks the door.", ["Voss"]),
            _llm_shot([1], "Voss freezes.", ["Voss"]),
            _llm_shot([2], "Mara steps out.", ["Mara"]),
            _llm_shot([3], "Mara raises her hands.", ["Mara"]),
            _llm_shot([3], "Close on Mara's raised hands.", ["Mara"]),
        ]})
        self.assertEqual(len(plans), 3)
        covered = {b["block"]["id"] for p in plans for b in p["beats"]}
        self.assertEqual(covered, {"b1", "b3", "b4"})

    def test_normalize_drops_bad_shots_and_defaults_camera(self) -> None:
        plans = normalize_shot_plans(
            {"shots": [
                {"lines": [9], "description": "Unknown line."},
                {"lines": [1], "description": ""},
                "junk",
                {"lines": [2, 1, True], "description": " A  real shot. ", "shot_size": "Bird View", "camera_angle": "LOW ANGLE"},
            ]},
            {1, 2},
        )
        self.assertEqual(plans, [{
            "lines": [1, 2],
            "description": "A real shot.",
            "shot_size": "medium shot",
            "camera_angle": "low angle",
            "characters": [],
            "props": [],
        }])


class StoryboardReuseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.beats = sg._build_scene_beats([
            {**block, "updated_at": "2026-01-01T00:00:00Z"} for block in BLOCKS
        ])

    @staticmethod
    def _shot(block_ids, created="2026-02-01T00:00:00Z"):
        return {"metadata": {"source_block_ids": block_ids}, "created_at": created}

    def test_multi_shot_coverage_is_reused(self) -> None:
        shots = [self._shot(["b1"]), self._shot(["b1"]), self._shot(["b3", "b4"])]
        self.assertTrue(sg._storyboard_matches_script(shots, self.beats))

    def test_legacy_single_block_shots_are_reused(self) -> None:
        shots = [
            {"metadata": {"source_block_id": block_id}, "created_at": "2026-02-01T00:00:00Z"}
            for block_id in ("b1", "b3", "b4")
        ]
        self.assertTrue(sg._storyboard_matches_script(shots, self.beats))

    def test_stale_when_a_line_is_uncovered_removed_or_edited(self) -> None:
        self.assertFalse(sg._storyboard_matches_script([self._shot(["b1"]), self._shot(["b3"])], self.beats))
        self.assertFalse(sg._storyboard_matches_script(
            [self._shot(["b1"]), self._shot(["gone"]), self._shot(["b3", "b4"])], self.beats
        ))
        self.assertFalse(sg._storyboard_matches_script(
            [self._shot(["b1"]), self._shot(["b3", "b4"], created="2025-12-01T00:00:00Z")], self.beats
        ))

    def test_stale_when_shots_are_out_of_script_order(self) -> None:
        shots = [self._shot(["b3", "b4"]), self._shot(["b1"])]
        self.assertFalse(sg._storyboard_matches_script(shots, self.beats))


if __name__ == "__main__":
    unittest.main()
