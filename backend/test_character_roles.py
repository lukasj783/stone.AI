"""Character types decide presence: voice-only characters are heard, never drawn."""

import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from routers import story
from schemas.script import UpdateCharacterProfilePayload
from services import character_ranking
from services import character_sheet as cs
from services import storyboard_generation as sg
from services.character_views import (
    addresses_camera,
    build_script_character_profile,
    effective_character_profile,
    is_on_camera,
    role_summary,
)
from services.script_config import build_engine_config

FIXTURE = Path(__file__).parent / "test_fixtures" / "script_engine_config.json"
CONFIG = build_engine_config(json.loads(FIXTURE.read_text(encoding="utf-8")))
TYPES = CONFIG.character_type_configs

NARRATOR = {"id": "n1", "name": "Announcer", "character_type": "narrator", "tags": [], "metadata": {"source": "script"}}
SPOKESPERSON = {
    "id": "s1", "name": "AMINA", "character_type": "spokesperson", "tags": [],
    "type_details": {"brand": "Pepsi", "brand_look": "blue jacket with the logo"},
    "physical": {"hair": "short black braids"}, "metadata": {"source": "script"},
}


class _FakeQuery:
    def __init__(self, rows):
        self.rows = rows

    def __getattr__(self, name):
        return lambda *args, **kwargs: self

    def execute(self):
        return SimpleNamespace(data=self.rows)


def _fake_supabase(tables: dict) -> MagicMock:
    supabase = MagicMock()
    supabase.table.side_effect = lambda name: _FakeQuery(tables.get(name, []))
    return supabase


class ConfigTests(unittest.TestCase):
    def test_project_types_offer_their_own_character_types(self) -> None:
        advert = CONFIG.project_type("advertisement").character_types
        self.assertEqual(advert[:2], ("spokesperson", "narrator"))
        self.assertNotIn("interviewee", advert)
        self.assertIn("interviewee", CONFIG.project_type("documentary").character_types)

    def test_types_carry_presence_and_details(self) -> None:
        self.assertTrue(TYPES["narrator"].voice_only)
        self.assertFalse(TYPES["host"].voice_only)
        self.assertTrue(TYPES["spokesperson"].addresses_camera)
        self.assertIn("brand", TYPES["spokesperson"].detail_keys)
        self.assertEqual(TYPES["main"].detail_fields, ())

    def test_every_type_is_offered_when_a_project_type_has_no_list(self) -> None:
        tables = json.loads(FIXTURE.read_text(encoding="utf-8"))
        tables["project_type_character_types"] = []
        config = build_engine_config(tables)
        self.assertEqual(len(config.project_type("advertisement").character_types), len(tables["character_types"]))


class PresenceTests(unittest.TestCase):
    def test_type_decides_unless_the_character_overrides_it(self) -> None:
        self.assertFalse(is_on_camera(NARRATOR, TYPES))
        self.assertTrue(is_on_camera({**NARRATOR, "on_camera": True}, TYPES))
        self.assertTrue(is_on_camera(SPOKESPERSON, TYPES))
        self.assertFalse(is_on_camera({**SPOKESPERSON, "metadata": {"manual_overrides": {"on_camera": False}}}, TYPES))

    def test_manual_type_change_moves_the_character_off_camera(self) -> None:
        moved = {**SPOKESPERSON, "metadata": {"manual_overrides": {"character_type": "narrator"}}}
        self.assertFalse(is_on_camera(moved, TYPES))

    def test_unknown_type_or_missing_config_counts_as_on_camera(self) -> None:
        self.assertTrue(is_on_camera({"name": "X", "character_type": "mystery"}, TYPES))
        self.assertTrue(is_on_camera(NARRATOR, {}))

    def test_presenters_address_the_camera(self) -> None:
        self.assertTrue(addresses_camera(SPOKESPERSON, TYPES))
        self.assertFalse(addresses_camera({**SPOKESPERSON, "character_type": "main"}, TYPES))


class ProfileTests(unittest.TestCase):
    def test_voice_and_type_detail_overrides_merge_over_script_values(self) -> None:
        character = {
            **SPOKESPERSON,
            "voice": {"tone": "upbeat", "unknown": "dropped"},
            "metadata": {"manual_overrides": {"voice.accent": "Nairobi English", "type_details.brand": "Pepsi Max"}},
        }
        effective = effective_character_profile(character)
        self.assertEqual(effective["voice"], {"tone": "upbeat", "accent": "Nairobi English"})
        self.assertEqual(effective["type_details"]["brand"], "Pepsi Max")

    def test_role_summary_names_the_type_and_its_details(self) -> None:
        self.assertEqual(
            role_summary(SPOKESPERSON, TYPES),
            "Spokesperson; Brand represented: Pepsi; Brand look: blue jacket with the logo",
        )
        self.assertEqual(role_summary({"name": "B", "character_type": "main"}, TYPES), "")

    def test_sheet_prompt_includes_the_on_screen_role(self) -> None:
        profile = build_script_character_profile(SPOKESPERSON, None, TYPES)
        self.assertIn("On-screen role: Spokesperson; Brand represented: Pepsi", profile)


class ExtractionTests(unittest.TestCase):
    ADVERT = CONFIG.project_type("advertisement").character_type_configs

    def test_voice_only_character_keeps_no_visual_facts(self) -> None:
        normalized = story._normalize_extracted_character({
            "name": "Announcer", "character_type": "narrator", "on_camera": None,
            "physical": {"hair": "grey"}, "image_prompt": "a man at a mic",
            "voice": {"tone": "booming"}, "type_details": {"narration_style": "energetic announcer", "brand": "x"},
        }, self.ADVERT)
        self.assertEqual(normalized["physical"], {})
        self.assertEqual(normalized["image_prompt"], "")
        self.assertEqual(normalized["voice"], {"tone": "booming"})
        self.assertEqual(normalized["type_details"], {"narration_style": "energetic announcer"})
        self.assertIsNone(normalized["on_camera"])

    def test_on_camera_is_stored_only_when_it_contradicts_the_type(self) -> None:
        revealed = story._normalize_extracted_character({"name": "N", "character_type": "narrator", "on_camera": True}, self.ADVERT)
        self.assertTrue(revealed["on_camera"])
        seen = story._normalize_extracted_character({"name": "S", "character_type": "spokesperson", "on_camera": True}, self.ADVERT)
        self.assertIsNone(seen["on_camera"])

    def test_type_not_offered_by_the_project_falls_back_to_supporting(self) -> None:
        normalized = story._normalize_extracted_character({"name": "Q", "character_type": "interviewee"}, self.ADVERT)
        self.assertEqual(normalized["character_type"], "supporting")

    def test_prompt_lists_the_project_types_with_presence(self) -> None:
        captured: dict = {}

        def fake_run(client, prompt, **kwargs):
            captured["prompt"] = prompt
            return '{"characters": []}'

        with patch.object(story, "_run_gemini", side_effect=fake_run):
            story._extract_script_characters(MagicMock(), {"scenes": []}, self.ADVERT)
        self.assertIn('"narrator" (voice only: heard, never seen)', captured["prompt"])
        self.assertIn("type_details keys: brand, spokesperson_kind", captured["prompt"])
        self.assertNotIn('"interviewee"', captured["prompt"])


class ProfileUpdateTests(unittest.TestCase):
    def _apply(self, character: dict, **fields) -> dict:
        overrides: dict = dict((character.get("metadata") or {}).get("manual_overrides") or {})
        payload = UpdateCharacterProfilePayload(project_id="p1", character_id=character["id"], **fields)
        context = SimpleNamespace(type_config=CONFIG.project_type("advertisement"))
        with patch.object(story, "load_project_script_context", return_value=context), patch.object(
            story, "character_type_map", return_value=TYPES
        ):
            story._apply_role_overrides(payload, character, overrides)
        return overrides

    def test_type_must_be_offered_by_the_project_type(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            self._apply(SPOKESPERSON, character_type="interviewee")
        self.assertEqual(raised.exception.status_code, 400)

    def test_type_change_and_presence_choice(self) -> None:
        self.assertEqual(self._apply(SPOKESPERSON, character_type="narrator"), {"character_type": "narrator"})
        # The script's own type is no override.
        self.assertEqual(self._apply(SPOKESPERSON, character_type="spokesperson"), {})
        # Showing a narrator on screen is an override; hiding them again is not.
        self.assertEqual(self._apply(NARRATOR, on_camera=True), {"on_camera": True})
        self.assertEqual(self._apply(NARRATOR, on_camera=False), {})

    def test_voice_and_details_set_and_clear(self) -> None:
        character = {**SPOKESPERSON, "metadata": {"manual_overrides": {"voice.tone": "flat"}}}
        overrides = self._apply(character, voice={"tone": "", "accent": "Kenyan"}, type_details={"brand": "Pepsi Max"})
        self.assertEqual(overrides, {"voice.accent": "Kenyan", "type_details.brand": "Pepsi Max"})
        with self.assertRaises(HTTPException):
            self._apply(SPOKESPERSON, voice={"volume": "loud"})


class StoryboardTests(unittest.TestCase):
    CAST = sg.speaker_cast([NARRATOR, SPOKESPERSON, {"name": "BOB", "character_type": "main", "tags": []}], TYPES)

    def test_voice_only_speakers_get_no_speaker_frame(self) -> None:
        beats = sg._build_scene_beats([
            {"id": "b1", "block_type": "dialogue", "content": "Refresh your day.", "character_name": "ANNOUNCER", "sort_order": 1},
        ], cast=self.CAST)
        self.assertEqual(beats, [])

    def test_spokesperson_speaks_to_the_lens(self) -> None:
        beats = sg._build_scene_beats([
            {"id": "b1", "block_type": "dialogue", "content": "Try it.", "character_name": "Amina", "sort_order": 1},
            {"id": "b2", "block_type": "dialogue", "content": "Ok.", "character_name": "BOB", "sort_order": 2},
        ], cast=self.CAST)
        self.assertEqual([beat["text"] for beat in beats], ["Amina speaks directly to camera", "BOB speaks"])
        plan = sg._deterministic_shot_plan(beats[0], is_first_action=False)
        self.assertIn("eye contact with the lens", plan["beat_line"])

    def test_voice_only_characters_never_reach_the_frame_cast(self) -> None:
        supabase = _fake_supabase({"characters": [NARRATOR, SPOKESPERSON], "scenes": {"location": "SHOP"}})
        with patch.object(sg, "require_supabase_client", return_value=supabase), patch.object(
            sg, "_attach_importance_tiers"
        ), patch.object(sg, "character_type_map", return_value=TYPES):
            characters, _, _ = sg._gather_scene_linked_entities("p1", "scene-1", [])
        self.assertEqual([c["name"] for c in characters], ["AMINA"])
        self.assertIn("Brand represented: Pepsi", sg._describe_character(characters[0]))


class SheetAndRankingTests(unittest.TestCase):
    def test_voice_only_character_gets_no_sheet(self) -> None:
        with patch.object(cs, "load_project_character", return_value=NARRATOR), patch.object(
            cs, "character_type_map", return_value=TYPES
        ), patch.object(cs, "generate_provider_images") as provider:
            with self.assertRaises(cs.VoiceOnlyCharacterError):
                cs.generate_model_sheet("p1", "n1")
        provider.assert_not_called()

    def test_ranking_skips_voice_only_characters(self) -> None:
        supabase = _fake_supabase({"characters": [NARRATOR, SPOKESPERSON], "scenes": [], "script_blocks": []})
        with patch.object(character_ranking, "require_supabase_client", return_value=supabase), patch.object(
            character_ranking, "character_type_map", return_value=TYPES
        ), patch.object(character_ranking, "rank_characters", return_value={}) as rank:
            character_ranking.rank_characters_from_script("p1")
        self.assertEqual([c["name"] for c in rank.call_args.args[0]], ["AMINA"])


if __name__ == "__main__":
    unittest.main()
