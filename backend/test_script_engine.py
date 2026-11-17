import json
import unittest
from pathlib import Path

from services.script_compiler import compile_script
from services.script_config import build_engine_config
from services.script_generation import (
    build_block_prompt,
    build_plan_prompt,
    leaf_units,
    normalize_blocks,
    normalize_unit_plan,
    parse_model_json,
)
from services import storyboard_generation as sg


FIXTURE = Path(__file__).parent / "test_fixtures" / "script_engine_config.json"
CONFIG = build_engine_config(json.loads(FIXTURE.read_text(encoding="utf-8")))


class EngineConfigTests(unittest.TestCase):
    def test_every_project_type_has_one_leaf_and_a_default_format(self) -> None:
        expected = {
            "feature_film": ("screenplay", "scene"),
            "short_film": ("screenplay", "scene"),
            "music_video": ("treatment", "segment"),
            "documentary": ("av_two_column", "scene"),
            "advertisement": ("av_two_column", "scene"),
            "explainer": ("av_two_column", "scene"),
            "educational": ("instructional", "section"),
        }
        actual = {
            key: (config.default_format.key, config.leaf_unit.key)
            for key, config in CONFIG.project_types.items()
        }
        self.assertEqual(actual, expected)

    def test_unknown_project_type_falls_back_to_feature_film(self) -> None:
        self.assertEqual(CONFIG.project_type("nonsense").key, "feature_film")
        self.assertEqual(CONFIG.project_type(None).key, "feature_film")

    def test_block_vocabularies(self) -> None:
        doc = CONFIG.project_type("documentary")
        self.assertIn("interview", doc.block_keys)
        self.assertNotIn("scene_heading", doc.block_keys)
        self.assertEqual(doc.primary_visual_block.key, "action")
        self.assertIn("b_roll", doc.visual_block_keys)
        self.assertNotIn("narration", doc.visual_block_keys)
        ad = CONFIG.project_type("advertisement")
        self.assertIn("product_shot", ad.visual_block_keys)
        edu = CONFIG.project_type("educational")
        self.assertEqual(edu.primary_visual_block.key, "visual")
        self.assertEqual(edu.primary_spoken_block.key, "narration")
        self.assertIn("interviewee", CONFIG.project_type("documentary").character_types)


class UnitPlanTests(unittest.TestCase):
    def test_documentary_tree_is_kept(self) -> None:
        plan = normalize_unit_plan({"units": [
            {"unit_type": "chapter", "title": "Roots", "summary": "Origins.", "children": [
                {"unit_type": "scene", "title": "The farm", "summary": "Amina at dawn.", "location": "Farm",
                 "duration_seconds": 40, "children": [{"unit_type": "scene", "title": "ignored child"}]},
            ]},
        ]}, CONFIG.project_type("documentary"))
        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0].unit_type, "chapter")
        self.assertFalse(plan[0].is_leaf)
        leaf = plan[0].children[0]
        self.assertEqual((leaf.unit_type, leaf.is_leaf, leaf.location, leaf.duration_seconds), ("scene", True, "Farm", 40.0))
        self.assertEqual(leaf.children, [])
        self.assertEqual(leaf.row()["slugline_raw"], "The farm")
        self.assertEqual(plan[0].row()["status"], "complete")

    def test_wrong_and_unknown_unit_types_are_relabelled(self) -> None:
        plan = normalize_unit_plan({"units": [
            # "lesson" is not a documentary unit; it has children so it becomes the first container
            {"unit_type": "lesson", "title": "Part 1", "children": [
                {"unit_type": "act", "title": "Interview"},  # no children -> leaf
            ]},
            {"unit_type": "chapter", "title": "Empty chapter", "children": []},  # dropped
            {"title": "Loose scene", "summary": "Top-level leaf is fine."},
        ]}, CONFIG.project_type("documentary"))
        self.assertEqual([u.unit_type for u in plan], ["chapter", "scene"])
        self.assertEqual(plan[0].children[0].unit_type, "scene")
        self.assertEqual([u.title for u in leaf_units(plan)], ["Interview", "Loose scene"])

    def test_child_cannot_be_shallower_than_parent(self) -> None:
        plan = normalize_unit_plan({"units": [
            {"unit_type": "lesson", "title": "L1", "children": [
                {"unit_type": "module", "title": "Bad nesting", "children": [
                    {"unit_type": "section", "title": "S1"},
                ]},
            ]},
        ]}, CONFIG.project_type("educational"))
        lesson = plan[0]
        self.assertEqual(lesson.unit_type, "lesson")
        # "module" (level 1) under a lesson (level 2) is not allowed; it has children so it
        # cannot be a leaf either, and no deeper container exists -> becomes the leaf, children dropped
        self.assertEqual([(c.unit_type, c.is_leaf) for c in lesson.children], [("section", True)])

    def test_legacy_flat_scene_plan(self) -> None:
        plan = normalize_unit_plan({"scenes": [
            {"slugline_raw": "INT. KITCHEN - DAY", "location_type": "INT.", "location": "KITCHEN", "time_of_day": "DAY", "summary": "Breakfast."},
        ]}, CONFIG.project_type("feature_film"))
        self.assertEqual(plan[0].unit_type, "scene")
        self.assertEqual(plan[0].row()["slugline_raw"], "INT. KITCHEN - DAY")

    def test_plan_prompt_lists_only_allowed_units(self) -> None:
        edu = CONFIG.project_type("educational")
        prompt = build_plan_prompt(edu, edu.default_format, "Brief:", "Teach fractions.", "- none", "10 min")
        for unit in ("module", "lesson", "section"):
            self.assertIn(f"- {unit} (level", prompt)
        self.assertNotIn("- scene (level", prompt)
        self.assertIn("Target duration: 10 min", prompt)

    def test_parse_model_json_handles_fences_and_prose(self) -> None:
        self.assertEqual(parse_model_json('```json\n{"a": 1}\n```'), {"a": 1})
        self.assertEqual(parse_model_json('Sure! {"a": [1]} hope that helps'), {"a": [1]})


class BlockNormalizationTests(unittest.TestCase):
    def test_documentary_blocks(self) -> None:
        doc = CONFIG.project_type("documentary")
        rows = normalize_blocks({"blocks": [
            {"block_type": "B-Roll", "content": "Mist over the maize field."},
            {"block_type": "narration", "content": "Every morning starts the same.", "character_name": "narrator"},
            {"block_type": "interview", "content": "Since I was ten.", "character_name": "amina",
             "metadata": {"timestamp": "00:02:15", "mood": "not a key for interview"}},
            {"block_type": "interview", "content": "No speaker given."},
            {"block_type": "scene_heading", "content": "EXT. FARM - DAY"},  # not allowed -> visual fallback
            {"block_type": "lower third", "content": "Amina, farmer"},
            {"block_type": "action", "content": ""},  # empty -> dropped
        ]}, doc)
        self.assertEqual(
            [(r.block_type, r.character_name) for r in rows],
            [("b_roll", None), ("narration", "NARRATOR"), ("interview", "AMINA"), ("interview", "INTERVIEWEE"),
             ("action", None), ("lower_third", None)],
        )
        self.assertEqual(rows[2].metadata, {"timestamp": "00:02:15"})

    def test_screenplay_character_cue_and_parenthetical(self) -> None:
        film = CONFIG.project_type("feature_film")
        rows = normalize_blocks([
            {"block_type": "character", "content": "Mara"},
            {"block_type": "dialogue", "content": "Who's there?"},
            {"block_type": "parenthetical", "content": "(whispering)"},
            {"block_type": "dialogue", "content": "No name."},
        ], film)
        self.assertEqual([(r.block_type, r.character_name) for r in rows], [
            ("dialogue", "MARA"), ("parenthetical", None), ("dialogue", "SPEAKER"),
        ])

    def test_ad_folds_parenthetical_into_previous_line(self) -> None:
        ad = CONFIG.project_type("advertisement")
        rows = normalize_blocks([
            {"block_type": "voice_over", "content": "Taste the sunshine.", "character_name": "Announcer"},
            {"block_type": "parenthetical", "content": "warmly"},
            {"block_type": "made_up", "content": "Bottle spins on a table."},
            {"block_type": "made_up", "content": "Buy now!", "character_name": "Kid"},
        ], ad)
        self.assertEqual(rows[0].parenthetical, "warmly")
        self.assertEqual([r.block_type for r in rows], ["voice_over", "action", "dialogue"])

    def test_block_prompt_lists_only_allowed_blocks(self) -> None:
        ad = CONFIG.project_type("advertisement")
        prompt = build_block_prompt(ad, ad.default_format, {"title": "Hook", "summary": "Open on thirst.", "duration_seconds": 5}, "- none", "start")
        self.assertIn("- product_shot:", prompt)
        self.assertNotIn("- interview:", prompt)
        self.assertIn("about 5 seconds", prompt)


def _unit(uid, unit_type, sort, parent=None, title="", is_leaf=True, **extra):
    return {"id": uid, "unit_type": unit_type, "sort_order": sort, "parent_id": parent, "title": title, "is_leaf": is_leaf, **extra}


def _block(uid, unit, block_type, content, sort, **extra):
    return {"id": uid, "scene_id": unit, "block_type": block_type, "content": content, "sort_order": sort, **extra}


class CompilerTests(unittest.TestCase):
    def test_two_column_rows(self) -> None:
        doc = CONFIG.project_type("documentary")
        units = [
            _unit("c1", "chapter", 0, title="Roots", is_leaf=False),
            _unit("s1", "scene", 1, parent="c1", title="The farm"),
        ]
        blocks = [
            _block("b1", "s1", "narration", "Every morning starts the same.", 0, character_name="NARRATOR"),
            _block("b2", "s1", "b_roll", "Mist over the maize.", 1),
            _block("b3", "s1", "natural_sound", "Birds.", 2),
            _block("b4", "s1", "action", "Amina walks the rows.", 3),
            _block("b5", "s1", "lower_third", "Amina, farmer", 4),
            _block("b6", "s1", "interview", "Since I was ten.", 5, character_name="AMINA", metadata={"timestamp": "00:02:15"}),
        ]
        compiled = compile_script({"id": "p", "name": "Maize"}, doc, doc.default_format, units, blocks)
        self.assertEqual(compiled.renderer, "two_column")
        scene = compiled.units[0].children[0]
        self.assertEqual(scene.heading, "SCENE 1: The farm")
        rows = [([e.block_type for e in r.video], [e.block_type for e in r.audio]) for r in scene.rows]
        self.assertEqual(rows, [
            (["b_roll"], ["narration", "natural_sound"]),
            (["action", "lower_third"], ["interview"]),
        ])
        self.assertIn("VIDEO", compiled.text)
        # The audio column wraps at the column width.
        self.assertIn("| AMINA (Interview): Since I was ten.\n", compiled.text)
        self.assertIn("| [timestamp: 00:02:15]\n", compiled.text)
        self.assertIn("=== CHAPTER 1: Roots ===", compiled.text)
        self.assertEqual(compiled.to_dict()["units"][0]["children"][0]["rows"][0]["video"][0]["text"], "Mist over the maize.")

    def test_screenplay_text(self) -> None:
        film = CONFIG.project_type("short_film")
        units = [_unit("s1", "scene", 0, slugline_raw="INT. ROOM - NIGHT")]
        blocks = [
            _block("b1", "s1", "scene_heading", "int. room - night", 0),
            _block("b2", "s1", "action", "Mara lights a candle.", 1),
            _block("b3", "s1", "dialogue", "Who's there?", 2, character_name="MARA", parenthetical="whispering"),
            _block("b4", "s1", "transition", "cut to:", 3),
        ]
        text = compile_script({"id": "p", "name": "Dark"}, film, film.default_format, units, blocks).text
        self.assertIn("INT. ROOM - NIGHT\n\nMara lights a candle.", text)
        self.assertIn(" " * 22 + "MARA\n" + " " * 16 + "(whispering)\n" + " " * 10 + "Who's there?", text)
        self.assertIn(" " * 45 + "CUT TO:", text)
        self.assertEqual(text.count("INT. ROOM - NIGHT"), 1)

    def test_instructional_quiz_and_key_point(self) -> None:
        edu = CONFIG.project_type("educational")
        units = [_unit("s1", "section", 0, title="Halves")]
        blocks = [
            _block("b1", "s1", "key_point", "Half means two equal parts.", 0),
            _block("b2", "s1", "quiz", "Check", 1, metadata={"question": "What is 1/2 of 4?", "options": ["1", "2"], "answer": "2"}),
        ]
        text = compile_script({"id": "p", "name": "Fractions"}, edu, edu.default_format, units, blocks).text
        self.assertIn("* KEY POINT: Half means two equal parts.", text)
        self.assertIn("QUIZ: What is 1/2 of 4?\n   A. 1\n   B. 2\n   Answer: 2", text)

    def test_treatment_lyrics(self) -> None:
        mv = CONFIG.project_type("music_video")
        units = [_unit("s1", "segment", 0, title="Verse 1")]
        blocks = [
            _block("b1", "s1", "lyric", "We rise", 0, metadata={"timestamp": "0:12"}),
            _block("b2", "s1", "performance", "The singer on a rooftop at dusk.", 1),
        ]
        text = compile_script({"id": "p", "name": "Rise"}, mv, mv.default_format, units, blocks).text
        self.assertIn('    "We rise"  (0:12)', text)
        self.assertIn("The singer on a rooftop at dusk.", text)


class StoryboardVocabularyTests(unittest.TestCase):
    def test_documentary_beats(self) -> None:
        vocab = sg.storyboard_vocabulary(CONFIG.project_type("documentary"))
        self.assertIn("b_roll", vocab.visual_types)
        self.assertEqual(vocab.speaker_types, frozenset({"dialogue", "interview"}))
        self.assertEqual(vocab.fallback_types, frozenset({"narration"}))
        blocks = [
            {"id": "1", "block_type": "narration", "content": "It began here.", "character_name": "NARRATOR"},
            {"id": "2", "block_type": "b_roll", "content": "Mist over the maize."},
            {"id": "3", "block_type": "transition", "content": "CUT TO:"},
            {"id": "4", "block_type": "interview", "content": "Since I was ten.", "character_name": "AMINA"},
        ]
        beats = sg._build_scene_beats(blocks, vocabulary=vocab)
        self.assertEqual([(b["kind"], b["block"]["id"]) for b in beats], [("action", "2"), ("speaker", "4")])
        plan = sg._deterministic_shot_plans(beats)
        self.assertEqual(plan[0]["beat_line"], "B-ROLL: Mist over the maize.")
        self.assertIn("answers an interview question", plan[1]["beat_line"])

    def test_narration_only_section_falls_back(self) -> None:
        vocab = sg.storyboard_vocabulary(CONFIG.project_type("educational"))
        blocks = [
            {"id": "1", "block_type": "narration", "content": "A fraction is a part of a whole."},
            {"id": "2", "block_type": "key_point", "content": "Parts of a whole."},
        ]
        beats = sg._build_scene_beats(blocks, vocabulary=vocab)
        self.assertEqual([b["block"]["id"] for b in beats], ["1"])
        line = sg._deterministic_shot_plans(beats)[0]["beat_line"]
        self.assertTrue(line.startswith("VISUAL ILLUSTRATING THIS NARRATION"), line)

    def test_film_vocabulary_matches_original_behaviour(self) -> None:
        vocab = sg.storyboard_vocabulary(CONFIG.project_type("feature_film"))
        self.assertIn("action", vocab.visual_types)
        self.assertEqual(vocab.speaker_types, frozenset({"dialogue"}))


class ScriptSchemaTests(unittest.TestCase):
    def test_non_film_units_and_blocks_validate(self) -> None:
        from schemas.script import CreativeBrief, GenerateScriptResponse

        response = GenerateScriptResponse.model_validate({
            "project_type": "documentary",
            "script_format": "av_two_column",
            "scenes": [{
                "slugline_raw": "The farm",
                "unit_type": "scene",
                "title": "The farm",
                "parent_title": "Roots",
                "duration_seconds": 40,
                "blocks": [
                    {"block_type": "interview", "content": "Since I was ten.", "character_name": "AMINA",
                     "metadata": {"timestamp": "00:02:15"}},
                    {"block_type": "b_roll", "content": "Mist over the maize."},
                ],
            }],
        })
        self.assertEqual(response.scenes[0].blocks[0].metadata, {"timestamp": "00:02:15"})
        self.assertEqual(response.scenes[0].parent_title, "Roots")
        # A unit with no slugline (an ad or lesson section) is still valid.
        self.assertEqual(GenerateScriptResponse.model_validate({"scenes": [{"title": "Hook"}]}).scenes[0].slugline_raw, "")
        self.assertEqual(CreativeBrief.model_validate({"visualStyle": "Bright, clean"}).visualStyle, "Bright, clean")


if __name__ == "__main__":
    unittest.main()
