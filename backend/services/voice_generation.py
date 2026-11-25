"""Story narration and character dialogue with ElevenLabs.

A scene's spoken script blocks become voice lines, one audio clip each:

* dialogue and interview answers are spoken by the character's ElevenLabs voice;
* narration, voice-over, instructions and calls to action by their character when the
  block names one, otherwise by the project's narrator voice;
* action lines too, read by the narrator, when the project turns on "narrate action"
  (audiobook-style story narration of a screenplay).

Parentheticals, both the block's own and a separate parenthetical block before it, become
ElevenLabs audio tags (``services.audio_tags``). Voice choices live in
``characters.metadata.tts`` and ``projects.settings.audio``; generated clips are stored as
``assets`` rows (audio files in Supabase Storage) referenced by ``voice_lines``.
"""

import base64
import logging
import re
import uuid
from collections.abc import Iterable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import PurePath
from typing import Any

import httpx

from core.config import get_settings
from core.supabase_client import require_supabase_client
from core.supabase_records import as_records
from services.audio_tags import to_elevenlabs_text
from services.character_views import VOICE_FIELDS, effective_character_profile
from services.elevenlabs_client import (
    DESIGN_TEXT_MAX_CHARS,
    DESIGN_TEXT_MIN_CHARS,
    clone_voice,
    design_voice,
    save_designed_voice,
    synthesize_speech,
)
from services.script_config import ProjectTypeConfig, load_project_script_context


logger = logging.getLogger(__name__)

PROVIDER = "elevenlabs"
TTS_METADATA_KEY = "tts"
AUDIO_SETTINGS_KEY = "audio"
NARRATOR_LABEL = "Narrator"
PARENTHETICAL_BLOCK = "parenthetical"
ACTION_BLOCK = "action"
# Spoken blocks whose speaker is required: their character's own voice speaks them.
DIALOGUE_BLOCK_TYPES = frozenset({"dialogue", "interview"})
LANGUAGE_CODE_PATTERN = re.compile(r"^[a-z]{2,3}$")

_TAG_PATTERN = re.compile(r"\[[^\[\]]*\]")
_SPEAKER_EXTENSION_PATTERN = re.compile(r"\([^()]*\)")
# 4+ capitals: names and sounds (JOEL, BANG), not acronyms (TV, FBI) or "I".
_SHOUTED_WORD_PATTERN = re.compile(r"\b[A-Z][A-Z'’\-]{3,}\b")

BLOCK_COLUMNS = "id, scene_id, block_type, content, character_id, character_name, parenthetical, dialogue_mode, metadata, sort_order"
CHARACTER_COLUMNS = "id, name, tags, character_type, voice, metadata"


@dataclass(frozen=True)
class VoiceChoice:
    voice_id: str
    voice_name: str | None = None


@dataclass(frozen=True)
class ProjectAudioSettings:
    narrator: VoiceChoice | None = None
    language_code: str | None = None
    narrate_action: bool = False


@dataclass
class PlannedLine:
    """One clip to speak, before or after generation."""

    block_id: str
    scene_id: str
    sort_order: int
    block_type: str
    kind: str  # dialogue | narration | action
    speaker: str
    character_id: str | None
    voice_id: str | None
    voice_name: str | None
    source_text: str
    parentheticals: list[str]
    text: str
    tags: list[str]
    dropped_directions: list[str]
    # Filled from voice_lines once the clip exists.
    voice_line_id: str | None = None
    audio_url: str | None = None
    duration_seconds: float | None = None
    generated_text: str | None = None
    generated_voice_id: str | None = None
    error: str | None = None

    @property
    def is_stale(self) -> bool:
        """The clip no longer matches the script or the chosen voice."""
        if not self.audio_url:
            return False
        return self.generated_text != self.text or self.generated_voice_id != self.voice_id

    def payload(self) -> dict[str, Any]:
        return {**asdict(self), "is_stale": self.is_stale}


# ---------------------------------------------------------------- voice choices


def _clean_text(value: object) -> str | None:
    text = " ".join(str(value or "").split())
    return text or None


def character_voice(character: Mapping[str, Any] | None) -> VoiceChoice | None:
    metadata = character.get("metadata") if character else None
    tts = metadata.get(TTS_METADATA_KEY) if isinstance(metadata, Mapping) else None
    if not isinstance(tts, Mapping):
        return None
    voice_id = _clean_text(tts.get("voice_id"))
    return VoiceChoice(voice_id, _clean_text(tts.get("voice_name"))) if voice_id else None


# How a voice made in the studio came about, stored next to it: "clone" holds the consent
# confirmation of an Instant Voice Clone, "design" the description of a Voice Design voice.
VOICE_ORIGIN_KEYS = ("clone", "design")


def _voice_record(character: Mapping[str, Any], key: str) -> Mapping[str, Any] | None:
    metadata = character.get("metadata")
    tts = metadata.get(TTS_METADATA_KEY) if isinstance(metadata, Mapping) else None
    record = tts.get(key) if isinstance(tts, Mapping) else None
    return record if isinstance(record, Mapping) else None


def _clone_record(character: Mapping[str, Any]) -> Mapping[str, Any] | None:
    return _voice_record(character, "clone")


def normalize_language_code(value: object) -> str | None:
    code = str(value or "").strip().lower()
    if not code:
        return None
    if not LANGUAGE_CODE_PATTERN.match(code):
        raise ValueError("Language must be an ISO 639 code such as 'sw' (Swahili) or 'en' (English)")
    return code


def project_audio_settings(project: Mapping[str, Any]) -> ProjectAudioSettings:
    settings = project.get("settings")
    audio = settings.get(AUDIO_SETTINGS_KEY) if isinstance(settings, Mapping) else None
    if not isinstance(audio, Mapping):
        return ProjectAudioSettings()
    narrator_id = _clean_text(audio.get("narrator_voice_id"))
    try:
        language_code = normalize_language_code(audio.get("language_code"))
    except ValueError:
        language_code = None
    return ProjectAudioSettings(
        narrator=VoiceChoice(narrator_id, _clean_text(audio.get("narrator_voice_name"))) if narrator_id else None,
        language_code=language_code,
        narrate_action=audio.get("narrate_action") is True,
    )


# ---------------------------------------------------------------- planning (pure)


def _speaker_key(label: object) -> str:
    """'JOEL (V.O.)' and 'Joel' are the same speaker."""
    return " ".join(_SPEAKER_EXTENSION_PATTERN.sub(" ", str(label or "")).split()).casefold()


def _display_name(label: object) -> str:
    return " ".join(_SPEAKER_EXTENSION_PATTERN.sub(" ", str(label or "")).split())


@dataclass(frozen=True)
class CharacterIndex:
    by_id: dict[str, dict[str, Any]]
    by_name: dict[str, dict[str, Any]]

    @classmethod
    def build(cls, characters: Iterable[Mapping[str, Any]]) -> "CharacterIndex":
        by_id: dict[str, dict[str, Any]] = {}
        by_name: dict[str, dict[str, Any]] = {}
        for character in characters:
            row = dict(character)
            if row.get("id"):
                by_id[str(row["id"])] = row
            tags = row.get("tags")
            for label in [row.get("name"), *(tags if isinstance(tags, list) else [])]:
                key = _speaker_key(label)
                if key and key not in by_name:
                    by_name[key] = row
        return cls(by_id, by_name)

    def find(self, block: Mapping[str, Any]) -> dict[str, Any] | None:
        return self.by_id.get(str(block.get("character_id") or "")) or self.by_name.get(_speaker_key(block.get("character_name")))


def has_spoken_words(text: str) -> bool:
    return any(char.isalnum() for char in _TAG_PATTERN.sub(" ", text))


def _soften_screenplay_caps(text: str) -> str:
    """Action lines capitalise names and sounds (JOEL, BANG); ElevenLabs reads caps as shouting."""
    return _SHOUTED_WORD_PATTERN.sub(lambda match: match.group(0).capitalize(), text)


def spoken_block_types(type_config: ProjectTypeConfig) -> frozenset[str]:
    return type_config.spoken_block_keys - {PARENTHETICAL_BLOCK}


def plan_scene_lines(
    blocks: Sequence[Mapping[str, Any]],
    type_config: ProjectTypeConfig,
    characters: CharacterIndex,
    audio: ProjectAudioSettings,
) -> list[PlannedLine]:
    """The clips one scene needs, in script order, with tags already applied."""
    spoken = spoken_block_types(type_config)
    lines: list[PlannedLine] = []
    pending_parentheticals: list[str] = []
    for block in sorted(blocks, key=lambda row: int(row.get("sort_order") or 0)):
        block_type = str(block.get("block_type") or "").strip()
        if block_type == PARENTHETICAL_BLOCK:
            direction = _clean_text(block.get("content")) or _clean_text(block.get("parenthetical"))
            if direction:
                pending_parentheticals.append(direction)
            continue
        is_action = audio.narrate_action and block_type == ACTION_BLOCK
        if block_type not in spoken and not is_action:
            pending_parentheticals = []  # a parenthetical only directs the line right after it
            continue

        content = str(block.get("content") or "").strip()
        own = _clean_text(block.get("parenthetical"))
        parentheticals = [*pending_parentheticals, *([own] if own else [])]
        pending_parentheticals = []
        if is_action:
            content = _soften_screenplay_caps(content)
        metadata = block.get("metadata") if isinstance(block.get("metadata"), Mapping) else None
        tagged = to_elevenlabs_text(content, parentheticals, None if is_action else metadata)
        if not has_spoken_words(tagged.text):
            continue

        character = None if is_action else characters.find(block)
        raw_name = _display_name(block.get("character_name"))
        if is_action:
            kind, speaker, voice = "action", NARRATOR_LABEL, audio.narrator
        elif block_type in DIALOGUE_BLOCK_TYPES:
            kind = "dialogue"
            speaker = str(character.get("name")) if character else raw_name or "Unknown speaker"
            voice = character_voice(character)
        else:
            kind = "narration"
            speaker = str(character.get("name")) if character else raw_name or NARRATOR_LABEL
            # An unattributed narration line belongs to the project's narrator.
            voice = character_voice(character) if character else audio.narrator

        lines.append(PlannedLine(
            block_id=str(block.get("id")),
            scene_id=str(block.get("scene_id") or ""),
            sort_order=int(block.get("sort_order") or 0),
            block_type=block_type,
            kind=kind,
            speaker=speaker,
            character_id=str(character["id"]) if character and character.get("id") else None,
            voice_id=voice.voice_id if voice else None,
            voice_name=voice.voice_name if voice else None,
            source_text=content,
            parentheticals=parentheticals,
            text=tagged.text,
            tags=list(tagged.tags),
            dropped_directions=list(tagged.dropped),
        ))
    return lines


def missing_voices(lines: Iterable[PlannedLine]) -> list[str]:
    """Speakers who still need a voice, in order of first line."""
    names: list[str] = []
    for line in lines:
        if not line.voice_id and line.speaker not in names:
            names.append(line.speaker)
    return names


def missing_voice_message(names: Sequence[str]) -> str:
    narrator_hint = " (set the narrator voice for unattributed narration)" if NARRATOR_LABEL in names else ""
    return f"Choose an ElevenLabs voice for: {', '.join(names)}{narrator_hint}"


# ---------------------------------------------------------------- audio files


def audio_file_type(output_format: str) -> tuple[str, str]:
    """(mime type, file extension) for an ElevenLabs output format such as mp3_44100_128."""
    codec = output_format.split("_", 1)[0].lower()
    return {
        "mp3": ("audio/mpeg", "mp3"),
        "wav": ("audio/wav", "wav"),
        "opus": ("audio/opus", "opus"),
        "pcm": ("audio/L16", "pcm"),
        "ulaw": ("audio/basic", "ulaw"),
        "alaw": ("audio/basic", "alaw"),
    }.get(codec, ("application/octet-stream", "bin"))


def estimate_duration_seconds(audio: bytes, output_format: str) -> float | None:
    """mp3 formats are constant bitrate (mp3_44100_128 = 128 kbps), so size gives length."""
    parts = output_format.lower().split("_")
    if parts[0] != "mp3" or len(parts) < 3 or not parts[2].isdigit():
        return None
    return round(len(audio) * 8 / (int(parts[2]) * 1000), 3)


# ---------------------------------------------------------------- database


def _load_scene(supabase: Any, project_id: str, scene_id: str) -> dict[str, Any]:
    rows = as_records(supabase.table("scenes").select(
        "id, project_id, slugline_raw, title, sort_order"
    ).eq("project_id", project_id).eq("id", scene_id).execute().data)
    if not rows:
        raise ValueError("Scene was not found in this project")
    return rows[0]


def _load_existing_lines(supabase: Any, project_id: str, scene_ids: Sequence[str]) -> list[dict[str, Any]]:
    if not scene_ids:
        return []
    rows = as_records(supabase.table("voice_lines").select(
        "id, scene_id, script_block_id, text, audio_asset_id, status, metadata, created_at"
    ).eq("project_id", project_id).in_("scene_id", list(scene_ids)).execute().data)
    asset_ids = [str(row["audio_asset_id"]) for row in rows if row.get("audio_asset_id")]
    assets = {
        str(asset["id"]): asset
        for asset in as_records(
            supabase.table("assets").select("id, url, duration_seconds, storage_path").in_("id", asset_ids).execute().data
        )
    } if asset_ids else {}
    for row in rows:
        row["asset"] = assets.get(str(row.get("audio_asset_id") or ""))
    return rows


def _attach_existing(lines: list[PlannedLine], existing: Iterable[Mapping[str, Any]]) -> None:
    """Show the newest generated clip of each block next to its planned line."""
    latest: dict[str, Mapping[str, Any]] = {}
    for row in sorted(existing, key=lambda item: str(item.get("created_at") or "")):
        if row.get("script_block_id") and row.get("status") == "complete" and row.get("asset"):
            latest[str(row["script_block_id"])] = row
    for line in lines:
        row = latest.get(line.block_id)
        asset = row.get("asset") if row else None
        if not row or not isinstance(asset, Mapping):
            continue
        raw_metadata = row.get("metadata")
        metadata: Mapping[str, Any] = raw_metadata if isinstance(raw_metadata, Mapping) else {}
        line.voice_line_id = str(row["id"])
        line.audio_url = asset.get("url")
        line.duration_seconds = float(asset["duration_seconds"]) if asset.get("duration_seconds") is not None else None
        line.generated_text = str(row.get("text") or "")
        line.generated_voice_id = _clean_text(metadata.get("voice_id"))


def _remove_lines(supabase: Any, bucket: str, rows: Sequence[Mapping[str, Any]]) -> None:
    """Delete replaced voice lines with their audio assets and files (best effort for files)."""
    if not rows:
        return
    supabase.table("voice_lines").delete().in_("id", [str(row["id"]) for row in rows]).execute()
    assets = [row["asset"] for row in rows if row.get("asset")]
    if not assets:
        return
    supabase.table("assets").delete().in_("id", [str(asset["id"]) for asset in assets]).execute()
    paths = [str(asset["storage_path"]) for asset in assets if asset.get("storage_path")]
    if paths:
        try:
            supabase.storage.from_(bucket).remove(paths)
        except Exception as error:  # noqa: BLE001 - an orphaned file must not fail generation
            logger.warning("Could not delete replaced audio files %s: %s", paths, error)


def _save_line(
    supabase: Any, *, project_id: str, line: PlannedLine, audio: bytes,
    model_id: str, output_format: str, bucket: str, language_code: str | None,
) -> None:
    mime_type, extension = audio_file_type(output_format)
    path = f"{project_id}/{line.scene_id}/{line.block_id}-{uuid.uuid4().hex[:12]}.{extension}"
    supabase.storage.from_(bucket).upload(file=audio, path=path, file_options={"content-type": mime_type})
    url = supabase.storage.from_(bucket).get_public_url(path)
    duration = estimate_duration_seconds(audio, output_format)
    tts = {"provider": PROVIDER, "model": model_id, "voice_id": line.voice_id, "voice_name": line.voice_name}

    asset_rows = as_records(supabase.table("assets").insert({
        "project_id": project_id,
        "type": "audio",
        "source": "generation",
        "name": f"{line.speaker} - {line.kind} {line.sort_order}",
        "url": url,
        "storage_path": path,
        "mime_type": mime_type,
        "size_bytes": len(audio),
        "duration_seconds": duration,
        "metadata": {**tts, "scene_id": line.scene_id, "script_block_id": line.block_id, "kind": line.kind},
    }).execute().data)
    if not asset_rows:
        raise RuntimeError("Saving the audio asset returned no row")
    asset_id = str(asset_rows[0]["id"])

    voice_rows = as_records(supabase.table("voice_lines").insert({
        "project_id": project_id,
        "scene_id": line.scene_id,
        "character_id": line.character_id,
        "script_block_id": line.block_id,
        "text": line.text,
        "voice_model": model_id,
        "audio_asset_id": asset_id,
        "status": "complete",
        "sort_order": line.sort_order,
        "metadata": {
            **tts,
            "kind": line.kind,
            "block_type": line.block_type,
            "speaker": line.speaker,
            "source_text": line.source_text,
            "parentheticals": line.parentheticals,
            "tags": line.tags,
            "dropped_directions": line.dropped_directions,
            "language_code": language_code,
        },
    }).execute().data)
    line.voice_line_id = str(voice_rows[0]["id"]) if voice_rows else None
    line.audio_url = url
    line.duration_seconds = duration
    line.generated_text = line.text
    line.generated_voice_id = line.voice_id


# ---------------------------------------------------------------- entry points


@dataclass
class SceneAudio:
    scene_id: str
    model: str
    language_code: str | None
    narrate_action: bool
    lines: list[PlannedLine] = field(default_factory=list)
    missing_voices: list[str] = field(default_factory=list)
    failed: int = 0

    def payload(self) -> dict[str, Any]:
        return {
            "scene_id": self.scene_id, "model": self.model, "language_code": self.language_code,
            "narrate_action": self.narrate_action, "lines": [line.payload() for line in self.lines],
            "missing_voices": self.missing_voices, "failed": self.failed,
        }


def _scene_plan(project_id: str, scene_id: str) -> tuple[Any, ProjectAudioSettings, list[PlannedLine], list[dict[str, Any]]]:
    supabase = require_supabase_client()
    context = load_project_script_context(project_id)
    _load_scene(supabase, project_id, scene_id)
    audio = project_audio_settings(context.project)
    blocks = as_records(supabase.table("script_blocks").select(BLOCK_COLUMNS).eq(
        "project_id", project_id).eq("scene_id", scene_id).order("sort_order").execute().data)
    characters = as_records(supabase.table("characters").select(CHARACTER_COLUMNS).eq("project_id", project_id).execute().data)
    lines = plan_scene_lines(blocks, context.type_config, CharacterIndex.build(characters), audio)
    existing = _load_existing_lines(supabase, project_id, [scene_id])
    _attach_existing(lines, existing)
    return supabase, audio, lines, existing


def load_scene_audio(project_id: str, scene_id: str) -> dict[str, Any]:
    """The scene's planned lines (tags applied) with any clips already generated."""
    _, audio, lines, _ = _scene_plan(project_id, scene_id)
    return SceneAudio(
        scene_id=scene_id, model=get_settings().elevenlabs_model, language_code=audio.language_code,
        narrate_action=audio.narrate_action, lines=lines, missing_voices=missing_voices(lines),
    ).payload()


def generate_scene_audio(project_id: str, scene_id: str, block_ids: Sequence[str] | None = None) -> dict[str, Any]:
    """Speak the scene's lines (or only ``block_ids``) and replace their earlier clips."""
    settings = get_settings()
    if not settings.elevenlabs_api_key:
        raise ValueError("ElevenLabs is not configured: set ELEVENLABS_API_KEY in backend/.env")
    supabase, audio, lines, existing = _scene_plan(project_id, scene_id)
    wanted = set(block_ids) if block_ids else None
    targets = [line for line in lines if wanted is None or line.block_id in wanted]
    if not targets:
        raise ValueError("This scene has no spoken lines to generate" if wanted is None else "None of the chosen lines are spoken lines")
    missing = missing_voices(targets)
    if missing:
        raise ValueError(missing_voice_message(missing))

    def speak(line: PlannedLine, client: httpx.Client) -> bytes:
        return synthesize_speech(
            api_key=settings.elevenlabs_api_key or "", voice_id=line.voice_id or "", text=line.text,
            model_id=settings.elevenlabs_model, output_format=settings.elevenlabs_output_format,
            language_code=audio.language_code, client=client,
        )

    results: dict[str, bytes | Exception] = {}
    with httpx.Client() as client, ThreadPoolExecutor(max_workers=settings.elevenlabs_max_concurrency) as pool:
        futures = {line.block_id: pool.submit(speak, line, client) for line in targets}
        for block_id, future in futures.items():
            try:
                results[block_id] = future.result()
            except Exception as error:  # noqa: BLE001 - reported per line
                results[block_id] = error

    rows_by_block: dict[str, list[dict[str, Any]]] = {}
    for row in existing:
        rows_by_block.setdefault(str(row.get("script_block_id") or ""), []).append(row)

    errors: list[Exception] = []
    for line in targets:
        result = results[line.block_id]
        if not isinstance(result, Exception):
            try:
                _save_line(
                    supabase, project_id=project_id, line=line, audio=result, model_id=settings.elevenlabs_model,
                    output_format=settings.elevenlabs_output_format, bucket=settings.audio_storage_bucket,
                    language_code=audio.language_code,
                )
            except Exception as error:  # noqa: BLE001 - keep the other lines
                result = RuntimeError(
                    f"Audio was generated but could not be saved to the '{settings.audio_storage_bucket}' bucket: {error}"
                )
        if isinstance(result, Exception):
            errors.append(result)
            line.error = str(result)
            logger.warning("Voice line %s failed: %s", line.block_id, result)
            continue
        # The old clip goes only once the new one is saved.
        _remove_lines(supabase, settings.audio_storage_bucket, rows_by_block.pop(line.block_id, []))

    if wanted is None:
        # Whole-scene run: clips for lines that left the script go too.
        planned = {line.block_id for line in lines}
        stale = [row for block_id, rows in rows_by_block.items() if block_id not in planned for row in rows]
        _remove_lines(supabase, settings.audio_storage_bucket, stale)

    if len(errors) == len(targets):
        raise errors[0]  # nothing worked: surface the reason (bad key, quota, missing bucket...)
    return SceneAudio(
        scene_id=scene_id, model=settings.elevenlabs_model, language_code=audio.language_code,
        narrate_action=audio.narrate_action, lines=lines, missing_voices=[], failed=len(errors),
    ).payload()


# ---------------------------------------------------------------- cast and settings


def load_audio_overview(project_id: str) -> dict[str, Any]:
    """Settings, the cast with their voices and line counts, and the scenes to voice."""
    supabase = require_supabase_client()
    context = load_project_script_context(project_id)
    audio = project_audio_settings(context.project)
    characters = as_records(supabase.table("characters").select(CHARACTER_COLUMNS).eq("project_id", project_id).execute().data)
    index = CharacterIndex.build(characters)
    scenes = as_records(supabase.table("scenes").select(
        "id, slugline_raw, title, sort_order, is_leaf"
    ).eq("project_id", project_id).order("sort_order").execute().data)
    scenes = [scene for scene in scenes if scene.get("is_leaf") is not False]
    blocks = as_records(supabase.table("script_blocks").select(BLOCK_COLUMNS).eq(
        "project_id", project_id).order("sort_order").execute().data)
    blocks_by_scene: dict[str, list[dict[str, Any]]] = {}
    for block in blocks:
        blocks_by_scene.setdefault(str(block.get("scene_id") or ""), []).append(block)
    generated: dict[str, set[str]] = {}
    for row in _load_existing_lines(supabase, project_id, [str(scene["id"]) for scene in scenes]):
        if row.get("status") == "complete" and row.get("script_block_id"):
            generated.setdefault(str(row["scene_id"]), set()).add(str(row["script_block_id"]))

    line_counts: dict[str, int] = {}
    unmatched: list[str] = []
    narrator_lines = 0
    scene_rows: list[dict[str, Any]] = []
    for scene in scenes:
        scene_id = str(scene["id"])
        lines = plan_scene_lines(blocks_by_scene.get(scene_id, []), context.type_config, index, audio)
        for line in lines:
            if line.character_id:
                line_counts[line.character_id] = line_counts.get(line.character_id, 0) + 1
            elif line.kind == "dialogue":
                if line.speaker not in unmatched:
                    unmatched.append(line.speaker)
            else:
                narrator_lines += 1
        done = generated.get(scene_id, set())
        scene_rows.append({
            "id": scene_id,
            "title": str(scene.get("slugline_raw") or scene.get("title") or "Untitled"),
            "sort_order": int(scene.get("sort_order") or 0),
            "line_count": len(lines),
            "generated_count": sum(1 for line in lines if line.block_id in done),
        })

    cast: list[dict[str, Any]] = []
    for character in characters:
        voice = character_voice(character)
        clone = _clone_record(character)
        cast.append({
            "voice_is_clone": clone is not None,
            "voice_is_designed": _voice_record(character, "design") is not None,
            "voice_requires_verification": bool(clone and clone.get("requires_verification")),
            "character_id": str(character["id"]),
            "name": str(character.get("name") or ""),
            "character_type": str(character.get("character_type") or ""),
            "voice_id": voice.voice_id if voice else None,
            "voice_name": voice.voice_name if voice else None,
            "voice_profile": character.get("voice") if isinstance(character.get("voice"), dict) else {},
            "line_count": line_counts.get(str(character["id"]), 0),
        })
    cast.sort(key=lambda member: (-int(member["line_count"] or 0), str(member["name"]).casefold()))
    settings = get_settings()
    return {
        "configured": bool(settings.elevenlabs_api_key),
        "model": settings.elevenlabs_model,
        "language_code": audio.language_code,
        "narrate_action": audio.narrate_action,
        "narrator_voice_id": audio.narrator.voice_id if audio.narrator else None,
        "narrator_voice_name": audio.narrator.voice_name if audio.narrator else None,
        "narrator_line_count": narrator_lines,
        "cast": cast,
        "unmatched_speakers": unmatched,
        "scenes": scene_rows,
    }


def _load_character(supabase: Any, project_id: str, character_id: str) -> dict[str, Any]:
    rows = as_records(supabase.table("characters").select("id, metadata").eq(
        "project_id", project_id).eq("id", character_id).execute().data)
    if not rows:
        raise ValueError("Character was not found in this project")
    return rows[0]


def set_character_voice(
    project_id: str, character_id: str, voice_id: str | None, voice_name: str | None,
    clone: Mapping[str, Any] | None = None,
    design: Mapping[str, Any] | None = None,
) -> None:
    """Set or clear a character's voice.

    ``clone`` / ``design`` record how a studio-made voice came about; picking the same
    voice again keeps its record, picking another voice drops it.
    """
    supabase = require_supabase_client()
    character = _load_character(supabase, project_id, character_id)
    metadata = dict(character.get("metadata") or {})
    if _clean_text(voice_id):
        tts: dict[str, Any] = {"provider": PROVIDER, "voice_id": _clean_text(voice_id), "voice_name": _clean_text(voice_name)}
        current = character_voice(character)
        same_voice = bool(current and current.voice_id == tts["voice_id"])
        for key, given in zip(VOICE_ORIGIN_KEYS, (clone, design)):
            record = given or (_voice_record(character, key) if same_voice else None)
            if record:
                tts[key] = dict(record)
        metadata[TTS_METADATA_KEY] = tts
    else:
        metadata.pop(TTS_METADATA_KEY, None)
    supabase.table("characters").update({"metadata": metadata}).eq("id", character_id).eq("project_id", project_id).execute()


# ---------------------------------------------------------------- voice cloning

MAX_CLONE_SAMPLES = 10
MAX_CLONE_SAMPLE_BYTES = 20 * 1024 * 1024
CLONE_SAMPLE_EXTENSIONS = frozenset({".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".flac", ".webm", ".weba"})
CONSENT_REQUIRED_MESSAGE = (
    "Confirm that the speaker gave permission for their voice to be cloned and used in this project"
)


@dataclass(frozen=True)
class CloneSample:
    filename: str
    content: bytes
    content_type: str


def validate_clone_samples(samples: Sequence[CloneSample]) -> None:
    if not samples:
        raise ValueError("Add at least one recording of the speaker")
    if len(samples) > MAX_CLONE_SAMPLES:
        raise ValueError(f"Use at most {MAX_CLONE_SAMPLES} recordings per voice")
    for sample in samples:
        is_audio = sample.content_type.lower().startswith("audio/") or PurePath(sample.filename).suffix.lower() in CLONE_SAMPLE_EXTENSIONS
        if not is_audio:
            raise ValueError(f"{sample.filename} is not an audio file")
        if not sample.content:
            raise ValueError(f"{sample.filename} is empty")
        if len(sample.content) > MAX_CLONE_SAMPLE_BYTES:
            raise ValueError(f"{sample.filename} is larger than {MAX_CLONE_SAMPLE_BYTES // (1024 * 1024)} MB")


def clone_and_assign(
    project_id: str,
    *,
    name: str,
    samples: Sequence[CloneSample],
    consent_confirmed: bool,
    description: str | None = None,
    remove_background_noise: bool = False,
    character_id: str | None = None,
    as_narrator: bool = False,
) -> dict[str, Any]:
    """Make an ElevenLabs Instant Voice Clone and give it to a character or the narrator.

    Only voices the speaker agreed to can be cloned: the request needs an explicit consent
    confirmation, which is stored with the character's voice. ElevenLabs may also ask the
    speaker to pass its voice captcha (``requires_verification``) before the clone speaks.
    """
    if consent_confirmed is not True:
        raise ValueError(CONSENT_REQUIRED_MESSAGE)
    voice_name = _clean_text(name)
    if not voice_name:
        raise ValueError("Give the cloned voice a name")
    if character_id and as_narrator:
        raise ValueError("Assign the cloned voice to a character or to the narrator, not both")
    validate_clone_samples(samples)
    settings = get_settings()
    if not settings.elevenlabs_api_key:
        raise ValueError("ElevenLabs is not configured: set ELEVENLABS_API_KEY in backend/.env")

    # Check the target first so a failed assignment never spends a voice slot.
    supabase = require_supabase_client()
    if character_id:
        _load_character(supabase, project_id, character_id)
    elif not as_records(supabase.table("projects").select("id").eq("id", project_id).execute().data):
        raise ValueError("Project was not found")

    cloned = clone_voice(
        api_key=settings.elevenlabs_api_key,
        name=voice_name[:100],
        samples=[(sample.filename, sample.content, sample.content_type or "application/octet-stream") for sample in samples],
        description=description,
        remove_background_noise=remove_background_noise,
    )
    record = {
        "consent_confirmed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sample_count": len(samples),
        "requires_verification": cloned.requires_verification,
    }
    assigned_to: str | None = None
    if character_id:
        set_character_voice(project_id, character_id, cloned.voice_id, voice_name, clone=record)
        assigned_to = character_id
    elif as_narrator:
        update_audio_settings(project_id, {"narrator_voice_id": cloned.voice_id, "narrator_voice_name": voice_name, "narrator_clone": record})
        assigned_to = "narrator"
    return {
        "voice_id": cloned.voice_id,
        "name": voice_name,
        "requires_verification": cloned.requires_verification,
        "assigned_to": assigned_to,
    }


def update_audio_settings(project_id: str, changes: Mapping[str, Any]) -> None:
    """Merge ``changes`` (narrator voice, language, narrate_action) into projects.settings.audio."""
    supabase = require_supabase_client()
    rows = as_records(supabase.table("projects").select("id, settings").eq("id", project_id).execute().data)
    if not rows:
        raise ValueError("Project was not found")
    settings = dict(rows[0].get("settings") or {})
    audio = dict(settings.get(AUDIO_SETTINGS_KEY) or {})
    if "language_code" in changes:
        audio["language_code"] = normalize_language_code(changes["language_code"])
    if "narrator_voice_id" in changes:
        previous = audio.get("narrator_voice_id")
        audio["narrator_voice_id"] = _clean_text(changes["narrator_voice_id"])
        audio["narrator_voice_name"] = _clean_text(changes.get("narrator_voice_name")) if audio["narrator_voice_id"] else None
        # A different narrator voice drops the clone/design record of the previous one.
        same_voice = bool(audio["narrator_voice_id"]) and audio["narrator_voice_id"] == previous
        for key in (f"narrator_{origin}" for origin in VOICE_ORIGIN_KEYS):
            record = changes.get(key)
            if record and audio["narrator_voice_id"]:
                audio[key] = dict(record)
            elif not same_voice:
                audio.pop(key, None)
    if "narrate_action" in changes:
        audio["narrate_action"] = bool(changes["narrate_action"])
    settings[AUDIO_SETTINGS_KEY] = audio
    supabase.table("projects").update({"settings": settings}).eq("id", project_id).execute()


# ---------------------------------------------------------------- voice design

NARRATOR_TARGET = "narrator"
DESIGN_DESCRIPTION_MAX_CHARS = 1000
DESIGN_CHARACTER_COLUMNS = "id, name, tags, character_type, role, age, gender, personality, voice, type_details, metadata"
# Names for the language line of a generated description; other codes are used as-is.
LANGUAGE_NAMES = {
    "sw": "Swahili", "en": "English", "fr": "French", "ar": "Arabic", "pt": "Portuguese", "es": "Spanish",
    "hi": "Hindi", "am": "Amharic", "so": "Somali", "zu": "Zulu", "ha": "Hausa",
}


def _strip_tags(text: str) -> str:
    return " ".join(_TAG_PATTERN.sub(" ", text).split())


def design_sample_text(lines: Iterable[str]) -> str:
    """The speaker's own lines as preview text, within ElevenLabs' 100-1000 characters.

    Returns "" when they say too little, so ElevenLabs writes a sample instead.
    """
    sample = ""
    for line in lines:
        text = _strip_tags(line)
        if not text:
            continue
        candidate = f"{sample} {text}".strip()
        if len(candidate) > DESIGN_TEXT_MAX_CHARS:
            if len(sample) < DESIGN_TEXT_MIN_CHARS:
                sample = candidate[:DESIGN_TEXT_MAX_CHARS].rsplit(" ", 1)[0]
            break
        sample = candidate
    return sample if len(sample) >= DESIGN_TEXT_MIN_CHARS else ""


def _article(phrase: str) -> str:
    return "An" if re.match(r"^(?:[aeiou]|8|11\b|11-|18\b|18-)", phrase.lower()) else "A"


def _language_name(language_code: str | None) -> str:
    return LANGUAGE_NAMES.get(language_code or "", language_code or "")


DESIGN_RECORDING_NOTE = "Natural, expressive delivery; clear studio-quality recording."
MAX_DELIVERY_HINTS = 5


def delivery_hints(lines: Iterable[PlannedLine]) -> list[str]:
    """The delivery directions a speaker gets most often in the script ([warm], [excited]...)."""
    counts: dict[str, int] = {}
    for line in lines:
        for tag in line.tags:
            if tag not in ("short pause", "long pause"):
                counts[tag] = counts.get(tag, 0) + 1
    return [tag for tag, _ in sorted(counts.items(), key=lambda item: -item[1])][:MAX_DELIVERY_HINTS]


def _delivery_sentence(hints: Sequence[str]) -> str:
    return f"Typical delivery in the script: {', '.join(hints)}." if hints else ""


def describe_character_voice(character: Mapping[str, Any], language_code: str | None, hints: Sequence[str] = ()) -> str:
    """A Voice Design prompt from what the script says about the character and how they speak."""
    profile = effective_character_profile(dict(character))
    age = profile.get("age")
    gender = _clean_text(profile.get("gender"))
    parts = []
    if isinstance(age, int) and not isinstance(age, bool) and age > 0:
        parts.append(f"{age}-year-old")
    if gender:
        parts.append(gender.lower())
    subject = " ".join(parts)
    opening = f"{_article(subject)} {subject} voice" if subject else "A voice"
    language = _language_name(language_code)
    if language:
        opening += f" speaking {language}"
    sentences = [f"{opening}."]
    raw_voice = profile.get("voice")
    voice: Mapping[str, Any] = raw_voice if isinstance(raw_voice, Mapping) else {}
    for name, label in VOICE_FIELDS:
        value = _clean_text(voice.get(name))
        if value:
            sentences.append(f"{label}: {value.rstrip('.')}.")
    raw_details = profile.get("type_details")
    details: Mapping[str, Any] = raw_details if isinstance(raw_details, Mapping) else {}
    for key in ("narration_style", "persona", "presenting_style", "hosting_style", "teaching_style"):
        value = _clean_text(details.get(key))
        if value:
            sentences.append(f"{key.replace('_', ' ').capitalize()}: {value.rstrip('.')}.")
    for key, label in (("role", "Role"), ("personality", "Personality")):
        value = _clean_text(profile.get(key))
        if value:
            sentences.append(f"{label}: {value[:200].rstrip('.')}.")
    sentences.extend(part for part in (_delivery_sentence(hints), DESIGN_RECORDING_NOTE) if part)
    return " ".join(sentences)[:DESIGN_DESCRIPTION_MAX_CHARS]


def describe_narrator_voice(project_type_label: str, language_code: str | None, hints: Sequence[str] = ()) -> str:
    language = _language_name(language_code)
    speaking = f" speaking {language}" if language else ""
    kind = project_type_label.lower()
    sentences = [
        f"A clear, engaging narrator voice{speaking} for {_article(kind).lower()} {kind}.",
        "Steady pace, perfect diction.",
        _delivery_sentence(hints),
        DESIGN_RECORDING_NOTE,
    ]
    return " ".join(part for part in sentences if part)


def suggest_voice_design(project_id: str, target: str) -> dict[str, Any]:
    """Prefill Voice Design for a character (or ``"narrator"``) from the script."""
    supabase = require_supabase_client()
    context = load_project_script_context(project_id)
    audio = project_audio_settings(context.project)
    characters = as_records(supabase.table("characters").select(DESIGN_CHARACTER_COLUMNS).eq("project_id", project_id).execute().data)
    scenes = as_records(supabase.table("scenes").select("id, sort_order").eq("project_id", project_id).order("sort_order").execute().data)
    blocks = as_records(supabase.table("script_blocks").select(BLOCK_COLUMNS).eq("project_id", project_id).order("sort_order").execute().data)
    by_scene: dict[str, list[dict[str, Any]]] = {}
    for block in blocks:
        by_scene.setdefault(str(block.get("scene_id") or ""), []).append(block)
    index = CharacterIndex.build(characters)
    lines = [
        line
        for scene in scenes
        for line in plan_scene_lines(by_scene.get(str(scene["id"]), []), context.type_config, index, audio)
    ]

    if target == NARRATOR_TARGET:
        spoken = [line for line in lines if line.character_id is None and line.kind != "dialogue"]
        return {
            "target": NARRATOR_TARGET,
            "voice_name": "Narrator",
            "description": describe_narrator_voice(context.type_config.label, audio.language_code, delivery_hints(spoken)),
            "sample_text": design_sample_text(line.text for line in spoken),
        }
    character = index.by_id.get(target)
    if not character:
        raise ValueError("Character was not found in this project")
    own = [line for line in lines if line.character_id == target]
    return {
        "target": target,
        "voice_name": str(character.get("name") or "Character"),
        "description": describe_character_voice(character, audio.language_code, delivery_hints(own)),
        "sample_text": design_sample_text(line.text for line in own),
    }


def _clean_description(description: str) -> str:
    text = _clean_text(description)
    if not text:
        raise ValueError("Describe the voice to design, e.g. 'A warm, elderly Swahili storyteller with a slow, gentle pace'")
    if len(text) > DESIGN_DESCRIPTION_MAX_CHARS:
        raise ValueError(f"Keep the voice description under {DESIGN_DESCRIPTION_MAX_CHARS} characters")
    return text


# Conservative per-request limit; longer text should be split into several clips.
SPEECH_TEXT_MAX_CHARS = 3000


def speak_text(voice_id: str, text: str, language_code: str | None = None) -> dict[str, Any]:
    """Text to speech outside any project: the audio comes back to the caller and is not stored."""
    settings = get_settings()
    if not settings.elevenlabs_api_key:
        raise ValueError("ElevenLabs is not configured: set ELEVENLABS_API_KEY in backend/.env")
    voice = _clean_text(voice_id)
    if not voice:
        raise ValueError("Choose a voice")
    spoken = str(text or "").strip()
    if not spoken:
        raise ValueError("Enter the text to speak")
    if len(spoken) > SPEECH_TEXT_MAX_CHARS:
        raise ValueError(f"Keep the text under {SPEECH_TEXT_MAX_CHARS} characters, or split it into several clips")
    output_format = settings.elevenlabs_output_format
    audio = synthesize_speech(
        api_key=settings.elevenlabs_api_key,
        voice_id=voice,
        text=spoken,
        model_id=settings.elevenlabs_model,
        output_format=output_format,
        language_code=_clean_text(language_code),
    )
    media_type, extension = audio_file_type(output_format)
    return {
        "audio_base64": base64.b64encode(audio).decode("ascii"),
        "media_type": media_type,
        "file_extension": extension,
        "duration_seconds": estimate_duration_seconds(audio, output_format),
        "model": settings.elevenlabs_model,
        "characters": len(spoken),
    }


def design_voice_previews(description: str, sample_text: str | None = None) -> list[dict[str, Any]]:
    """Voice Design candidates for ``description``; nothing is saved until one is picked."""
    settings = get_settings()
    if not settings.elevenlabs_api_key:
        raise ValueError("ElevenLabs is not configured: set ELEVENLABS_API_KEY in backend/.env")
    sample = _clean_text(sample_text)
    if sample and not DESIGN_TEXT_MIN_CHARS <= len(sample) <= DESIGN_TEXT_MAX_CHARS:
        raise ValueError(
            f"Preview text must be {DESIGN_TEXT_MIN_CHARS}-{DESIGN_TEXT_MAX_CHARS} characters, "
            "or empty to let ElevenLabs write one"
        )
    previews = design_voice(
        api_key=settings.elevenlabs_api_key,
        voice_description=_clean_description(description),
        model_id=settings.elevenlabs_design_model,
        text=sample,
    )
    return [asdict(preview) for preview in previews]


def save_design_and_assign(
    project_id: str,
    *,
    generated_voice_id: str,
    voice_name: str,
    description: str,
    character_id: str | None = None,
    as_narrator: bool = False,
) -> dict[str, Any]:
    """Keep the chosen Voice Design preview and give it to a character or the narrator."""
    name = _clean_text(voice_name)
    if not name:
        raise ValueError("Give the designed voice a name")
    if not _clean_text(generated_voice_id):
        raise ValueError("Pick one of the previews to keep")
    if character_id and as_narrator:
        raise ValueError("Assign the designed voice to a character or to the narrator, not both")
    text = _clean_description(description)
    settings = get_settings()
    if not settings.elevenlabs_api_key:
        raise ValueError("ElevenLabs is not configured: set ELEVENLABS_API_KEY in backend/.env")

    supabase = require_supabase_client()
    if character_id:
        _load_character(supabase, project_id, character_id)
    elif not as_records(supabase.table("projects").select("id").eq("id", project_id).execute().data):
        raise ValueError("Project was not found")

    voice_id = save_designed_voice(
        api_key=settings.elevenlabs_api_key,
        voice_name=name[:100],
        voice_description=text,
        generated_voice_id=generated_voice_id.strip(),
    )
    record = {
        "description": text,
        "model": settings.elevenlabs_design_model,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    assigned_to: str | None = None
    if character_id:
        set_character_voice(project_id, character_id, voice_id, name, design=record)
        assigned_to = character_id
    elif as_narrator:
        update_audio_settings(project_id, {"narrator_voice_id": voice_id, "narrator_voice_name": name, "narrator_design": record})
        assigned_to = NARRATOR_TARGET
    return {"voice_id": voice_id, "name": name, "assigned_to": assigned_to}
