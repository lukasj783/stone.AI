import json
import unittest
from pathlib import Path

from services.duration_budget import (
    MAX_CLIP_SECONDS,
    MIN_CLIP_SECONDS,
    allocate_shot_durations,
    budget_plan,
    distribute_integer,
    format_seconds,
    average_shot_seconds,
    max_unit_seconds,
    normalize_pacing,
    parse_duration_seconds,
    plan_fit_problems,
    requested_unit_count,
    split_oversized_units,
    target_unit_count,
    plan_duration_rules,
    unit_count_range,
    unit_length_guide,
)
from services.script_config import build_engine_config
from services.project_runtime import runtime_from_idea_metadata
from services.script_generation import (
    PlanError,
    PlannedUnit,
    build_plan_prompt,
    leaf_units,
    plan_script,
    plan_to_runtime,
)

FIXTURE = Path(__file__).parent / "test_fixtures" / "script_engine_config.json"
CONFIG = build_engine_config(json.loads(FIXTURE.read_text(encoding="utf-8")))
FILM = CONFIG.project_type("feature_film")


def _total(units) -> float:
    """Sum of duration_seconds, treating a missing duration as 0."""
    return sum(unit.duration_seconds or 0 for unit in units)


def _leaf(seconds=None, title="S"):
    return PlannedUnit(unit_type="scene", title=title, summary="", is_leaf=True, duration_seconds=seconds)


def _act(*children):
    return PlannedUnit(unit_type="act", title="Act", summary="", is_leaf=False, children=list(children))


class ParseDurationTests(unittest.TestCase):
    def test_common_inputs(self) -> None:
        cases = {
            "30 min": 1800,
            "1 hr": 3600,
            "3 min": 180,
            "90 sec": 90,
            "30 sec": 30,
            "120 min": 7200,
            "1h 30m": 5400,
            "1 hour 15 minutes": 4500,
            "1.5 hours": 5400,
            "2:30": 150,
            "1:00:00": 3600,
            "45": 2700,
            "Dakika 3–5": 240,
            "3-5 min": 240,
            "Sekunde 15–60": 38,
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(parse_duration_seconds(text), expected)

    def test_unreadable_inputs(self) -> None:
        for value in ("", "   ", "about half", None, 0, True):
            with self.subTest(value=value):
                self.assertIsNone(parse_duration_seconds(value))

    def test_format_seconds(self) -> None:
        self.assertEqual(format_seconds(45), "45 s")
        self.assertEqual(format_seconds(180), "3 min")
        self.assertEqual(format_seconds(5400), "1 h 30 min")


class PlanBudgetTests(unittest.TestCase):
    def test_rescales_leaves_to_target_and_sums_containers(self) -> None:
        a, b, c = _leaf(60), _leaf(120), _leaf(60)
        act = _act(a, b)
        report = budget_plan([act, c], 1800)
        self.assertEqual(_total((a, b, c)), 1800)
        self.assertEqual((a.duration_seconds, b.duration_seconds, c.duration_seconds), (450, 900, 450))
        self.assertEqual(act.duration_seconds, 1350)
        self.assertTrue(report["rescaled"])
        self.assertEqual(report["planned_seconds"], 1800)
        self.assertEqual(report["model_seconds"], 240)

    def test_fills_missing_durations(self) -> None:
        a, b = _leaf(100), _leaf(None)
        budget_plan([a, b], 200)
        self.assertEqual((a.duration_seconds, b.duration_seconds), (100, 100))

    def test_no_durations_share_target_equally(self) -> None:
        leaves = [_leaf() for _ in range(3)]
        budget_plan(leaves, 180)
        self.assertEqual([l.duration_seconds for l in leaves], [60, 60, 60])

    def test_close_plan_is_made_exact(self) -> None:
        # Within tolerance, so not reported as rescaled, but still sums exactly.
        a, b = _leaf(88), _leaf(90)
        report = budget_plan([a, b], 180)
        self.assertFalse(report["rescaled"])
        self.assertEqual((a.duration_seconds, b.duration_seconds), (89, 91))

    def test_eval_cases_that_drifted_now_sum_exactly(self) -> None:
        # Totals the real-model evaluation left 0.8%-5% off the target.
        for target, lengths in ((3600, [150] * 23), (3600, [182] * 20), (7200, [180] * 38), (1800, [140] * 13)):
            with self.subTest(target=target, total=sum(lengths)):
                leaves = [_leaf(s) for s in lengths]
                self.assertEqual(budget_plan(leaves, target)["planned_seconds"], target)
                self.assertEqual(_total(leaves), target)

    def test_without_target_only_fills_gaps(self) -> None:
        a, b = _leaf(30), _leaf(None)
        report = budget_plan([a, b], None)
        self.assertEqual(b.duration_seconds, 30)
        self.assertEqual(report["planned_seconds"], 60)

    def test_distribute_integer_is_exact(self) -> None:
        self.assertEqual(sum(distribute_integer(100, [1, 1, 1])), 100)
        self.assertEqual(distribute_integer(10, [1, 1], minimum=3), [5, 5])
        self.assertEqual(sum(distribute_integer(7, [5, 0, 0], minimum=2)), 7)


class PromptGuideTests(unittest.TestCase):
    def test_unit_count_range_scales_with_runtime(self) -> None:
        short = unit_count_range(180, "short_film")
        hour = unit_count_range(3600, "feature_film")
        self.assertLess(short[1], hour[0])
        self.assertGreaterEqual(short[0], 1)

    def test_plan_rules_name_the_total(self) -> None:
        rules = plan_duration_rules(1800, "feature_film", "Scene")
        self.assertIn("30 min", rules)
        self.assertIn("add up to 1800 seconds", rules)

    def test_unit_length_guide(self) -> None:
        guide = unit_length_guide(60, "screenplay")
        self.assertIn("about 60 seconds", guide)
        self.assertIn("55 formatted screenplay lines", guide)
        self.assertIn("150 words", guide)


class ShotDurationTests(unittest.TestCase):
    def test_shots_fill_scene_budget(self) -> None:
        durations = allocate_shot_durations(60, [1, 2, 1, 2, 1, 1])
        self.assertEqual(sum(durations), 60)
        self.assertTrue(all(MIN_CLIP_SECONDS <= d <= MAX_CLIP_SECONDS for d in durations))

    def test_clamped_time_moves_to_other_shots(self) -> None:
        durations = allocate_shot_durations(40, [20, 1, 1])
        self.assertEqual(sum(durations), 40)
        self.assertEqual(durations[0], MAX_CLIP_SECONDS)

    def test_impossible_budget_uses_closest_total(self) -> None:
        self.assertEqual(allocate_shot_durations(5, [1, 1, 1]), [4, 4, 4])
        self.assertEqual(allocate_shot_durations(100, [1, 1]), [15, 15])

    def test_without_budget_uses_type_average(self) -> None:
        self.assertEqual(allocate_shot_durations(None, [1, 1], "advertisement"), [4, 4])
        self.assertEqual(allocate_shot_durations(None, [9.2], "feature_film"), [10])


def _model_plan(count: int, seconds: int = 120) -> str:
    """A model reply with ``count`` scenes of ``seconds`` each, inside one act."""
    scenes = [
        {"unit_type": "scene", "title": f"Scene {i + 1}", "summary": f"Beat {i + 1}.", "duration_seconds": seconds}
        for i in range(count)
    ]
    return json.dumps({"units": [{"unit_type": "act", "title": "Act I", "summary": "", "children": scenes}]})


class FakeModel:
    def __init__(self, *replies: str) -> None:
        self.replies = list(replies)
        self.prompts: list[str] = []

    def __call__(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return self.replies[min(len(self.prompts), len(self.replies)) - 1]


class PlanFitTests(unittest.TestCase):
    """The scene count and scene lengths must fit the runtime, whatever the model returns."""

    def assert_fits(self, plan, target: int, project_type: str = "feature_film") -> None:
        leaves = leaf_units(plan)
        low, high = unit_count_range(target, project_type)
        self.assertGreaterEqual(len(leaves), low)
        self.assertLessEqual(len(leaves), high)
        self.assertEqual(_total(leaves), target)
        limit = max_unit_seconds(target, project_type)
        self.assertTrue(all((l.duration_seconds or 0) <= limit for l in leaves))

    def test_three_scenes_for_thirty_minutes_is_flagged(self) -> None:
        plan = [PlannedUnit("scene", f"S{i}", "", True, duration_seconds=120) for i in range(3)]
        budget_plan(plan, 1800)
        problems = plan_fit_problems(plan, 1800, "feature_film")
        self.assertEqual(len(problems), 2)
        self.assertIn("planned 3 scenes", problems[0])
        self.assertIn("between 9 and 25", problems[0])

    def test_good_plan_is_accepted_first_time(self) -> None:
        model = FakeModel(_model_plan(15))
        plan, report = plan_to_runtime(model, "PROMPT", FILM, "30 min")
        self.assertEqual(len(model.prompts), 1)
        self.assertTrue(report["fits"])
        self.assertEqual(report["split_units"], 0)
        self.assert_fits(plan, 1800)

    def test_bad_plan_is_sent_back_with_the_problems(self) -> None:
        model = FakeModel(_model_plan(3), _model_plan(14))
        plan, report = plan_to_runtime(model, "PROMPT", FILM, "30 min")
        self.assertEqual(len(model.prompts), 2)
        self.assertIn("You planned 3 scenes for 30 min; plan about 15 (between 9 and 25)", model.prompts[1])
        self.assertTrue(model.prompts[1].startswith("PROMPT"))
        self.assertEqual([a["unit_count"] for a in report["attempts"]], [3, 14])
        self.assertTrue(report["fits"])
        self.assertEqual(report["split_units"], 0)
        self.assert_fits(plan, 1800)

    def test_model_that_never_fixes_it_gets_scenes_split_in_code(self) -> None:
        model = FakeModel(_model_plan(3))
        plan, report = plan_to_runtime(model, "PROMPT", FILM, "30 min")
        self.assertEqual(len(model.prompts), 3)  # first try + 2 retries
        self.assertEqual(report["split_units"], 3)
        self.assertTrue(report["fits"])
        self.assert_fits(plan, 1800)
        titles = [unit.title for unit in leaf_units(plan)]
        self.assertIn("Scene 1 (Part 1 of 5)", titles)
        self.assertEqual(plan[0].duration_seconds, 1800)  # the act sums its parts

    def test_too_few_scenes_that_are_not_too_long_are_split_to_the_minimum(self) -> None:
        # 1-hour drama: minimum 15 scenes; 10 scenes of 6 min are each under the 6 min 15 s limit.
        plan = [PlannedUnit("scene", f"S{i}", "", True, duration_seconds=360) for i in range(10)]
        self.assertEqual(plan_fit_problems(plan, 3600, "feature_film", pacing="drama")[0][:24], "You planned 10 scenes fo")
        split = split_oversized_units(plan, 3600, "feature_film", "drama")
        self.assertEqual(split, 5)
        self.assertEqual(len(plan), 15)
        self.assertEqual(_total(plan), 3600)
        self.assertEqual(plan_fit_problems(plan, 3600, "feature_film", pacing="drama"), [])

    def test_split_keeps_script_order(self) -> None:
        plan = [PlannedUnit("scene", "A", "a", True, duration_seconds=900),
                PlannedUnit("scene", "B", "b", True, duration_seconds=900)]
        self.assertEqual(split_oversized_units(plan, 1800, "feature_film"), 2)
        titles = [u.title for u in plan]
        self.assertEqual(titles[0], "A (Part 1 of 8)")
        self.assertEqual(titles[-1], "B (Part 8 of 8)")
        self.assertTrue(titles.index("A (Part 8 of 8)") < titles.index("B (Part 1 of 8)"))

    def test_every_runtime_and_type_ends_in_range(self) -> None:
        """Worst case for each preset: the model always returns a single scene."""
        cases = [
            ("feature_film", "1 hr"), ("feature_film", "30 min"), ("feature_film", "120 min"),
            ("short_film", "3 min"), ("short_film", "15 min"), ("music_video", "3 min"),
            ("documentary", "30 min"), ("advertisement", "30 sec"), ("explainer", "90 sec"),
            ("educational", "10 min"),
        ]
        for type_key, duration in cases:
            with self.subTest(type=type_key, duration=duration):
                type_config = CONFIG.project_type(type_key)
                leaf = type_config.leaf_unit.key
                reply = json.dumps({"units": [{"unit_type": leaf, "title": "Only", "summary": "All of it.", "duration_seconds": 60}]})
                plan, report = plan_to_runtime(FakeModel(reply), "PROMPT", type_config, duration)
                self.assertTrue(report["fits"], report)
                target = parse_duration_seconds(duration)
                assert target is not None
                self.assert_fits(plan, target, type_key)

    def test_unreadable_duration_skips_the_check(self) -> None:
        model = FakeModel(_model_plan(3))
        plan, report = plan_to_runtime(model, "PROMPT", FILM, "")
        self.assertEqual(len(model.prompts), 1)
        self.assertEqual(len(leaf_units(plan)), 3)

    def test_unusable_replies_raise(self) -> None:
        with self.assertRaises(PlanError):
            plan_to_runtime(FakeModel("not json at all"), "PROMPT", FILM, "30 min")


class PacingTests(unittest.TestCase):
    """The pacing chosen on the idea form decides how many scenes a runtime holds."""

    def test_one_hour_feature_film_scene_counts(self) -> None:
        self.assertEqual(target_unit_count(3600, "feature_film", "action"), 50)
        self.assertEqual(target_unit_count(3600, "feature_film", "comedy"), 38)
        self.assertEqual(target_unit_count(3600, "feature_film", ""), 30)
        self.assertEqual(target_unit_count(3600, "feature_film", "drama"), 24)
        self.assertEqual(unit_count_range(3600, "feature_film", "action"), (31, 84))
        self.assertEqual(unit_count_range(3600, "feature_film", "drama"), (15, 40))

    def test_action_has_more_shorter_scenes_and_shots_than_drama(self) -> None:
        for runtime in (180, 900, 1800, 3600, 7200):
            with self.subTest(runtime=runtime):
                action = target_unit_count(runtime, "feature_film", "action")
                comedy = target_unit_count(runtime, "feature_film", "comedy")
                drama = target_unit_count(runtime, "feature_film", "drama")
                self.assertGreaterEqual(action, comedy)
                self.assertGreaterEqual(comedy, drama)
        self.assertLess(max_unit_seconds(3600, "feature_film", "action"), max_unit_seconds(3600, "feature_film", "drama"))
        self.assertLess(average_shot_seconds("feature_film", "action"), average_shot_seconds("feature_film", "drama"))
        self.assertGreaterEqual(average_shot_seconds("advertisement", "action"), MIN_CLIP_SECONDS)

    def test_long_runtimes_ask_for_more_than_the_target(self) -> None:
        # Short runtimes: the model hit its target, so it is asked for the target itself.
        self.assertEqual(requested_unit_count(1800, "feature_film", "action"), 25)
        self.assertEqual(requested_unit_count(30, "advertisement"), 5)
        # From 45 minutes: 1.4x the target, capped at the top of the range.
        self.assertEqual(requested_unit_count(3600, "feature_film", "action"), 70)
        self.assertEqual(requested_unit_count(3600, "feature_film", "drama"), 34)
        self.assertEqual(requested_unit_count(7200, "feature_film", "action"), 140)
        for pacing in ("action", "comedy", "drama", ""):
            for runtime in (2700, 3600, 7200, 10800):
                with self.subTest(pacing=pacing, runtime=runtime):
                    _, high = unit_count_range(runtime, "feature_film", pacing)
                    self.assertLessEqual(requested_unit_count(runtime, "feature_film", pacing), high)

    def test_unknown_pacing_uses_type_defaults(self) -> None:
        self.assertEqual(normalize_pacing(" Action "), "action")
        self.assertEqual(normalize_pacing("thriller"), "")
        self.assertEqual(unit_count_range(3600, "feature_film", "thriller"), unit_count_range(3600, "feature_film"))

    def test_plan_prompt_states_pacing_and_target_count(self) -> None:
        prompt = build_plan_prompt(FILM, FILM.default_format, "Outline:", "A heist.", "- none", "1 hr", "action")
        # 1 hour is a long runtime: the prompt asks for 1.4x the target of 50.
        self.assertIn("Plan about 70 scenes (never fewer than 31 or more than 84)", prompt)
        self.assertIn("Pacing: ACTION", prompt)
        drama = build_plan_prompt(FILM, FILM.default_format, "Outline:", "A heist.", "- none", "1 hr", "drama")
        self.assertIn("Plan about 34 scenes", drama)

    def test_same_plan_fits_drama_but_is_sent_back_for_action(self) -> None:
        reply = _model_plan(20, 180)  # 20 scenes of 3 minutes for 1 hour
        drama_model = FakeModel(reply)
        _, drama = plan_to_runtime(drama_model, "PROMPT", FILM, "1 hr", pacing="drama")
        self.assertEqual(len(drama_model.prompts), 1)
        self.assertTrue(drama["fits"])

        action_model = FakeModel(reply, _model_plan(50, 72))
        plan, action = plan_to_runtime(action_model, "PROMPT", FILM, "1 hr", pacing="action")
        self.assertEqual(len(action_model.prompts), 2)
        self.assertIn("plan about 70 (between 31 and 84)", action_model.prompts[1])
        self.assertTrue(action["fits"])
        self.assertEqual(action["pacing"], "action")
        self.assertEqual(len(leaf_units(plan)), 50)

    def test_action_shots_are_shorter_without_a_budget(self) -> None:
        self.assertEqual(allocate_shot_durations(None, [1, 1], "feature_film", pacing="action"), [4, 4])
        self.assertEqual(allocate_shot_durations(None, [1, 1], "feature_film", pacing="drama"), [7, 7])

    def test_runtime_is_read_from_idea_metadata(self) -> None:
        runtime = runtime_from_idea_metadata({"duration": "1 hr", "pacing": "comedy"})
        self.assertEqual((runtime.target_seconds, runtime.pacing), (3600, "comedy"))
        brief = runtime_from_idea_metadata({"brief": {"duration": "30 sec"}})
        self.assertEqual((brief.target_seconds, brief.pacing), (30, ""))
        self.assertIsNone(runtime_from_idea_metadata(None).target_seconds)


class PlanScriptTests(unittest.TestCase):
    def plan(self, model, duration: str, pacing: str = ""):
        return plan_script(model, FILM, FILM.default_format, "Outline:", "A story.", "- none", duration, pacing)

    def test_long_film_is_planned_in_one_call(self) -> None:
        model = FakeModel(_model_plan(60, 60))
        plan, report = self.plan(model, "1 hr", "action")
        self.assertEqual(len(model.prompts), 1)
        self.assertIn("Plan about 70 scenes", model.prompts[0])
        self.assertTrue(report["fits"])
        self.assertEqual(_total(leaf_units(plan)), 3600)

    def test_short_runtime_uses_one_call(self) -> None:
        model = FakeModel(_model_plan(25, 72))
        _, report = self.plan(model, "30 min", "action")
        self.assertEqual(len(model.prompts), 1)
        self.assertIn("Plan about 25 scenes", model.prompts[0])
        self.assertTrue(report["fits"])


if __name__ == "__main__":
    unittest.main()
