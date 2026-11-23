"""Scene voice lines: who speaks each line, with which voice, and what gets saved."""

import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx

from services import elevenlabs_client, voice_generation as vg
from services.script_config import build_engine_config

FIXTURE = Path(__file__).parent / "test_fixtures" / "script_engine_config.json"
CONFIG = build_engine_config(json.loads(FIXTURE.read_text(encoding="utf-8")))
FILM = CONFIG.project_type("feature_film")
DOCUMENTARY = CONFIG.project_type("documentary")

JOEL = {"id": "c-joel", "name": "Joel", "tags": ["JOE"], "metadata": {"tts": {"voice_id": "v-joel", "voice_name": "George"}}}
AMINA = {"id": "c-amina", "name": "Amina", "tags": [], "metadata": {}}
NARRATOR = vg.ProjectAudioSettings(narrator=vg.VoiceChoice("v-narrator", "Rachel"))


def block(block_id: str, block_type: str, content: str, order: int, **extra) -> dict:
    return {"id": block_id, "scene_id": "s1", "block_type": block_type, "content": content, "sort_order": order, **extra}


class PlanTests(unittest.TestCase):
    def plan(self, blocks, characters=(JOEL, AMINA), audio=NARRATOR, type_config=FILM):
        return vg.plan_scene_lines(blocks, type_config, vg.CharacterIndex.build(characters), audio)

    def test_dialogue_uses_the_character_voice_and_parenthetical_tags(self) -> None:
        lines = self.plan([
            block("b1", "action", "JOEL enters.", 1),
            block("b2", "dialogue", "You came back.", 2, character_name="JOEL (V.O.)", parenthetical="(to Amina, laughing)"),
        ])
        self.assertEqual(len(lines), 1)
        line = lines[0]
        self.assertEqual((line.kind, line.speaker, line.voice_id, line.character_id), ("dialogue", "Joel", "v-joel", "c-joel"))
        self.assertEqual(line.text, "[laughs] You came back.")
        self.assertEqual(line.dropped_directions, ["to Amina"])

    def test_parenthetical_block_directs_the_next_line_only(self) -> None:
        lines = self.plan([
            block("p1", "parenthetical", "(whispering)", 1),
            block("b1", "dialogue", "Quiet.", 2, character_id="c-joel"),
            block("b2", "dialogue", "Why?", 3, character_id="c-joel"),
        ])
        self.assertEqual([line.text for line in lines], ["[whispers] Quiet.", "Why?"])

    def test_aliases_match_speakers_and_unvoiced_characters_are_reported(self) -> None:
        lines = self.plan([
            block("b1", "dialogue", "Hey.", 1, character_name="JOE"),
            block("b2", "dialogue", "Hi.", 2, character_name="AMINA"),
            block("b3", "dialogue", "Who?", 3, character_name="STRANGER"),
        ])
        self.assertEqual(lines[0].voice_id, "v-joel")
        self.assertEqual(vg.missing_voices(lines), ["Amina", "STRANGER"])

    def test_action_is_narrated_only_when_enabled(self) -> None:
        blocks = [block("b1", "action", "JOEL slams the door. The TV flickers.", 1)]
        self.assertEqual(self.plan(blocks), [])
        audio = vg.ProjectAudioSettings(narrator=NARRATOR.narrator, narrate_action=True)
        [line] = self.plan(blocks, audio=audio)
        self.assertEqual((line.kind, line.speaker, line.voice_id), ("action", "Narrator", "v-narrator"))
        self.assertEqual(line.text, "Joel slams the door. The TV flickers.")

    def test_unattributed_narration_goes_to_the_narrator(self) -> None:
        lines = self.plan([
            block("b1", "narration", "In 1998, the river rose.", 1),
            block("b2", "interview", "I lost everything.", 2, character_name="Amina"),
        ], type_config=DOCUMENTARY, audio=vg.ProjectAudioSettings())
        self.assertEqual([line.kind for line in lines], ["narration", "dialogue"])
        self.assertEqual(vg.missing_voices(lines), ["Narrator", "Amina"])
        self.assertIn("narrator voice", vg.missing_voice_message(["Narrator"]))

    def test_lines_with_no_words_are_skipped(self) -> None:
        self.assertEqual(self.plan([block("b1", "dialogue", "(V.O.)", 1, character_id="c-joel")]), [])


class AudioSettingsTests(unittest.TestCase):
    def test_settings_read_from_project(self) -> None:
        audio = vg.project_audio_settings({"settings": {"audio": {
            "narrator_voice_id": "v1", "narrator_voice_name": "Rachel", "language_code": "SW", "narrate_action": True,
        }}})
        self.assertEqual(audio, vg.ProjectAudioSettings(vg.VoiceChoice("v1", "Rachel"), "sw", True))
        self.assertEqual(vg.project_audio_settings({"settings": None}), vg.ProjectAudioSettings())

    def test_language_code_must_be_iso(self) -> None:
        self.assertEqual(vg.normalize_language_code(" sw "), "sw")
        self.assertIsNone(vg.normalize_language_code(""))
        with self.assertRaises(ValueError):
            vg.normalize_language_code("Swahili")

    def test_mp3_duration_comes_from_the_bitrate(self) -> None:
        self.assertEqual(vg.estimate_duration_seconds(b"x" * 32_000, "mp3_44100_128"), 2.0)
        self.assertIsNone(vg.estimate_duration_seconds(b"x" * 10, "pcm_24000"))
        self.assertEqual(vg.audio_file_type("mp3_44100_128"), ("audio/mpeg", "mp3"))


class _Query:
    """Records writes and answers selects from in-memory tables."""

    def __init__(self, db: "_FakeDb", table: str) -> None:
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None

    def select(self, *_args, **_kwargs):
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, column, value):
        self.filters.append((column, lambda v, value=value: v == value))
        return self

    def in_(self, column, values):
        self.filters.append((column, lambda v, values=tuple(values): v in values))
        return self

    def order(self, *_args, **_kwargs):
        return self

    def _matches(self, row) -> bool:
        return all(test(row.get(column)) for column, test in self.filters)

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "insert":
            row = {"id": f"{self.table}-{len(rows) + 1}", "created_at": f"t{len(rows) + 1:03}", **(self.payload or {})}
            rows.append(row)
            return SimpleNamespace(data=[row])
        if self.op == "delete":
            self.db.tables[self.table] = [row for row in rows if not self._matches(row)]
            return SimpleNamespace(data=[])
        if self.op == "update":
            for row in rows:
                if self._matches(row):
                    row.update(self.payload)
            return SimpleNamespace(data=[])
        return SimpleNamespace(data=[dict(row) for row in rows if self._matches(row)])


class _FakeDb:
    def __init__(self, tables):
        self.tables = tables
        self.uploads: list[str] = []
        self.removed: list[str] = []
        bucket = SimpleNamespace(
            upload=lambda file, path, file_options: self.uploads.append(path),
            get_public_url=lambda path: f"https://cdn/{path}",
            remove=lambda paths: self.removed.extend(paths),
        )
        self.storage = SimpleNamespace(from_=lambda _name: bucket)

    def table(self, name):
        return _Query(self, name)


class GenerateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = _FakeDb({
            "projects": [{"id": "p1", "project_type": "feature_film", "settings": {"audio": {"language_code": "sw"}}}],
            "scenes": [{"id": "s1", "project_id": "p1", "sort_order": 1}],
            "script_blocks": [
                {**block("b1", "dialogue", "Habari!", 1, character_id="c-joel", parenthetical="(excited)"), "project_id": "p1"},
                {**block("b2", "dialogue", "Nzuri.", 2, character_id="c-amina"), "project_id": "p1"},
            ],
            "characters": [{**JOEL, "project_id": "p1"}, {**AMINA, "project_id": "p1", "metadata": {"tts": {"voice_id": "v-amina"}}}],
            "voice_lines": [{"id": "old-1", "project_id": "p1", "scene_id": "s1", "script_block_id": "b1",
                             "text": "old", "audio_asset_id": "a-old", "status": "complete", "metadata": {}, "created_at": "t000"}],
            "assets": [{"id": "a-old", "url": "https://cdn/old.mp3", "storage_path": "p1/s1/old.mp3", "duration_seconds": 1}],
        })
        self.settings = SimpleNamespace(
            elevenlabs_api_key="key", elevenlabs_model="eleven_v4", elevenlabs_output_format="mp3_44100_128",
            elevenlabs_max_concurrency=2, audio_storage_bucket="output-audio",
        )
        context = SimpleNamespace(project=self.db.tables["projects"][0], type_config=FILM)
        self.patches = [
            patch.object(vg, "require_supabase_client", return_value=self.db),
            patch.object(vg, "get_settings", return_value=self.settings),
            patch.object(vg, "load_project_script_context", return_value=context),
        ]
        for item in self.patches:
            item.start()
        self.spoken: list[tuple[str, str, str | None]] = []

    def tearDown(self) -> None:
        for item in self.patches:
            item.stop()

    def fake_speech(self, **kwargs):
        self.spoken.append((kwargs["voice_id"], kwargs["text"], kwargs["language_code"]))
        return b"x" * 16_000

    def test_scene_generation_speaks_saves_and_replaces_old_clips(self) -> None:
        with patch.object(vg, "synthesize_speech", side_effect=self.fake_speech):
            result = vg.generate_scene_audio("p1", "s1")
        self.assertEqual(sorted(self.spoken), [("v-amina", "Nzuri.", "sw"), ("v-joel", "[excited] Habari!", "sw")])
        self.assertEqual(result["failed"], 0)
        self.assertTrue(all(line["audio_url"] and not line["is_stale"] for line in result["lines"]))
        self.assertEqual(result["lines"][0]["duration_seconds"], 1.0)
        lines = self.db.tables["voice_lines"]
        self.assertEqual(sorted(row["script_block_id"] for row in lines), ["b1", "b2"])
        self.assertNotIn("old-1", [row["id"] for row in lines])
        self.assertEqual(self.db.removed, ["p1/s1/old.mp3"])
        self.assertEqual(lines[0]["metadata"]["voice_id"] if lines[0]["script_block_id"] == "b1" else lines[1]["metadata"]["voice_id"], "v-joel")

    def test_one_line_can_be_regenerated(self) -> None:
        with patch.object(vg, "synthesize_speech", side_effect=self.fake_speech):
            vg.generate_scene_audio("p1", "s1", block_ids=["b2"])
        self.assertEqual(self.spoken, [("v-amina", "Nzuri.", "sw")])
        self.assertIn("old-1", [row["id"] for row in self.db.tables["voice_lines"]])

    def test_missing_voice_stops_before_any_request(self) -> None:
        self.db.tables["characters"][1]["metadata"] = {}
        with patch.object(vg, "synthesize_speech", side_effect=self.fake_speech):
            with self.assertRaisesRegex(ValueError, "Amina"):
                vg.generate_scene_audio("p1", "s1")
        self.assertEqual(self.spoken, [])

    def test_a_failed_line_keeps_the_others_and_its_old_clip(self) -> None:
        def flaky(**kwargs):
            if kwargs["voice_id"] == "v-joel":
                raise elevenlabs_client.ElevenLabsError("ElevenLabs returned 429: too many requests", 429)
            return b"x" * 100
        with patch.object(vg, "synthesize_speech", side_effect=flaky):
            result = vg.generate_scene_audio("p1", "s1")
        self.assertEqual(result["failed"], 1)
        joel = next(line for line in result["lines"] if line["block_id"] == "b1")
        self.assertIn("429", joel["error"])
        self.assertIn("old-1", [row["id"] for row in self.db.tables["voice_lines"]])

    def test_preview_marks_clips_whose_text_changed(self) -> None:
        result = vg.load_scene_audio("p1", "s1")
        joel = next(line for line in result["lines"] if line["block_id"] == "b1")
        self.assertEqual(joel["text"], "[excited] Habari!")
        self.assertTrue(joel["is_stale"])
        self.assertEqual(result["missing_voices"], [])


class CloneTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = _FakeDb({
            "projects": [{"id": "p1", "settings": {}}],
            "characters": [{"id": "c-amina", "project_id": "p1", "name": "Amina", "metadata": {"source": "script"}}],
        })
        settings = SimpleNamespace(elevenlabs_api_key="key")
        self.patches = [
            patch.object(vg, "require_supabase_client", return_value=self.db),
            patch.object(vg, "get_settings", return_value=settings),
        ]
        for item in self.patches:
            item.start()
        self.sample = vg.CloneSample("amina.mp3", b"audio", "audio/mpeg")

    def tearDown(self) -> None:
        for item in self.patches:
            item.stop()

    def clone(self, **overrides):
        arguments = dict(name="Amina", samples=[self.sample], consent_confirmed=True, character_id="c-amina")
        arguments.update(overrides)
        return vg.clone_and_assign("p1", **arguments)

    def test_clone_is_assigned_to_the_character_with_a_consent_record(self) -> None:
        cloned = elevenlabs_client.ClonedVoice("v-new", requires_verification=True)
        with patch.object(vg, "clone_voice", return_value=cloned) as clone_voice:
            result = self.clone(description="Warm Swahili narrator")
        self.assertEqual(result, {"voice_id": "v-new", "name": "Amina", "requires_verification": True, "assigned_to": "c-amina"})
        self.assertEqual(clone_voice.call_args.kwargs["samples"], [("amina.mp3", b"audio", "audio/mpeg")])
        metadata = self.db.tables["characters"][0]["metadata"]
        self.assertEqual(metadata["source"], "script")
        self.assertEqual(metadata["tts"]["voice_id"], "v-new")
        self.assertTrue(metadata["tts"]["clone"]["requires_verification"])
        self.assertIn("consent_confirmed_at", metadata["tts"]["clone"])

    def test_picking_the_same_voice_again_keeps_the_consent_record(self) -> None:
        with patch.object(vg, "clone_voice", return_value=elevenlabs_client.ClonedVoice("v-new")):
            self.clone()
        vg.set_character_voice("p1", "c-amina", "v-new", "Amina")
        self.assertIn("clone", self.db.tables["characters"][0]["metadata"]["tts"])
        vg.set_character_voice("p1", "c-amina", "v-other", "Rachel")
        self.assertNotIn("clone", self.db.tables["characters"][0]["metadata"]["tts"])

    def test_clone_can_become_the_narrator(self) -> None:
        with patch.object(vg, "clone_voice", return_value=elevenlabs_client.ClonedVoice("v-nar")):
            result = self.clone(character_id=None, as_narrator=True)
        self.assertEqual(result["assigned_to"], "narrator")
        audio = self.db.tables["projects"][0]["settings"]["audio"]
        self.assertEqual((audio["narrator_voice_id"], audio["narrator_voice_name"]), ("v-nar", "Amina"))
        self.assertIn("consent_confirmed_at", audio["narrator_clone"])

    def test_nothing_is_cloned_without_consent_or_a_valid_target(self) -> None:
        with patch.object(vg, "clone_voice") as clone_voice:
            with self.assertRaisesRegex(ValueError, "permission"):
                self.clone(consent_confirmed=False)
            with self.assertRaisesRegex(ValueError, "Character was not found"):
                self.clone(character_id="missing")
            with self.assertRaisesRegex(ValueError, "not an audio file"):
                self.clone(samples=[vg.CloneSample("notes.pdf", b"x", "application/pdf")])
            with self.assertRaisesRegex(ValueError, "at most"):
                self.clone(samples=[self.sample] * (vg.MAX_CLONE_SAMPLES + 1))
            with self.assertRaisesRegex(ValueError, "not both"):
                self.clone(as_narrator=True)
        clone_voice.assert_not_called()

    def test_m4a_sent_as_octet_stream_is_accepted(self) -> None:
        vg.validate_clone_samples([vg.CloneSample("voice.m4a", b"x", "application/octet-stream")])


class DesignTests(unittest.TestCase):
    AMINA_PROFILE = {
        "id": "c-amina", "project_id": "p1", "name": "Amina", "age": 34, "gender": "Female", "tags": [],
        "personality": "Proud market trader.", "voice": {"tone": "warm", "pace": "unhurried"},
        "metadata": {"manual_overrides": {"voice.accent": "coastal Swahili"}},
    }

    def setUp(self) -> None:
        line = "Karibu sokoni! Matunda haya ni matamu sana, yamechumwa leo asubuhi kutoka shambani kwetu."
        self.db = _FakeDb({
            "projects": [{"id": "p1", "project_type": "feature_film", "settings": {"audio": {"language_code": "sw"}}}],
            "scenes": [{"id": "s1", "project_id": "p1", "sort_order": 1}],
            "characters": [dict(self.AMINA_PROFILE)],
            "script_blocks": [
                {**block("b1", "dialogue", line, 1, character_id="c-amina", parenthetical="(cheerfully)"), "project_id": "p1"},
                {**block("b2", "dialogue", line, 2, character_id="c-amina"), "project_id": "p1"},
            ],
        })
        settings = SimpleNamespace(elevenlabs_api_key="key", elevenlabs_design_model="eleven_ttv_v3")
        context = SimpleNamespace(project=self.db.tables["projects"][0], type_config=FILM)
        self.patches = [
            patch.object(vg, "require_supabase_client", return_value=self.db),
            patch.object(vg, "get_settings", return_value=settings),
            patch.object(vg, "load_project_script_context", return_value=context),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self) -> None:
        for item in self.patches:
            item.stop()

    def test_description_comes_from_the_profile_and_overrides(self) -> None:
        text = vg.describe_character_voice(self.AMINA_PROFILE, "sw", ["cheerfully"])
        self.assertEqual(text, "A 34-year-old female voice speaking Swahili. Tone: warm. Accent: coastal Swahili. "
                               "Pace: unhurried. Personality: Proud market trader. Typical delivery in the script: cheerfully. "
                               + vg.DESIGN_RECORDING_NOTE)
        self.assertTrue(vg.describe_character_voice({"name": "X", "age": 80}, None).startswith("An 80-year-old voice."))
        self.assertEqual(vg.describe_character_voice({"name": "X"}, None), f"A voice. {vg.DESIGN_RECORDING_NOTE}")
        self.assertIn("for an advertisement.", vg.describe_narrator_voice("Advertisement", None))

    def test_delivery_hints_rank_the_most_used_directions(self) -> None:
        lines = vg.plan_scene_lines([
            block("b1", "dialogue", "A.", 1, character_id="c-joel", parenthetical="(warm, beat)"),
            block("b2", "dialogue", "B.", 2, character_id="c-joel", parenthetical="(excited, warm)"),
        ], FILM, vg.CharacterIndex.build([JOEL]), NARRATOR)
        self.assertEqual(vg.delivery_hints(lines), ["warm", "excited"])

    def test_suggestion_uses_the_characters_own_lines_without_tags(self) -> None:
        suggestion = vg.suggest_voice_design("p1", "c-amina")
        self.assertEqual(suggestion["voice_name"], "Amina")
        self.assertTrue(suggestion["sample_text"].startswith("Karibu sokoni!"))
        self.assertNotIn("[", suggestion["sample_text"])
        self.assertTrue(100 <= len(suggestion["sample_text"]) <= 1000)
        narrator = vg.suggest_voice_design("p1", "narrator")
        self.assertIn("narrator voice speaking Swahili", narrator["description"])
        self.assertIn("Typical delivery in the script: cheerfully.", suggestion["description"])
        self.assertEqual(narrator["sample_text"], "")
        with self.assertRaisesRegex(ValueError, "Character was not found"):
            vg.suggest_voice_design("p1", "missing")

    def test_sample_text_stays_within_limits(self) -> None:
        self.assertEqual(vg.design_sample_text(["Too short."]), "")
        long = vg.design_sample_text(["word " * 400])
        self.assertTrue(100 <= len(long) <= 1000)

    def test_saving_a_preview_assigns_it_with_its_description(self) -> None:
        with patch.object(vg, "save_designed_voice", return_value="v-designed") as save:
            result = vg.save_design_and_assign(
                "p1", generated_voice_id="gen-2", voice_name="Amina", description="A warm voice", character_id="c-amina",
            )
        self.assertEqual(result, {"voice_id": "v-designed", "name": "Amina", "assigned_to": "c-amina"})
        self.assertEqual(save.call_args.kwargs["generated_voice_id"], "gen-2")
        tts = self.db.tables["characters"][0]["metadata"]["tts"]
        self.assertEqual((tts["voice_id"], tts["design"]["description"], tts["design"]["model"]), ("v-designed", "A warm voice", "eleven_ttv_v3"))
        self.assertIn("manual_overrides", self.db.tables["characters"][0]["metadata"])

    def test_designed_narrator_and_bad_targets(self) -> None:
        with patch.object(vg, "save_designed_voice", return_value="v-nar") as save:
            vg.save_design_and_assign("p1", generated_voice_id="g", voice_name="Narrator", description="Calm", as_narrator=True)
            audio = self.db.tables["projects"][0]["settings"]["audio"]
            self.assertEqual((audio["narrator_voice_id"], audio["narrator_design"]["description"]), ("v-nar", "Calm"))
            self.assertEqual(audio["language_code"], "sw")
            save.reset_mock()
            with self.assertRaisesRegex(ValueError, "Character was not found"):
                vg.save_design_and_assign("p1", generated_voice_id="g", voice_name="X", description="d", character_id="nope")
            save.assert_not_called()
        # Re-picking the same narrator voice keeps its design record; another voice drops it.
        vg.update_audio_settings("p1", {"narrator_voice_id": "v-nar", "narrator_voice_name": "Narrator"})
        self.assertIn("narrator_design", self.db.tables["projects"][0]["settings"]["audio"])
        vg.update_audio_settings("p1", {"narrator_voice_id": "v-other", "narrator_voice_name": "Rachel"})
        self.assertNotIn("narrator_design", self.db.tables["projects"][0]["settings"]["audio"])

    def test_preview_text_length_is_checked_before_calling_elevenlabs(self) -> None:
        with patch.object(vg, "design_voice") as design:
            with self.assertRaisesRegex(ValueError, "100-1000"):
                vg.design_voice_previews("A warm voice", "too short")
            with self.assertRaisesRegex(ValueError, "Describe the voice"):
                vg.design_voice_previews("  ")
            design.assert_not_called()


class CloneEndpointTests(unittest.TestCase):
    def test_multipart_upload_reaches_the_service(self) -> None:
        from fastapi.testclient import TestClient
        from main import app
        from routers import audio as audio_router

        result = {"voice_id": "v1", "name": "Amina", "requires_verification": False, "assigned_to": "c1"}
        with patch.object(audio_router, "clone_and_assign", return_value=result) as service:
            response = TestClient(app).post("/api/story/audio/voices/clone", data={
                "project_id": "p1", "name": "Amina", "consent_confirmed": "true", "character_id": "c1",
            }, files=[("files", ("a.mp3", b"abc", "audio/mpeg")), ("files", ("b.wav", b"def", "audio/wav"))])
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json(), result)
        kwargs = service.call_args.kwargs
        self.assertTrue(kwargs["consent_confirmed"])
        self.assertEqual([(s.filename, s.content) for s in kwargs["samples"]], [("a.mp3", b"abc"), ("b.wav", b"def")])

    def test_missing_consent_is_a_400(self) -> None:
        from fastapi.testclient import TestClient
        from main import app

        with patch.object(vg, "clone_voice") as clone_voice:
            response = TestClient(app).post("/api/story/audio/voices/clone", data={"project_id": "p1", "name": "Amina"},
                                            files=[("files", ("a.mp3", b"abc", "audio/mpeg"))])
        self.assertEqual(response.status_code, 400)
        self.assertIn("permission", response.json()["detail"])
        clone_voice.assert_not_called()


class ClientTests(unittest.TestCase):
    def test_clone_request_shape(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual((request.method, request.url.path), ("POST", "/v1/voices/add"))
            self.assertTrue(request.headers["content-type"].startswith("multipart/form-data"))
            body = request.content
            self.assertIn(b'name="name"\r\n\r\nAmina', body)
            self.assertIn(b'name="remove_background_noise"\r\n\r\ntrue', body)
            self.assertEqual(body.count(b'name="files"'), 2)
            return httpx.Response(200, json={"voice_id": "v-new", "requires_verification": True})
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            cloned = elevenlabs_client.clone_voice(
                api_key="key", name="Amina", samples=[("a.mp3", b"1", "audio/mpeg"), ("b.mp3", b"2", "audio/mpeg")],
                remove_background_noise=True, client=client,
            )
        self.assertEqual(cloned, elevenlabs_client.ClonedVoice("v-new", True))

    def test_design_request_and_previews(self) -> None:
        import base64
        audio = base64.b64encode(b"mp3-bytes").decode()

        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            self.assertEqual(request.url.path, "/v1/text-to-voice/design")
            self.assertEqual(body, {"voice_description": "A warm voice", "model_id": "eleven_ttv_v3", "auto_generate_text": True})
            return httpx.Response(200, json={"previews": [
                {"generated_voice_id": "g1", "audio_base_64": audio, "media_type": "audio/mpeg", "duration_secs": 4.2},
                {"generated_voice_id": "g2", "audio_base_64": "not base64!"},
            ]})
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            previews = elevenlabs_client.design_voice(api_key="key", voice_description="A warm voice", model_id="eleven_ttv_v3", client=client)
        self.assertEqual(previews, [elevenlabs_client.VoicePreview("g1", audio, "audio/mpeg", 4.2)])

    def test_design_sends_the_preview_text_and_saving_returns_the_voice(self) -> None:
        sample = "Habari " * 20

        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            if request.url.path == "/v1/text-to-voice/design":
                self.assertEqual(body["text"], sample.strip())
                self.assertNotIn("auto_generate_text", body)
                return httpx.Response(200, json={"previews": [
                    {"generated_voice_id": "g0", "audio_base_64": ""},  # empty: skipped
                    {"generated_voice_id": "g1", "audio_base_64": "bXAz"},
                ]})
            self.assertEqual(body, {"voice_name": "Amina", "voice_description": "A warm voice", "generated_voice_id": "g1"})
            return httpx.Response(200, json={"voice_id": "v-saved"})
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            previews = elevenlabs_client.design_voice(api_key="key", voice_description="A warm voice", model_id="m", text=sample, client=client)
            self.assertEqual([preview.generated_voice_id for preview in previews], ["g1"])
            voice_id = elevenlabs_client.save_designed_voice(
                api_key="key", voice_name="Amina", voice_description="A warm voice", generated_voice_id="g1", client=client,
            )
        self.assertEqual(voice_id, "v-saved")

    def test_protected_library_voice_is_explained(self) -> None:
        transport = httpx.MockTransport(lambda _r: httpx.Response(403, json={"detail": {
            "message": "Voice cannot be cloned", "data": {"library_voice_match": {"library_voice_id": "x"}},
        }}))
        with httpx.Client(transport=transport) as client, self.assertRaisesRegex(elevenlabs_client.ElevenLabsError, "protected voice"):
            elevenlabs_client.clone_voice(api_key="key", name="X", samples=[("a.mp3", b"1", "audio/mpeg")], client=client)

    def test_speech_request_shape(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.url.path, "/v1/text-to-speech/v1")
            self.assertEqual(request.url.params["output_format"], "mp3_44100_128")
            self.assertEqual(request.headers["xi-api-key"], "key")
            self.assertEqual(json.loads(request.content), {"text": "[whispers] Hi", "model_id": "eleven_v4", "language_code": "sw"})
            return httpx.Response(200, content=b"mp3")
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            audio = elevenlabs_client.synthesize_speech(
                api_key="key", voice_id="v1", text="[whispers] Hi", model_id="eleven_v4",
                output_format="mp3_44100_128", language_code="sw", client=client,
            )
        self.assertEqual(audio, b"mp3")

    def test_api_errors_carry_the_reason(self) -> None:
        transport = httpx.MockTransport(lambda _r: httpx.Response(401, json={"detail": {"status": "invalid_api_key", "message": "Invalid API key"}}))
        with httpx.Client(transport=transport) as client, self.assertRaisesRegex(elevenlabs_client.ElevenLabsError, "401: Invalid API key"):
            elevenlabs_client.synthesize_speech(api_key="bad", voice_id="v", text="x", model_id="m", output_format="mp3_44100_128", client=client)

    def test_voices_are_listed(self) -> None:
        transport = httpx.MockTransport(lambda _r: httpx.Response(200, json={"voices": [
            {"voice_id": "v1", "name": "Rachel", "category": "premade", "labels": {"accent": "american", "age": None}},
            {"name": "no id"},
        ]}))
        with httpx.Client(transport=transport) as client:
            voices = elevenlabs_client.list_voices(api_key="key", client=client)
        self.assertEqual([(v.voice_id, v.name, v.labels) for v in voices], [("v1", "Rachel", {"accent": "american"})])

    def test_missing_key_is_explained(self) -> None:
        with self.assertRaisesRegex(elevenlabs_client.ElevenLabsError, "ELEVENLABS_API_KEY"):
            elevenlabs_client.list_voices(api_key="")


if __name__ == "__main__":
    unittest.main()
