import concurrent.futures
import io
import logging
import math
import os
import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx
from PIL import Image

from core.supabase_client import require_supabase_client
from core.provider_errors import describe_error
from schemas.image_generation import (
    CreateImageRequest,
    GenerateStoryboardResponse,
    StoryboardFrame,
)
from services.duration_budget import MAX_CLIP_SECONDS, allocate_shot_durations, shot_weight
from services.image_generation_service import generate_provider_images
from services.project_runtime import load_project_runtime
from services.project_visual_style import ProjectVisualStyle, apply_visual_style, load_project_visual_style
from services.script_config import ProjectTypeConfig, character_type_map, load_project_script_context
from services.character_ranking import rank_characters_from_script
from services.character_views import (
    addresses_camera,
    effective_character_profile,
    is_on_camera,
    physical_summary,
    role_summary,
)
from services.environment_ranking import rank_environments_from_script
from services.object_ranking import rank_objects_from_script
from services.storyboard_models import DEFAULT_STORYBOARD_MODEL, TEXT_ONLY_FALLBACK_MODEL, storyboard_model
from services.storyboard_references import (
    FACE_CLOSEUP_VIEW,
    MODEL_SHEET_VIEW,
    build_frame_references,
    describe_references,
)
from services.storyboard_shot_planner import ShotPlanningError, plan_scene_shots


logger = logging.getLogger(__name__)

STORYBOARD_MODEL = DEFAULT_STORYBOARD_MODEL
STORYBOARD_PROVIDER = "wavespeed"

# Screenplay lines are first broken into a shot list, then every shot renders one frame.
# A language model plans the shots (STORYBOARD_SHOT_PLANNER, on by default); when it is
# off or fails, each line falls back to exactly one shot. These knobs bound cost and
# reference payloads.
DEFAULT_MAX_ACTION_FRAMES = 24
DEFAULT_MAX_SHOTS = 36
SHOT_PLANNER_LLM = "llm"
SHOT_PLANNER_DETERMINISTIC = "deterministic"
DEFAULT_MAX_REFERENCE_IMAGES = 10

ACTION_BLOCK_TYPE = "action"
DIALOGUE_BLOCK_TYPE = "dialogue"
BEAT_BOUNDARY_BLOCK_TYPES = frozenset({"scene_heading", "transition"})
SPEAKER_FRAME_CAMERA_ANGLE = "medium close-up"
STATIC_CAMERA_MOTION = "static"


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw.strip())
    except ValueError:
        return default


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _parse_timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
 

def _scene_context(
    scene: dict[str, Any],
    blocks: list[dict[str, Any]],
    characters: list[dict[str, Any]] | None = None,
    environment: dict[str, Any] | None = None,
    objects: list[dict[str, Any]] | None = None,
    visual_style: ProjectVisualStyle | None = None,
) -> str:
    lines = []
    for b in blocks:
        if not b.get("content"):
            continue
        b_type = str(b.get("block_type", "action")).upper()
        c_name = f" ({b['character_name']})" if b.get("character_name") else ""
        lines.append(f"{b_type}{c_name}: {b['content']}")
    block_text = "\n".join(lines)
    
    char_lines = []
    for c in characters or []:
        c_name = c.get("name", "Unknown Character")
        views = c.get("views", {})
        view_summary = ", ".join(f"{v}: {url}" for v, url in views.items() if url)
        tags = _clean_labels(c.get("tags") or [])
        tag_line = f"\n  Tags: {', '.join(tags)}" if tags else ""
        on_screen_role = f"  On-screen role: {c['role_summary']}\n" if c.get("role_summary") else ""
        char_lines.append(
            f"- {c_name} (Role: {c.get('role') or 'N/A'}, Age: {c.get('age') or 'N/A'}, Gender: {c.get('gender') or 'N/A'}, Race: {c.get('race') or 'N/A'})\n"
            f"{on_screen_role}"
            f"  Physical: {physical_summary(c) or 'N/A'}\n"
            f"  Appearance: {c.get('appearance') or 'N/A'}{tag_line}\n"
            f"  Visual Keyframe Views: {view_summary or 'None'}"
        )
    char_text = "\n".join(char_lines) if char_lines else "No specific character keyframes linked."

    env_text = "No specific environment reference linked."
    if environment:
        env_text = (
            f"Name: {environment.get('name', 'N/A')}\n"
            f"Prompt/Details: {environment.get('prompt', 'N/A')}\n"
            f"Reference Image URL: {environment.get('image_url', 'None')}"
        )

    obj_lines = [
        f"- {o.get('name', 'Object')}: {o.get('prompt', 'N/A')} (Reference Image: {o.get('image_url', 'None')})"
        for o in objects or []
    ]
    obj_text = "\n".join(obj_lines) if obj_lines else "No specific object references linked."

    style_text = visual_style.prompt_block() if visual_style else "No project visual contract is available."
    return f"""Slugline: {scene.get('slugline_raw') or 'Untitled scene'}
Location: {scene.get('location') or 'Unknown'}
Time: {scene.get('time_of_day') or 'Unknown'}
Scene Summary: {scene.get('summary') or 'No summary provided.'}

=== PROJECT VISUAL CONTRACT ===
{style_text}

=== LINKED VISUAL ENTITIES ===
CHARACTERS:
{char_text}

ENVIRONMENT LOOK:
{env_text}

OBJECTS / PROPS:
{obj_text}

=== SCREENPLAY ACTION & DIALOGUE BEATS ===
{block_text or 'No screenplay blocks are available.'}"""


def _block_type(block: dict[str, Any]) -> str:
    return str(block.get("block_type") or ACTION_BLOCK_TYPE).strip().lower()


def _block_text(block: dict[str, Any]) -> str:
    return str(block.get("content") or "").strip()


@dataclass(frozen=True)
class StoryboardVocabulary:
    """Which block types become storyboard beats for a project type.

    visual_types:   blocks that describe what is seen (action, b_roll, product_shot...)
    speaker_types:  spoken blocks that get an on-camera speaker frame when no visual
                    covers them (dialogue, interview)
    fallback_types: spoken blocks used as visual beats only when a unit has no
                    visual blocks at all (narration-only explainer sections)
    """

    visual_types: frozenset[str] = frozenset({ACTION_BLOCK_TYPE})
    speaker_types: frozenset[str] = frozenset({DIALOGUE_BLOCK_TYPE})
    fallback_types: frozenset[str] = frozenset()
    labels: tuple[tuple[str, str], ...] = ()
    production: str = "Film"

    def label(self, block_type: str) -> str:
        return dict(self.labels).get(block_type) or block_type.replace("_", " ").title()


SCREENPLAY_VOCABULARY = StoryboardVocabulary()


def storyboard_vocabulary(type_config: ProjectTypeConfig) -> StoryboardVocabulary:
    spoken = [block for block in type_config.block_types if block.is_spoken]
    return StoryboardVocabulary(
        visual_types=type_config.visual_block_keys,
        speaker_types=frozenset(block.key for block in spoken if block.speaker_role == "required"),
        fallback_types=frozenset(block.key for block in spoken if block.speaker_role != "required"),
        labels=tuple((block.key, block.label) for block in type_config.block_types),
        production=type_config.label,
    )


def _action_blocks(
    blocks: list[dict[str, Any]], vocabulary: StoryboardVocabulary = SCREENPLAY_VOCABULARY
) -> list[dict[str, Any]]:
    return [block for block in blocks if _block_type(block) in vocabulary.visual_types and _block_text(block)]


def _has_adjacent_action(
    blocks: list[dict[str, Any]], index: int, visual_types: frozenset[str] = frozenset({ACTION_BLOCK_TYPE})
) -> bool:
    """True when the spoken block at *index* sits inside a run of visual beats."""
    for step in (-1, 1):
        cursor = index + step
        while 0 <= cursor < len(blocks):
            neighbour_type = _block_type(blocks[cursor])
            if neighbour_type in visual_types:
                if _block_text(blocks[cursor]):
                    return True
            elif neighbour_type in BEAT_BOUNDARY_BLOCK_TYPES:
                break
            cursor += step
    return False


@dataclass(frozen=True)
class SpeakerCast:
    """How speakers appear on screen, by casefolded name or alias.

    off_camera: voice-only speakers (narrators); their lines never get a speaker frame.
    to_camera:  speakers who talk straight to the lens (presenters, hosts, spokespeople).
    """

    off_camera: frozenset[str] = frozenset()
    to_camera: frozenset[str] = frozenset()


def _speaker_key(label: object) -> str:
    return " ".join(str(label or "").split()).casefold()


def speaker_cast(characters: list[dict[str, Any]], character_types: dict[str, Any]) -> SpeakerCast:
    off_camera: set[str] = set()
    to_camera: set[str] = set()
    for character in characters:
        keys = {_speaker_key(label) for label in _character_aliases(character)} - {""}
        if not is_on_camera(character, character_types):
            off_camera |= keys
        elif addresses_camera(character, character_types):
            to_camera |= keys
    return SpeakerCast(off_camera=frozenset(off_camera), to_camera=frozenset(to_camera - off_camera))


def _load_speaker_cast(project_id: str) -> SpeakerCast:
    supabase = require_supabase_client()
    rows = _rows(supabase.table("characters").select(
        "name, tags, character_type, on_camera, metadata"
    ).eq("project_id", project_id).execute())
    return speaker_cast(rows, character_type_map())


def _build_scene_beats(
    blocks: list[dict[str, Any]],
    include_speaker_frames: bool = True,
    vocabulary: StoryboardVocabulary = SCREENPLAY_VOCABULARY,
    cast: SpeakerCast | None = None,
) -> list[dict[str, Any]]:
    """Map script blocks to storyboard beats: one visual block -> exactly one beat.

    Spoken blocks never render their words. Dialogue and interview answers only add a
    speaker-presence beat when no visual block covers that moment, which keeps
    talking-head scenes storyboarded without leaking speech into prompts. Units with
    no visual blocks at all (a narration-only section) fall back to one beat per
    narration line, illustrating what it describes. Voice-only speakers (``cast``) never
    get a speaker beat; presenters and hosts get one that faces the lens.
    """
    cast = cast or SpeakerCast()
    beats: list[dict[str, Any]] = []
    for index, block in enumerate(blocks):
        block_type = _block_type(block)
        if block_type in vocabulary.visual_types:
            text = _block_text(block)
            if not text:
                continue
            beats.append({
                "kind": "action", "block": block, "text": text, "speaker": "",
                "block_type": block_type, "label": vocabulary.label(block_type),
            })
            continue

        if block_type not in vocabulary.speaker_types or not include_speaker_frames:
            continue
        if str(block.get("dialogue_mode") or "normal").strip().lower() != "normal":
            continue
        if _has_adjacent_action(blocks, index, vocabulary.visual_types):
            continue
        speaker = str(block.get("character_name") or "").strip()
        if not speaker or _speaker_key(speaker) in cast.off_camera:
            continue
        if beats and beats[-1]["kind"] == "speaker" and beats[-1]["speaker"].casefold() == speaker.casefold():
            continue
        to_camera = block_type != "interview" and _speaker_key(speaker) in cast.to_camera
        action = "answers on camera" if block_type == "interview" else "speaks directly to camera" if to_camera else "speaks"
        beats.append({
            "kind": "speaker",
            "block": block,
            "text": f"{speaker} {action}",
            "speaker": speaker,
            "to_camera": to_camera,
            "block_type": block_type,
            "label": vocabulary.label(block_type),
        })

    if not any(beat["kind"] == "action" for beat in beats) and vocabulary.fallback_types:
        fallback = [
            {
                "kind": "action", "block": block, "text": _block_text(block), "speaker": "",
                "block_type": _block_type(block),
                "label": f"Visual illustrating this {vocabulary.label(_block_type(block)).lower()} (show it, do not write it)",
            }
            for block in blocks
            if _block_type(block) in vocabulary.fallback_types and _block_text(block)
        ]
        if fallback:
            return fallback
    return beats


def _apply_action_frame_cap(
    beats: list[dict[str, Any]], max_action_frames: int
) -> tuple[list[dict[str, Any]], bool]:
    """Bound the number of action frames without reordering the remaining beats."""
    if max_action_frames <= 0:
        return list(beats), False
    capped: list[dict[str, Any]] = []
    action_count = 0
    for beat in beats:
        if beat["kind"] == "action":
            action_count += 1
            if action_count > max_action_frames:
                return capped, True
        capped.append(beat)
    return capped, False


def _match_name_patterns(name: str) -> list[str]:
    cleaned = re.sub(r"\s+", " ", name or "").strip()
    if not cleaned:
        return []
    patterns = [cleaned]
    first_token = cleaned.split(" ")[0]
    if len(first_token) >= 3 and first_token.casefold() != cleaned.casefold():
        patterns.append(first_token)
    return patterns


def _clean_labels(values: Any) -> list[str]:
    """Normalise a name plus its tag aliases into unique, trimmed labels."""
    if isinstance(values, str):
        values = [values]
    labels: list[str] = []
    for value in values or []:
        text = " ".join(str(value or "").split())
        if text and text.casefold() not in {label.casefold() for label in labels}:
            labels.append(text)
    return labels


def _character_aliases(character: dict[str, Any]) -> list[str]:
    """A character answers to its name and to every tag stored on it.

    Tags double as screenplay aliases ("VOSS", "DETECTIVE"), so an action line that
    only uses a nickname still maps onto the right keyframe set.
    """
    tags = character.get("tags")
    return _clean_labels([character.get("name"), *(tags if isinstance(tags, list) else [])])


def _name_appears(text: str, name: str) -> bool:
    haystack = f" {(text or '').lower()} "
    for pattern in _match_name_patterns(name):
        if re.search(rf"(?<![a-z0-9]){re.escape(pattern.lower())}(?![a-z0-9])", haystack):
            return True
    return False


def _matches_any_label(text: str, labels: Sequence[str]) -> bool:
    return any(_name_appears(text, label) for label in labels)


def _match_characters(text: str, characters: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    return [
        character
        for character in characters or []
        if _matches_any_label(text, _character_aliases(character))
    ]


def _match_character_by_label(label: str, characters: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Resolve a screenplay speaker label (name, tag, or first name) to characters."""
    target = " ".join((label or "").split())
    if not target:
        return []
    folded = target.casefold()
    exact = [
        character
        for character in characters or []
        if any(alias.casefold() == folded for alias in _character_aliases(character))
    ]
    return exact or _match_characters(target, characters)


def _match_objects(text: str, objects: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    return [
        obj
        for obj in objects or []
        if _matches_any_label(text, _clean_labels([obj.get("name"), *(obj.get("tags") or [])]))
    ]


HEX_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")


def _character_color(character: dict[str, Any]) -> str | None:
    """Read an explicit per-character font color so the UI and the model agree.

    Characters without an override fall back to the deterministic palette in the frontend,
    keyed on the character id, so colors stay stable across every workspace.
    """
    metadata = character.get("metadata")
    if not isinstance(metadata, dict):
        return None
    for key in ("font_color", "accent_color", "color"):
        value = metadata.get(key)
        if isinstance(value, str) and HEX_COLOR_PATTERN.match(value.strip()):
            return value.strip().lower()
    return None


def _character_labels(character: dict[str, Any]) -> dict[str, Any]:
    tags = character.get("tags")
    return {
        "id": character.get("id"),
        "name": str(character.get("name") or "Unknown Character"),
        "tags": _clean_labels(tags if isinstance(tags, list) else []),
        "color": _character_color(character),
    }



def _describe_character(character: dict[str, Any], name_override: str | None = None) -> str:
    name = str(name_override or character.get("name") or "Unknown Character").strip()
    descriptors: list[str] = []
    role = str(character.get("role") or "").strip()
    if role:
        descriptors.append(role)
    elif str(character.get("character_type") or "").strip() == "main":
        descriptors.append("lead")
    for key in ("age", "gender", "race"):
        value = character.get(key)
        if value:
            descriptors.append(str(value))
    header = f"{name} ({', '.join(descriptors)})" if descriptors else name
    aliases = [
        alias
        for alias in _character_aliases(character)
        if alias.casefold() != name.casefold()
    ][:4]
    if aliases:
        header = f"{header} [also called: {', '.join(aliases)}]"
    details = "; ".join(
        part for part in (
            str(character.get("role_summary") or "").strip(),
            physical_summary(character),
            str(character.get("appearance") or "").strip(),
        ) if part
    )
    return f"{header}: {details}" if details else header


def _describe_location(scene: dict[str, Any], environment: dict[str, Any] | None) -> str:
    location = str(scene.get("location") or "Unknown location").strip()
    time_of_day = str(scene.get("time_of_day") or "").strip()
    details = f"{location}, {time_of_day}" if time_of_day else location
    environment_description = str((environment or {}).get("description") or "").strip()
    return f"{details}: {environment_description}" if environment_description else details


FRAME_PROMPT_GUARDRAIL = (
    "Render exactly one finished 16:9 frame. No collage, no split screen, no multiple panels, "
    "no text overlays, no subtitles, no captions, no speech bubbles, no on-screen lettering."
)


def _deterministic_shot_plan(beat: dict[str, Any], is_first_action: bool) -> dict[str, Any]:
    """One shot for one beat, with no language model involved."""
    if beat["kind"] == "action":
        return {
            "beats": [beat],
            "description": beat["text"],
            "camera_angle": "wide establishing shot" if is_first_action else "medium shot",
            "shot_size": "wide shot" if is_first_action else "medium shot",
            "beat_line": f"{str(beat.get('label') or 'Action').upper()}: {beat['text']}",
            "speaker": None,
            "character_labels": [],
            "character_facing": {},
            "prop_labels": [],
            "planner": SHOT_PLANNER_DETERMINISTIC,
        }
    speaker = beat["speaker"]
    return {
        "beats": [beat],
        "description": beat["text"],
        "camera_angle": SPEAKER_FRAME_CAMERA_ANGLE,
        "shot_size": SPEAKER_FRAME_CAMERA_ANGLE,
        "beat_line": (
            f"BEAT: {speaker} answers an interview question, seated, looking just off camera "
            "towards an unseen interviewer, mouth open mid-sentence."
            if beat.get("block_type") == "interview"
            else f"BEAT: {speaker} speaks directly to the camera, eye contact with the lens, "
            "mouth open mid-sentence."
            if beat.get("to_camera")
            else f"BEAT: {speaker} is speaking, mouth open, mid-sentence, "
            "facing the camera or their scene partner."
        ),
        "speaker": speaker,
        "character_labels": [speaker],
        "character_facing": {},
        "prop_labels": [],
        "planner": SHOT_PLANNER_DETERMINISTIC,
    }


def _deterministic_shot_plans(beats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    plans: list[dict[str, Any]] = []
    seen_action = False
    for beat in beats:
        plans.append(_deterministic_shot_plan(beat, is_first_action=beat["kind"] == "action" and not seen_action))
        seen_action = seen_action or beat["kind"] == "action"
    return plans


def _planner_script_lines(
    blocks: list[dict[str, Any]], beats: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Render the scene for the planner: beats are numbered, everything else is context."""
    number_by_block = {id(beat["block"]): index + 1 for index, beat in enumerate(beats)}
    lines: list[dict[str, Any]] = []
    for block in blocks:
        text = _block_text(block)
        number = number_by_block.get(id(block))
        if not text and not number:
            continue
        label = _block_type(block).replace("_", " ").upper()
        speaker = str(block.get("character_name") or "").strip()
        if speaker:
            label = f"{label} ({speaker})"
        lines.append({"number": number, "label": label, "text": text})
    return lines


def _trim_shot_plans(plans: list[dict[str, Any]], max_shots: int) -> list[dict[str, Any]]:
    """Drop surplus shots from the end, never leaving a script line without a shot."""
    trimmed = list(plans)
    index = len(trimmed) - 1
    while len(trimmed) > max_shots and index >= 0:
        others = {
            id(beat)
            for position, plan in enumerate(trimmed)
            if position != index
            for beat in plan["beats"]
        }
        if all(id(beat) in others for beat in trimmed[index]["beats"]):
            trimmed.pop(index)
        index -= 1
    return trimmed


def _plan_scene_shots(
    beats: list[dict[str, Any]],
    scene: dict[str, Any],
    blocks: list[dict[str, Any]],
    characters: list[dict[str, Any]] | None,
    objects: list[dict[str, Any]] | None,
    production: str = "Film",
    target_seconds: float | None = None,
    project_type: str = "",
    pacing: str = "",
) -> tuple[list[dict[str, Any]], str, str | None]:
    """Turn script beats into an ordered shot list.

    Returns ``(plans, planner, planner_error)``. Every beat is covered by at least one
    shot whichever planner ran: lines the language model skipped get a deterministic
    shot, and a failed planner call falls back to one shot per line.
    """
    if not _env_flag("STORYBOARD_SHOT_PLANNER", True):
        return _deterministic_shot_plans(beats), SHOT_PLANNER_DETERMINISTIC, None

    # The cap never drops below the line count, so each line always keeps a shot.
    # It also leaves room for enough clips to fill the scene's runtime budget.
    max_shots = max(
        _env_int("STORYBOARD_MAX_SHOTS", DEFAULT_MAX_SHOTS),
        len(beats),
        math.ceil((target_seconds or 0) / MAX_CLIP_SECONDS),
    )
    try:
        raw_plans = plan_scene_shots(
            scene_heading=str(
                scene.get("slugline_raw") or scene.get("title") or scene.get("location") or "Untitled scene"
            ),
            production=production,
            script_lines=_planner_script_lines(blocks, beats),
            character_names=[str(c["name"]) for c in characters or [] if c.get("name")],
            prop_names=[str(o["name"]) for o in objects or [] if o.get("name")],
            max_shots=max_shots,
            target_seconds=target_seconds,
            project_type=project_type,
            pacing=pacing,
        )
    except ShotPlanningError as error:
        logger.warning("Storyboard shot planner failed; using one shot per line: %s", error)
        return _deterministic_shot_plans(beats), SHOT_PLANNER_DETERMINISTIC, str(error)

    plans: list[dict[str, Any]] = []
    covered: set[int] = set()
    for raw in raw_plans:
        covered.update(raw["lines"])
        plans.append({
            "beats": [beats[number - 1] for number in raw["lines"]],
            "first_line": raw["lines"][0],
            "description": raw["description"],
            "camera_angle": f"{raw['shot_size']}, {raw['camera_angle']}",
            "shot_size": raw["shot_size"],
            "beat_line": f"SHOT: {raw['description']}",
            "speaker": None,
            "character_labels": raw["characters"],
            "character_facing": raw.get("character_facing") or {},
            "prop_labels": raw["props"],
            "planner": SHOT_PLANNER_LLM,
        })
    for index, beat in enumerate(beats):
        if index + 1 not in covered:
            plans.append({
                **_deterministic_shot_plan(beat, is_first_action=False),
                "first_line": index + 1,
            })
    plans.sort(key=lambda plan: plan["first_line"])
    return _trim_shot_plans(plans, max_shots), SHOT_PLANNER_LLM, None


def _scene_seconds(scene: dict[str, Any]) -> float | None:
    try:
        seconds = float(scene.get("duration_seconds") or 0)
    except (TypeError, ValueError):
        return None
    return seconds if seconds > 0 else None


def _shot_durations(
    frames: list[dict[str, Any]],
    blocks: list[dict[str, Any]],
    type_config: ProjectTypeConfig,
    scene_seconds: float | None,
    pacing: str = "",
) -> list[int]:
    """Clip length for each shot: the scene's budget split by how much each shot
    has to carry (spoken lines need time to be heard), snapped to clip lengths
    the video model renders."""
    blocks_by_id = {block.get("id"): block for block in blocks if block.get("id")}
    spoken_keys = set(type_config.spoken_block_keys)
    weights: list[float] = []
    for frame in frames:
        spoken: list[str] = []
        visual: list[str] = [str(frame.get("description") or "")]
        for block_id in frame.get("source_block_ids") or []:
            block = blocks_by_id.get(block_id)
            if not block:
                continue
            target = spoken if _block_type(block) in spoken_keys else visual
            target.append(_block_text(block))
        weights.append(shot_weight(" ".join(spoken), " ".join(visual)))
    # A line split over several shots shares its spoken time between them.
    counts: dict[Any, int] = {}
    for frame in frames:
        for block_id in frame.get("source_block_ids") or []:
            counts[block_id] = counts.get(block_id, 0) + 1
    for index, frame in enumerate(frames):
        share = max((counts.get(b, 1) for b in frame.get("source_block_ids") or []), default=1)
        weights[index] = max(1.0, weights[index] / share)
    return allocate_shot_durations(scene_seconds, weights, type_config.key, pacing=pacing)


def _shot_characters(plan: dict[str, Any], characters: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Resolve who is visible: the planner's cast list, then names in the shot text."""
    matched: list[dict[str, Any]] = []

    def add(found: list[dict[str, Any]]) -> None:
        for character in found:
            if not any(character is existing for existing in matched):
                matched.append(character)

    for label in plan["character_labels"]:
        add(_match_character_by_label(label, characters))
    add(_match_characters(plan["description"], characters))
    if not matched:
        add(_match_characters(" ".join(beat["text"] for beat in plan["beats"]), characters))
    return matched


def _shot_character_facing(
    plan: dict[str, Any],
    matched: list[dict[str, Any]],
    characters: list[dict[str, Any]] | None,
) -> dict[int, str | None]:
    """Map each visible character (by identity) to the facing the planner gave them."""
    facing_by_character: dict[int, str | None] = {}
    for label, facing in (plan.get("character_facing") or {}).items():
        for character in _match_character_by_label(label, characters):
            if any(character is visible for visible in matched):
                facing_by_character.setdefault(id(character), facing)
    return facing_by_character


def _build_frames_from_shot_plans(
    plans: list[dict[str, Any]],
    scene: dict[str, Any],
    characters: list[dict[str, Any]] | None = None,
    environment: dict[str, Any] | None = None,
    objects: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Build one frame spec per planned shot. Prompt wording is assembled here, not by a model."""
    max_references = max(0, _env_int("STORYBOARD_MAX_REFERENCE_IMAGES", DEFAULT_MAX_REFERENCE_IMAGES))
    location_text = _describe_location(scene, environment)

    frames: list[dict[str, Any]] = []
    for plan in plans:
        source_blocks = [beat["block"] for beat in plan["beats"]]
        block = source_blocks[0]
        speaker = plan["speaker"]
        camera_angle = plan["camera_angle"]
        description = plan["description"]
        beat_line = plan["beat_line"]
        matched_characters = _shot_characters(plan, characters)
        matched_objects = _match_objects(" ".join([description, *plan["prop_labels"]]), objects)

        references = build_frame_references(
            matched_characters,
            _shot_character_facing(plan, matched_characters, characters),
            plan.get("shot_size") or camera_angle,
            environment,
            matched_objects,
            max_references,
        )
        reference_urls = [reference.url for reference in references]

        prompt_parts = ["16:9 cinematic storyboard frame.", beat_line]
        if matched_characters:
            prompt_parts.append("CHARACTERS:")
            prompt_parts.extend(f"- {_describe_character(c, speaker)}" for c in matched_characters)
        else:
            prompt_parts.append("CHARACTERS: none visible in this frame.")
        prompt_parts.append(f"LOCATION: {location_text}")
        if matched_objects:
            prompt_parts.append("PROPS: " + ", ".join(str(o.get("name")) for o in matched_objects))
        reference_lines = describe_references(references)
        if reference_lines:
            prompt_parts.append(reference_lines)
        prompt_parts.append(f"CAMERA: {camera_angle}, {STATIC_CAMERA_MOTION}.")
        prompt_parts.append(FRAME_PROMPT_GUARDRAIL)

        frames.append({
            "description": description,
            "camera_angle": camera_angle,
            "camera_motion": STATIC_CAMERA_MOTION,
            "prompt": "\n".join(prompt_parts),
            "image_references": reference_urls,
            "source_block_id": block.get("id"),
            "source_block_ids": [b.get("id") for b in source_blocks if b.get("id")],
            "source_block_type": _block_type(block),
            "source_text": " ".join(text for text in (_block_text(b) for b in source_blocks) if text),
            "planner": plan["planner"],
            "character_ids": [character["id"] for character in matched_characters if character.get("id")],
            "characters": [
                _character_labels(character)
                for character in matched_characters
                if character.get("id")
            ],
        })
    return frames


def _storyboard_matches_script(shots: list[dict[str, Any]], beats: list[dict[str, Any]]) -> bool:
    """Reuse only when the stored shots cover exactly the current beats, in script order.

    A beat may be covered by several shots and a shot may cover several beats, so this
    compares coverage rather than counts. Any beat edited after its shot was created
    makes the storyboard stale.
    """
    if not shots or not beats:
        return False
    expected_ids = [beat["block"].get("id") for beat in beats]
    if any(not block_id for block_id in expected_ids):
        return False
    position = {block_id: index for index, block_id in enumerate(expected_ids)}
    updated_at = {beat["block"].get("id"): _parse_timestamp(beat["block"].get("updated_at")) for beat in beats}

    covered: set[Any] = set()
    previous_first = -1
    for shot in shots:
        block_ids = _shot_source_block_ids(shot)
        if not block_ids or any(block_id not in position for block_id in block_ids):
            return False
        first = min(position[block_id] for block_id in block_ids)
        if first < previous_first:
            return False
        previous_first = first
        covered.update(block_ids)
        shot_created = _parse_timestamp(shot.get("created_at"))
        for block_id in block_ids:
            block_updated = updated_at[block_id]
            if block_updated and shot_created and block_updated > shot_created:
                return False
    return covered == set(expected_ids)


def _shot_source_block_ids(shot: dict[str, Any]) -> list[Any]:
    """Script blocks a stored shot was planned from (older shots stored a single id)."""
    metadata = shot.get("metadata") or {}
    block_ids = metadata.get("source_block_ids")
    if isinstance(block_ids, list) and block_ids:
        return [block_id for block_id in block_ids if block_id]
    single = metadata.get("source_block_id")
    return [single] if single else []


def _rows(result: Any) -> list[dict[str, Any]]:
    """Return a query result's rows as dicts, treating a missing/None response as no rows."""
    data = getattr(result, "data", None) if result is not None else None
    if not isinstance(data, list):
        return []
    return [row for row in data if isinstance(row, dict)]


def _maybe_single_data(result: Any) -> dict[str, Any]:
    """Return the row from a ``maybe_single()`` query, or {} when nothing matched.

    supabase-py returns ``None`` (not a response object) when ``maybe_single`` finds
    no row, so reading ``.data`` directly raises ``'NoneType' object has no attribute``.
    """
    data = getattr(result, "data", None) if result is not None else None
    return data if isinstance(data, dict) else {}


def _clear_storyboard_shots(project_id: str, scene_id: str) -> None:
    """Drop previous shots and their storyboard asset links before writing new frames."""
    supabase = require_supabase_client()
    old_shots = supabase.table("shots").select("id").eq("scene_id", scene_id).eq("project_id", project_id).execute()
    old_shot_ids = [shot["id"] for shot in _rows(old_shots)]
    if not old_shot_ids:
        return
    supabase.table("asset_links").delete().eq("project_id", project_id).eq("target_type", "shot").eq(
        "role", "storyboard"
    ).in_("target_id", old_shot_ids).execute()
    supabase.table("shots").delete().eq("scene_id", scene_id).eq("project_id", project_id).execute()


def _frame_character_labels(shot: dict[str, Any]) -> list[dict[str, Any]]:
    metadata = shot.get("metadata") or {}
    labels = metadata.get("characters")
    if not isinstance(labels, list):
        return []
    cleaned: list[dict[str, Any]] = []
    for label in labels:
        if not isinstance(label, dict) or not label.get("name"):
            continue
        cleaned.append({
            "id": label.get("id"),
            "name": str(label["name"]),
            "tags": _clean_labels(label.get("tags") or []),
            "color": label.get("color") if isinstance(label.get("color"), str) else None,
        })
    return cleaned


def _frame_response(shot: dict[str, Any], image_url: str | None = None, error: str | None = None) -> StoryboardFrame:
    return StoryboardFrame(
        shot_id=shot["id"],
        shot_number=shot.get("shot_number") or (shot.get("sort_order") or 0) + 1,
        description=shot.get("description") or "Untitled shot",
        camera_angle=shot.get("camera_angle"),
        camera_motion=shot.get("camera_motion"),
        prompt=shot.get("prompt") or "",
        image_url=image_url,
        status=shot.get("status") or ("failed" if error else "pending"),
        error=error,
        characters=_frame_character_labels(shot),
    )


def _existing_storyboard(
    project_id: str,
    scene_id: str,
    beats: list[dict[str, Any]] | None = None,
) -> GenerateStoryboardResponse | None:
    supabase = require_supabase_client()
    shots_result = supabase.table("shots").select(
        "id, shot_number, description, camera_angle, camera_motion, prompt, status, sort_order, metadata, created_at"
    ).eq("project_id", project_id).eq("scene_id", scene_id).order("sort_order").execute()
    shots = _rows(shots_result)
    if not shots:
        return None
    if beats is not None and not _storyboard_matches_script(shots, beats):
        return None

    shot_ids = [shot["id"] for shot in shots]
    links_result = supabase.table("asset_links").select("target_id, asset_id").eq(
        "project_id", project_id
    ).eq("target_type", "shot").eq("role", "storyboard").in_("target_id", shot_ids).execute()
    links = _rows(links_result)
    if not links:
        return None

    asset_ids = [link["asset_id"] for link in links]
    assets_result = supabase.table("assets").select("id, url").in_("id", asset_ids).execute()
    urls = {asset["id"]: asset["url"] for asset in _rows(assets_result)}
    image_by_shot = {link["target_id"]: urls.get(link["asset_id"]) for link in links}
    return GenerateStoryboardResponse(
        scene_id=scene_id,
        status="complete",
        reused=True,
        frames=[_frame_response(shot, image_by_shot.get(shot["id"])) for shot in shots],
    )


STORYBOARD_FRAME_MAX_SIDE = 1920
STORYBOARD_FRAME_JPEG_QUALITY = 88


def _storyboard_frame_jpeg(content: bytes) -> tuple[bytes, int | None, int | None]:
    """Re-encode a model output as a real JPEG, at most 1920px on the long side.

    Models return PNG or JPEG at up to ~2.7K; storing those bytes as-is made frames
    several megabytes (a 2752x1536 PNG was 6.8 MB), too slow for the browser and for
    Next.js image optimization. If the bytes cannot be decoded they are stored unchanged.
    """
    try:
        with Image.open(io.BytesIO(content)) as image:
            frame = image.convert("RGB")
        frame.thumbnail((STORYBOARD_FRAME_MAX_SIDE, STORYBOARD_FRAME_MAX_SIDE), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        frame.save(buffer, "JPEG", quality=STORYBOARD_FRAME_JPEG_QUALITY, optimize=True, progressive=True)
        return buffer.getvalue(), frame.width, frame.height
    except Exception as error:  # noqa: BLE001 - keep the frame even if it cannot be re-encoded
        logger.warning("Could not re-encode storyboard frame; storing original bytes: %s", error)
        return content, None, None


def _persist_frame_image(
    project_id: str,
    scene_id: str,
    job_id: str,
    shot: dict[str, Any],
    source_url: str,
    output_index: int,
) -> str:
    supabase = require_supabase_client()
    download = httpx.get(source_url, timeout=60.0)
    download.raise_for_status()
    frame_bytes, width, height = _storyboard_frame_jpeg(download.content)
    storage_path = f"storyboards/{scene_id}/{job_id}/{output_index}_{uuid.uuid4().hex}.jpg"
    supabase.storage.from_("output-images").upload(
        file=frame_bytes,
        path=storage_path,
        file_options={"content-type": "image/jpeg"},
    )
    image_url = supabase.storage.from_("output-images").get_public_url(storage_path)
    asset_result = supabase.table("assets").insert({
        "project_id": project_id,
        "type": "image",
        "source": "generation",
        "name": f"Storyboard - {shot['shot_number']}",
        "url": image_url,
        "storage_path": storage_path,
        "mime_type": "image/jpeg",
        "size_bytes": len(frame_bytes),
        "width": width,
        "height": height,
        "metadata": {"storyboard": True, "scene_id": scene_id, "shot_id": shot["id"]},
    }).execute()
    if not _rows(asset_result):
        raise RuntimeError("Failed to save storyboard image asset")
    asset_id = _rows(asset_result)[0]["id"]
    supabase.table("generation_outputs").insert({
        "generation_job_id": job_id,
        "asset_id": asset_id,
        "output_index": output_index,
        "selected": output_index == 0,
        "metadata": {"shot_id": shot["id"], "prompt": shot.get("prompt", "")},
    }).execute()
    supabase.table("asset_links").insert({
        "project_id": project_id,
        "asset_id": asset_id,
        "target_type": "shot",
        "target_id": shot["id"],
        "role": "storyboard",
        "sort_order": output_index,
    }).execute()
    supabase.table("shots").update({"status": "complete"}).eq("id", shot["id"]).execute()
    return image_url


def _character_views_from_links(
    links: list[dict[str, Any]],
    asset_urls: dict[str, str],
    latest_generation_job_id: object = None,
) -> dict[str, str]:
    """Map view name to URL for one character, preferring its latest turnaround.

    ``links`` arrive oldest first, so later links overwrite earlier ones; links from the
    character's latest generation are applied last so an older set never wins.
    """
    def is_latest(link: dict[str, Any]) -> bool:
        metadata = link.get("metadata") or {}
        return bool(latest_generation_job_id) and metadata.get("generation_job_id") == latest_generation_job_id

    views: dict[str, str] = {}
    for link in sorted(links, key=is_latest):
        url = asset_urls.get(str(link.get("asset_id") or ""))
        if not url:
            continue
        if link.get("role") in (FACE_CLOSEUP_VIEW, MODEL_SHEET_VIEW):
            views[str(link["role"])] = url
        else:
            views[(link.get("metadata") or {}).get("view") or "front"] = url
    return views


def _entity_galleries(
    supabase: Any,
    project_id: str,
    target_type: str,
    entities: list[dict[str, Any]],
) -> dict[str, list[dict[str, str]]]:
    """Reference images per environment or prop: main image first, then the gallery."""
    ids = [entity["id"] for entity in entities if entity.get("id")]
    if not ids:
        return {}
    links = _rows(supabase.table("asset_links").select("target_id, asset_id, metadata").eq(
        "project_id", project_id
    ).eq("target_type", target_type).eq("role", "reference").in_("target_id", ids).order("created_at").execute())
    asset_ids = {str(link["asset_id"]) for link in links if link.get("asset_id")}
    asset_ids.update(str(entity["primary_asset_id"]) for entity in entities if entity.get("primary_asset_id"))
    urls: dict[str, str] = {}
    if asset_ids:
        urls = {
            str(asset["id"]): str(asset["url"])
            for asset in _rows(supabase.table("assets").select("id, url").in_("id", list(asset_ids)).execute())
        }
    return {entity["id"]: _entity_gallery(entity, links, urls) for entity in entities if entity.get("id")}


def _entity_gallery(
    entity: dict[str, Any],
    links: list[dict[str, Any]],
    urls: dict[str, str],
) -> list[dict[str, str]]:
    primary_id = str(entity.get("primary_asset_id") or "")
    gallery: list[dict[str, str]] = []
    if primary_id in urls:
        gallery.append({"url": urls[primary_id], "angle": "primary"})
    for link in links:
        asset_id = str(link.get("asset_id") or "")
        if link.get("target_id") != entity["id"] or asset_id == primary_id or asset_id not in urls:
            continue
        gallery.append({"url": urls[asset_id], "angle": str((link.get("metadata") or {}).get("angle") or "custom")})
    return gallery


def _attach_importance_tiers(
    project_id: str,
    environment: dict[str, Any] | None,
    objects: list[dict[str, Any]],
    characters: list[dict[str, Any]] | None = None,
) -> None:
    """Tag characters, the location and props with their major/medium/minor tier from the whole script.

    The tier decides how many of their reference images a shot may use. Ranking is a
    refinement, so a failure leaves them untiered rather than stopping the storyboard.
    """
    try:
        if characters:
            character_rankings = rank_characters_from_script(project_id)
            for character in characters:
                ranking = character_rankings.get(str(character.get("id")))
                character["tier"] = ranking.tier if ranking else None
        if objects:
            rankings = rank_objects_from_script(project_id, objects)
            for obj in objects:
                ranking = rankings.get(str(obj.get("id")))
                obj["tier"] = ranking.tier if ranking else None
        if environment and environment.get("id"):
            ranking = rank_environments_from_script(project_id).get(str(environment["id"]))
            environment["tier"] = ranking.tier if ranking else None
    except Exception as error:
        logger.warning("Could not rank storyboard environment and props: %s", error)


def _gather_scene_linked_entities(
    project_id: str, scene_id: str, blocks: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, list[dict[str, Any]]]:
    """Gather character keyframe views, the environment image, and prop images for a scene.

    Every character that has keyframes is returned: action lines decide which character
    appears in a frame, so restricting this to names mentioned in dialogue beats would
    drop exactly the characters this pipeline needs.
    """
    supabase = require_supabase_client()

    # 1. Characters. Voice-only characters (narrators) are heard, never drawn, so they are
    # left out entirely: the planner never casts them and no shot sends their images.
    characters_out: list[dict[str, Any]] = []
    character_types = character_type_map()
    chars_res = supabase.table("characters").select(
        "id, name, role, character_type, on_camera, age, gender, race, appearance, personality, "
        "physical, type_details, tags, metadata, primary_asset_id"
    ).eq("project_id", project_id).execute()
    project_characters = [c for c in _rows(chars_res) if is_on_camera(c, character_types)]
    if project_characters:
        char_ids = [c["id"] for c in project_characters]
        # The approved model sheet, its face crop and older turnaround keyframes are
        # references. Unapproved sheet candidates and the old composed sheets (role
        # "character_sheet", with printed labels) must never reach the image model.
        links_res = supabase.table("asset_links").select("target_id, asset_id, role, metadata").eq(
            "project_id", project_id
        ).eq("target_type", "character").in_("role", ["keyframe", FACE_CLOSEUP_VIEW, MODEL_SHEET_VIEW]).in_(
            "target_id", char_ids
        ).order("created_at").execute()
        links = _rows(links_res)

        asset_ids = [link["asset_id"] for link in links if link.get("asset_id")]
        asset_ids.extend(c["primary_asset_id"] for c in project_characters if c.get("primary_asset_id"))
        assets_dict: dict[str, str] = {}
        if asset_ids:
            assets_res = supabase.table("assets").select("id, url").in_("id", asset_ids).execute()
            assets_dict = {a["id"]: a["url"] for a in _rows(assets_res)}

        for c in project_characters:
            metadata = c.get("metadata") if isinstance(c.get("metadata"), dict) else {}
            characters_out.append({
                # Manual profile values (role, appearance...) win over script facts, as on the sheet.
                **effective_character_profile(c),
                "role_summary": role_summary(c, character_types),
                "views": _character_views_from_links(
                    [link for link in links if link.get("target_id") == c["id"]],
                    assets_dict,
                    metadata.get("latest_generation_job_id"),
                ),
                "image_url": assets_dict.get(str(c.get("primary_asset_id") or "")),
            })

    # 2. Environment
    environment_out: dict[str, Any] | None = None
    env_res = supabase.table("environments").select(
        "id, name, description, primary_asset_id"
    ).eq("project_id", project_id).execute()
    all_envs = _rows(env_res)
    if all_envs:
        scene_info = _maybe_single_data(
            supabase.table("scenes").select("location").eq("id", scene_id).maybe_single().execute()
        )
        loc_name = str(scene_info.get("location") or "").strip().upper()
        matched_env = next(
            (e for e in all_envs if str(e.get("name") or "").strip().upper() == loc_name),
            all_envs[0],
        )
        if matched_env:
            galleries = _entity_galleries(supabase, project_id, "environment", [matched_env])
            gallery = galleries.get(matched_env["id"], [])
            environment_out = {
                **matched_env,
                "image_url": gallery[0]["url"] if gallery else None,
                "references": gallery,
            }

    # 3. Objects / Props
    objects_out: list[dict[str, Any]] = []
    props = _rows(supabase.table("props").select(
        "id, name, description, tags, primary_asset_id, metadata"
    ).eq("project_id", project_id).execute())
    prop_galleries = _entity_galleries(supabase, project_id, "prop", props)
    for obj in props:
        gallery = prop_galleries.get(obj["id"], [])
        objects_out.append({
            **obj,
            "image_url": gallery[0]["url"] if gallery else None,
            "references": gallery,
        })

    _attach_importance_tiers(project_id, environment_out, objects_out, characters_out)
    return characters_out, environment_out, objects_out


def _storyboard_image_request(
    provider: str,
    model: str,
    prompt: str,
    image_references: list[str],
    project_id: str,
) -> CreateImageRequest:
    """Image request for one storyboard frame.

    WaveSpeed storyboard models are edit endpoints that need at least one reference
    image; a shot with none (no characters, location or props with images) is rendered
    from text with ``TEXT_ONLY_FALLBACK_MODEL`` instead.
    """
    if provider == "wavespeed":
        storyboard_model(model)  # raises ValueError for an unknown model
        if not image_references:
            model = TEXT_ONLY_FALLBACK_MODEL
    return CreateImageRequest(
        model=model,
        provider=provider,
        prompt=prompt,
        aspect_ratio="16:9",
        num_images=1,
        resolution="1k",
        image_search=False,
        google_search=False,
        output_format="jpg",
        image_input=image_references or None,
        project_id=project_id,
    )


def generate_scene_storyboard(
    project_id: str,
    scene_id: str,
    force_regenerate: bool = False,
    provider: str = STORYBOARD_PROVIDER,
    model: str = STORYBOARD_MODEL,
) -> GenerateStoryboardResponse:
    """Build durable storyboard stills for one screenplay scene.

    The scene's action lines are broken into a shot list, then each shot renders one
    frame, in script order. A language model plans the shots; the image prompt wording
    is still assembled deterministically from each shot.
    """
    supabase = require_supabase_client()

    scene_result = supabase.table("scenes").select(
        "id, project_id, slugline_raw, title, unit_type, is_leaf, location, time_of_day, summary, duration_seconds"
    ).eq("id", scene_id).eq("project_id", project_id).execute()
    if not _rows(scene_result):
        raise ValueError("Scene was not found in this project")
    scene = _rows(scene_result)[0]

    type_config = load_project_script_context(project_id).type_config
    if scene.get("is_leaf") is False:
        raise ValueError(
            f"Storyboards are made per {type_config.leaf_unit.label.lower()}; "
            f"pick a {type_config.leaf_unit.label.lower()} instead of a {scene.get('unit_type')}"
        )
    vocabulary = storyboard_vocabulary(type_config)

    blocks_result = supabase.table("script_blocks").select(
        "id, block_type, content, character_id, character_name, parenthetical, dialogue_mode, sort_order, updated_at"
    ).eq("project_id", project_id).eq("scene_id", scene_id).order("sort_order").execute()
    blocks = _rows(blocks_result)

    beats = _build_scene_beats(
        blocks,
        include_speaker_frames=_env_flag("STORYBOARD_SPEAKER_PRESENCE_FRAMES", True),
        vocabulary=vocabulary,
        cast=_load_speaker_cast(project_id),
    )
    if not beats:
        raise ValueError(f"This {type_config.leaf_unit.label.lower()} has no visual lines to storyboard")

    max_action_frames = _env_int("STORYBOARD_MAX_ACTION_FRAMES", DEFAULT_MAX_ACTION_FRAMES)
    capped_beats, truncated = _apply_action_frame_cap(beats, max_action_frames)

    if not force_regenerate:
        existing = _existing_storyboard(project_id, scene_id, capped_beats)
        if existing:
            return existing

    visual_style = load_project_visual_style(project_id, supabase)
    characters, environment, objects = _gather_scene_linked_entities(project_id, scene_id, blocks)

    scene_seconds = _scene_seconds(scene)
    pacing = load_project_runtime(supabase, project_id).pacing
    shot_plans, shot_planner, planner_error = _plan_scene_shots(
        capped_beats,
        scene,
        blocks,
        characters,
        objects,
        production=vocabulary.production,
        target_seconds=scene_seconds,
        project_type=type_config.key,
        pacing=pacing,
    )
    planned_frames = _build_frames_from_shot_plans(shot_plans, scene, characters, environment, objects)
    shot_seconds = _shot_durations(planned_frames, blocks, type_config, scene_seconds, pacing)

    action_blocks = _action_blocks(blocks, vocabulary)
    covered_block_ids = {block_id for frame in planned_frames for block_id in frame["source_block_ids"]}
    missing_beats = [
        beat for beat in capped_beats
        if beat["block"].get("id") and beat["block"]["id"] not in covered_block_ids
    ]
    if missing_beats:
        raise RuntimeError(
            "Storyboard mapping broke: every script line must be covered by at least one shot "
            f"({len(missing_beats)} of {len(capped_beats)} lines have none)"
        )

    # Replacing the shots guarantees the stored storyboard covers the current script.
    _clear_storyboard_shots(project_id, scene_id)

    shots_result = supabase.table("shots").insert([
        {
            "project_id": project_id,
            "scene_id": scene_id,
            "shot_number": index + 1,
            "description": frame["description"],
            "camera_angle": frame["camera_angle"] or None,
            "camera_motion": frame["camera_motion"] or None,
            "prompt": frame["prompt"],
            "status": "in_progress",
            "sort_order": index,
            "duration_seconds": shot_seconds[index],
            "metadata": {
                "source_block_id": frame["source_block_id"],
                "source_block_ids": frame["source_block_ids"],
                "source_block_type": frame["source_block_type"],
                "source_text": frame["source_text"],
                "planner": frame["planner"],
                "character_ids": frame["character_ids"],
                "characters": frame["characters"],
                "image_references": frame["image_references"],
            },
        }
        for index, frame in enumerate(planned_frames)
    ]).execute()
    shots = _rows(shots_result)
    if len(shots) != len(planned_frames):
        raise RuntimeError("Failed to create storyboard shots")

    job_result = supabase.table("generation_jobs").insert({
        "project_id": project_id,
        "scene_id": scene_id,
        "kind": "storyboard",
        "model": model,
        "prompt": _scene_context(scene, blocks, characters, environment, objects, visual_style),
        "settings": {
            "frame_count": len(shots),
            "action_block_count": len(action_blocks),
            "max_action_frames": max_action_frames,
            "truncated": truncated,
            "shot_planner": shot_planner,
            "shot_planner_error": planner_error,
            "prompts": [frame["prompt"] for frame in planned_frames],
        },
        "status": "running",
    }).execute()
    if not _rows(job_result):
        raise RuntimeError("Failed to create storyboard generation job")
    job_id = _rows(job_result)[0]["id"]

    concurrency_limit = max(1, int(os.getenv("STORYBOARD_GENERATION_CONCURRENCY", "3")))

    def generate_image(shot: dict[str, Any], frame_meta: dict[str, Any]) -> str:
        image_inputs = frame_meta.get("image_references") or []
        response = generate_provider_images(_storyboard_image_request(
            provider, model, apply_visual_style(shot["prompt"], visual_style), list(image_inputs), project_id,
        ))
        if not response.images:
            raise RuntimeError("Image model did not return a storyboard image")
        return response.images[0]

    results: list[tuple[dict[str, Any], str | None, str | None]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency_limit) as executor:
        future_to_shot = {
            executor.submit(generate_image, shot, planned_frames[idx]): shot
            for idx, shot in enumerate(shots)
        }
        for future in concurrent.futures.as_completed(future_to_shot):
            shot = future_to_shot[future]
            try:
                results.append((shot, future.result(), None))
            except Exception as error:
                results.append((shot, None, str(error)))

    response_frames: list[StoryboardFrame] = []
    has_failure = False
    for shot, source_url, generation_error in sorted(results, key=lambda result: result[0].get("sort_order") or 0):
        if generation_error or not source_url:
            has_failure = True
            supabase.table("shots").update({"status": "failed"}).eq("id", shot["id"]).execute()
            response_frames.append(_frame_response({**shot, "status": "failed"}, error=generation_error))
            continue
        try:
            image_url = _persist_frame_image(project_id, scene_id, job_id, shot, source_url, shot["sort_order"])
            response_frames.append(_frame_response({**shot, "status": "complete"}, image_url=image_url))
        except Exception as error:
            has_failure = True
            message = str(error)
            supabase.table("shots").update({"status": "failed"}).eq("id", shot["id"]).execute()
            response_frames.append(_frame_response({**shot, "status": "failed"}, error=message))

    status = "failed" if has_failure else "complete"
    supabase.table("generation_jobs").update({
        "status": status,
        "completed_at": datetime.now(UTC).isoformat() if not has_failure else None,
        "error_message": "One or more storyboard frames failed" if has_failure else None,
    }).eq("id", job_id).execute()
    return GenerateStoryboardResponse(
        scene_id=scene_id,
        generation_job_id=job_id,
        status="partial" if has_failure and any(frame.image_url for frame in response_frames) else status,
        shot_planner=shot_planner,
        frames=response_frames,
    )


def regenerate_single_shot_frame(
    project_id: str,
    shot_id: str,
    prompt_override: str | None = None,
    provider: str = STORYBOARD_PROVIDER,
    model: str = STORYBOARD_MODEL,
) -> StoryboardFrame:
    """Regenerate a single storyboard frame/shot."""
    supabase = require_supabase_client()

    shot = _maybe_single_data(
        supabase.table("shots").select("*").eq("id", shot_id).eq("project_id", project_id).maybe_single().execute()
    )
    if not shot:
        raise ValueError("Shot was not found")

    prompt = prompt_override.strip() if prompt_override and prompt_override.strip() else str(shot.get("prompt") or "")
    if not prompt:
        raise ValueError("Prompt is required to regenerate shot")
    image_references = [
        str(url)
        for url in ((shot.get("metadata") or {}).get("image_references") or [])
        if url
    ]
    visual_style = load_project_visual_style(project_id, supabase)

    if prompt != shot.get("prompt"):
        supabase.table("shots").update({"prompt": prompt, "status": "in_progress"}).eq("id", shot_id).execute()
    else:
        supabase.table("shots").update({"status": "in_progress"}).eq("id", shot_id).execute()

    job_result = supabase.table("generation_jobs").insert({
        "project_id": project_id,
        "scene_id": shot["scene_id"],
        "shot_id": shot_id,
        "kind": "storyboard",
        "model": model,
        "prompt": apply_visual_style(prompt, visual_style),
        "settings": {"regeneration": True, "provider": provider},
        "status": "running",
    }).execute()
    if not _rows(job_result):
        raise RuntimeError("Failed to create storyboard regeneration job")
    job_id = _rows(job_result)[0]["id"]

    try:
        response = generate_provider_images(_storyboard_image_request(
            provider, model, apply_visual_style(prompt, visual_style), image_references, project_id,
        ))
        if not response.images:
            error_message = "Image model returned no image"
            supabase.table("shots").update({"status": "failed"}).eq("id", shot_id).execute()
            supabase.table("generation_jobs").update({
                "status": "failed",
                "error_message": error_message,
            }).eq("id", job_id).execute()
            return _frame_response({**shot, "status": "failed"}, error=error_message)

        source_url = response.images[0]

        # Delete previous asset links for this shot
        supabase.table("asset_links").delete().eq("project_id", project_id).eq("target_type", "shot").eq("role", "storyboard").eq("target_id", shot_id).execute()

        image_url = _persist_frame_image(
            project_id,
            shot["scene_id"],
            job_id,
            {**shot, "prompt": apply_visual_style(prompt, visual_style)},
            source_url,
            shot.get("sort_order") or 0,
        )
    except Exception as error:
        supabase.table("shots").update({"status": "failed"}).eq("id", shot_id).execute()
        supabase.table("generation_jobs").update({
            "status": "failed",
            "error_message": describe_error(error),
        }).eq("id", job_id).execute()
        raise

    supabase.table("generation_jobs").update({
        "status": "complete",
        "completed_at": datetime.now(UTC).isoformat(),
    }).eq("id", job_id).execute()
    return _frame_response({**shot, "prompt": prompt, "status": "complete"}, image_url=image_url)

