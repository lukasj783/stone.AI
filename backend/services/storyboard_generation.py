import concurrent.futures
import os
import re
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

import httpx

from core.supabase_client import get_supabase_client
from schemas.image_generation import (
    CreateImageRequest,
    GenerateStoryboardResponse,
    StoryboardFrame,
)
from services.image_generation_service import generate_provider_images
from services.project_visual_style import ProjectVisualStyle, apply_visual_style, load_project_visual_style


STORYBOARD_MODEL = "nanobanana"

# One screenplay action line maps to exactly one storyboard frame. These knobs only
# bound cost and reference payloads; they never change that 1:1 mapping.
DEFAULT_MAX_ACTION_FRAMES = 24
DEFAULT_CHARACTER_VIEW_ORDER = ("front", "left_three_quarter")
DEFAULT_MAX_REFERENCE_IMAGES = 6

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


def _env_csv(name: str, default: Sequence[str]) -> tuple[str, ...]:
    raw = os.getenv(name)
    if raw is None:
        return tuple(default)
    items = tuple(part.strip() for part in raw.split(",") if part.strip())
    return items or tuple(default)


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
        char_lines.append(
            f"- {c_name} (Role: {c.get('role', 'N/A')}, Age: {c.get('age', 'N/A')}, Gender: {c.get('gender', 'N/A')}, Race: {c.get('race', 'N/A')})\n"
            f"  Appearance: {c.get('appearance', 'N/A')}{tag_line}\n"
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


def _action_blocks(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [block for block in blocks if _block_type(block) == ACTION_BLOCK_TYPE and _block_text(block)]


def _has_adjacent_action(blocks: list[dict[str, Any]], index: int) -> bool:
    """True when the dialogue block at *index* sits inside a run of action beats."""
    for step in (-1, 1):
        cursor = index + step
        while 0 <= cursor < len(blocks):
            neighbour_type = _block_type(blocks[cursor])
            if neighbour_type == ACTION_BLOCK_TYPE:
                if _block_text(blocks[cursor]):
                    return True
            elif neighbour_type in BEAT_BOUNDARY_BLOCK_TYPES:
                break
            cursor += step
    return False


def _build_scene_beats(
    blocks: list[dict[str, Any]],
    include_speaker_frames: bool = True,
) -> list[dict[str, Any]]:
    """Map screenplay blocks to storyboard beats: one action line -> exactly one beat.

    Dialogue never renders a frame on its own image content. It only adds a
    speaker-presence beat when no action line covers that beat visually, which keeps
    dialogue-only scenes storyboarded without leaking dialogue text into prompts.
    """
    beats: list[dict[str, Any]] = []
    for index, block in enumerate(blocks):
        block_type = _block_type(block)
        if block_type == ACTION_BLOCK_TYPE:
            text = _block_text(block)
            if not text:
                continue
            beats.append({"kind": "action", "block": block, "text": text, "speaker": ""})
            continue

        if block_type != DIALOGUE_BLOCK_TYPE or not include_speaker_frames:
            continue
        if str(block.get("dialogue_mode") or "normal").strip().lower() != "normal":
            continue
        if _has_adjacent_action(blocks, index):
            continue
        speaker = str(block.get("character_name") or "").strip()
        if not speaker:
            continue
        if beats and beats[-1]["kind"] == "speaker" and beats[-1]["speaker"].casefold() == speaker.casefold():
            continue
        beats.append({"kind": "speaker", "block": block, "text": f"{speaker} speaks", "speaker": speaker})
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
    cleaned = re.sub(r"\s+", " ", str(name or "")).strip()
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
    haystack = f" {str(text or '').lower()} "
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
    target = " ".join(str(label or "").split())
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



def _character_reference_urls(character: dict[str, Any], view_order: Sequence[str]) -> list[str]:
    views = character.get("views") or {}
    ordered = [views[view] for view in view_order if views.get(view)]
    ordered.extend(url for view, url in views.items() if view not in view_order and url)
    if not ordered and character.get("image_url"):
        ordered.append(str(character["image_url"]))
    urls: list[str] = []
    for url in ordered:
        if url and url not in urls:
            urls.append(str(url))
    return urls


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
    appearance = str(character.get("appearance") or "").strip()
    return f"{header}: {appearance}" if appearance else header


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


def _build_frames_from_action_lines(
    beats: list[dict[str, Any]],
    scene: dict[str, Any],
    characters: list[dict[str, Any]] | None = None,
    environment: dict[str, Any] | None = None,
    objects: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Build deterministic frame specs so every action line yields exactly one frame."""
    view_order = _env_csv("STORYBOARD_CHARACTER_VIEWS", DEFAULT_CHARACTER_VIEW_ORDER)
    max_references = max(0, _env_int("STORYBOARD_MAX_REFERENCE_IMAGES", DEFAULT_MAX_REFERENCE_IMAGES))
    location_text = _describe_location(scene, environment)

    frames: list[dict[str, Any]] = []
    action_index = 0
    for beat in beats:
        block = beat["block"]
        if beat["kind"] == "action":
            matched_characters = _match_characters(beat["text"], characters)
            camera_angle = "wide establishing shot" if action_index == 0 else "medium shot"
            action_index += 1
            description = beat["text"]
            beat_line = f"ACTION: {beat['text']}"
            speaker = None
        else:
            speaker = beat["speaker"]
            matched_characters = _match_character_by_label(speaker, characters)
            camera_angle = SPEAKER_FRAME_CAMERA_ANGLE
            description = beat["text"]
            beat_line = (
                f"BEAT: {speaker} is speaking, mouth open, mid-sentence, "
                "facing the camera or their scene partner."
            )

        matched_objects = _match_objects(beat["text"], objects)

        reference_urls: list[str] = []
        for character in matched_characters:
            for url in _character_reference_urls(character, view_order):
                if url not in reference_urls:
                    reference_urls.append(url)
        environment_url = (environment or {}).get("image_url")
        if environment_url and str(environment_url) not in reference_urls:
            reference_urls.append(str(environment_url))
        for obj in matched_objects:
            obj_url = obj.get("image_url")
            if obj_url and str(obj_url) not in reference_urls:
                reference_urls.append(str(obj_url))
        if max_references:
            reference_urls = reference_urls[:max_references]

        prompt_parts = ["16:9 cinematic storyboard frame.", beat_line]
        if matched_characters:
            prompt_parts.append("CHARACTERS:")
            prompt_parts.extend(f"- {_describe_character(c, speaker)}" for c in matched_characters)
        else:
            prompt_parts.append("CHARACTERS: none visible in this frame.")
        prompt_parts.append(f"LOCATION: {location_text}")
        if matched_objects:
            prompt_parts.append("PROPS: " + ", ".join(str(o.get("name")) for o in matched_objects))
        prompt_parts.append(f"CAMERA: {camera_angle}, {STATIC_CAMERA_MOTION}.")
        prompt_parts.append(FRAME_PROMPT_GUARDRAIL)

        frames.append({
            "description": description,
            "camera_angle": camera_angle,
            "camera_motion": STATIC_CAMERA_MOTION,
            "prompt": "\n".join(prompt_parts),
            "image_references": reference_urls,
            "source_block_id": block.get("id"),
            "source_block_type": _block_type(block),
            "source_text": _block_text(block),
            "character_ids": [character["id"] for character in matched_characters if character.get("id")],
            "characters": [
                _character_labels(character)
                for character in matched_characters
                if character.get("id")
            ],
        })
    return frames


def _storyboard_matches_script(shots: list[dict[str, Any]], beats: list[dict[str, Any]]) -> bool:
    """Reuse only when every stored shot maps 1:1 onto the current storyboard beats."""
    if not shots or len(shots) != len(beats):
        return False
    stored_ids = [(shot.get("metadata") or {}).get("source_block_id") for shot in shots]
    expected_ids = [beat["block"].get("id") for beat in beats]
    if any(not block_id for block_id in stored_ids) or any(not block_id for block_id in expected_ids):
        return False
    if stored_ids != expected_ids:
        return False
    for shot, beat in zip(shots, beats):
        block_updated = _parse_timestamp(beat["block"].get("updated_at"))
        shot_created = _parse_timestamp(shot.get("created_at"))
        if block_updated and shot_created and block_updated > shot_created:
            return False
    return True


def _clear_storyboard_shots(project_id: str, scene_id: str) -> None:
    """Drop previous shots and their storyboard asset links before writing new frames."""
    supabase = get_supabase_client()
    old_shots = ("shots").select("id").eq("scene_id", scene_id).eq("project_id", project_id).execute()
    old_shot_ids = [shot["id"] for shot in (old_shots.data or [])]
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
        shot_number=shot.get("shot_number") or shot.get("sort_order", 0) + 1,
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
    supabase = get_supabase_client()
    shots_result = supabase.table("shots").select(
        "id, shot_number, description, camera_angle, camera_motion, prompt, status, sort_order, metadata, created_at"
    ).eq("project_id", project_id).eq("scene_id", scene_id).order("sort_order").execute()
    shots = shots_result.data or []
    if not shots:
        return None
    if beats is not None and not _storyboard_matches_script(shots, beats):
        return None

    shot_ids = [shot["id"] for shot in shots]
    links_result = supabase.table("asset_links").select("target_id, asset_id").eq(
        "project_id", project_id
    ).eq("target_type", "shot").eq("role", "storyboard").in_("target_id", shot_ids).execute()
    links = links_result.data or []
    if not links:
        return None

    asset_ids = [link["asset_id"] for link in links]
    assets_result = supabase.table("assets").select("id, url").in_("id", asset_ids).execute()
    urls = {asset["id"]: asset["url"] for asset in assets_result.data or []}
    image_by_shot = {link["target_id"]: urls.get(link["asset_id"]) for link in links}
    return GenerateStoryboardResponse(
        scene_id=scene_id,
        status="complete",
        reused=True,
        frames=[_frame_response(shot, image_by_shot.get(shot["id"])) for shot in shots],
    )


def _persist_frame_image(
    project_id: str,
    scene_id: str,
    job_id: str,
    shot: dict[str, Any],
    source_url: str,
    output_index: int,
) -> str:
    supabase = get_supabase_client()
    download = httpx.get(source_url, timeout=60.0)
    download.raise_for_status()
    storage_path = f"storyboards/{scene_id}/{job_id}/{output_index}_{uuid.uuid4().hex}.jpg"
    supabase.storage.from_("output-images").upload(
        file=download.content,
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
        "metadata": {"storyboard": True, "scene_id": scene_id, "shot_id": shot["id"]},
    }).execute()
    if not asset_result.data:
        raise RuntimeError("Failed to save storyboard image asset")
    asset_id = asset_result.data[0]["id"]
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


def _gather_scene_linked_entities(
    project_id: str, scene_id: str, blocks: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, list[dict[str, Any]]]:
    """Gather character keyframe views, the environment image, and prop images for a scene.

    Every character that has keyframes is returned: action lines decide which character
    appears in a frame, so restricting this to names mentioned in dialogue beats would
    drop exactly the characters this pipeline needs.
    """
    supabase = get_supabase_client()

    # 1. Characters
    characters_out: list[dict[str, Any]] = []
    chars_res = supabase.table("characters").select(
        "id, name, role, character_type, age, gender, race, appearance, personality, "
        "tags, metadata, primary_asset_id"
    ).eq("project_id", project_id).execute()
    project_characters = chars_res.data or []
    if project_characters:
        char_ids = [c["id"] for c in project_characters]
        links_res = supabase.table("asset_links").select("target_id, asset_id, metadata").eq(
            "project_id", project_id
        ).eq("target_type", "character").in_("target_id", char_ids).execute()
        links = links_res.data or []

        asset_ids = [link["asset_id"] for link in links if link.get("asset_id")]
        asset_ids.extend(c["primary_asset_id"] for c in project_characters if c.get("primary_asset_id"))
        assets_dict: dict[str, str] = {}
        if asset_ids:
            assets_res = supabase.table("assets").select("id, url").in_("id", asset_ids).execute()
            assets_dict = {a["id"]: a["url"] for a in (assets_res.data or [])}

        links_by_char: dict[str, dict[str, str]] = {}
        for link in links:
            c_id = link["target_id"]
            view = (link.get("metadata") or {}).get("view") or "front"
            url = assets_dict.get(link["asset_id"])
            if url:
                links_by_char.setdefault(c_id, {})[view] = url

        for c in project_characters:
            characters_out.append({
                **c,
                "views": links_by_char.get(c["id"], {}),
                "image_url": assets_dict.get(c.get("primary_asset_id")),
            })

    # 2. Environment
    environment_out: dict[str, Any] | None = None
    env_res = supabase.table("environments").select(
        "id, name, description, primary_asset_id"
    ).eq("project_id", project_id).execute()
    all_envs = env_res.data or []
    if all_envs:
        scene_info = supabase.table("scenes").select("location").eq("id", scene_id).maybe_single().execute()
        loc_name = (scene_info.data or {}).get("location", "").strip().upper()
        matched_env = next((e for e in all_envs if e.get("name", "").strip().upper() == loc_name), all_envs[0] if all_envs else None)
        if matched_env:
            env_url = None
            if matched_env.get("primary_asset_id"):
                a_res = supabase.table("assets").select("url").eq("id", matched_env["primary_asset_id"]).maybe_single().execute()
                env_url = (a_res.data or {}).get("url")
            environment_out = {
                **matched_env,
                "image_url": env_url,
            }

    # 3. Objects / Props
    objects_out: list[dict[str, Any]] = []
    objs_res = supabase.table("props").select(
        "id, name, description, tags, primary_asset_id"
    ).eq("project_id", project_id).execute()
    if objs_res.data:
        for obj in objs_res.data:
            obj_url = None
            if obj.get("primary_asset_id"):
                a_res = supabase.table("assets").select("url").eq("id", obj["primary_asset_id"]).maybe_single().execute()
                obj_url = (a_res.data or {}).get("url")
            objects_out.append({
                **obj,
                "image_url": obj_url,
            })

    return characters_out, environment_out, objects_out


def generate_scene_storyboard(
    project_id: str,
    scene_id: str,
    force_regenerate: bool = False,
    provider: str = "replicate",
    model: str = STORYBOARD_MODEL,
) -> GenerateStoryboardResponse:
    """Build durable storyboard stills for one screenplay scene.

    Every screenplay action line produces exactly one storyboard frame, in script order.
    No language model decides the shot count or the prompt wording.
    """
    supabase = get_supabase_client()
    if not supabase:
        raise RuntimeError("Supabase client not initialized")

    scene_result = supabase.table("scenes").select(
        "id, project_id, slugline_raw, location, time_of_day, summary"
    ).eq("id", scene_id).eq("project_id", project_id).execute()
    if not scene_result.data:
        raise ValueError("Scene was not found in this project")
    scene = scene_result.data[0]
    blocks_result = supabase.table("script_blocks").select(
        "id, block_type, content, character_id, character_name, parenthetical, dialogue_mode, sort_order, updated_at"
    ).eq("project_id", project_id).eq("scene_id", scene_id).order("sort_order").execute()
    blocks = blocks_result.data or []

    beats = _build_scene_beats(
        blocks,
        include_speaker_frames=_env_flag("STORYBOARD_SPEAKER_PRESENCE_FRAMES", True),
    )
    if not beats:
        raise ValueError("Scene has no action lines to storyboard")

    if not force_regenerate:
        existing = _existing_storyboard(project_id, scene_id, beats)
        if existing:
            return existing

    visual_style = load_project_visual_style(project_id, supabase)
    characters, environment, objects = _gather_scene_linked_entities(project_id, scene_id, blocks)

    max_action_frames = _env_int("STORYBOARD_MAX_ACTION_FRAMES", DEFAULT_MAX_ACTION_FRAMES)
    capped_beats, truncated = _apply_action_frame_cap(beats, max_action_frames)
    planned_frames = _build_frames_from_action_lines(capped_beats, scene, characters, environment, objects)

    action_blocks = _action_blocks(blocks)
    expected_action_frames = len(action_blocks)
    if max_action_frames > 0:
        expected_action_frames = min(expected_action_frames, max_action_frames)
    planned_action_frames = sum(1 for frame in planned_frames if frame["source_block_type"] == ACTION_BLOCK_TYPE)
    if planned_action_frames != expected_action_frames:
        raise RuntimeError(
            "Storyboard mapping broke: every action line must produce exactly one frame "
            f"(expected {expected_action_frames}, got {planned_action_frames})"
        )

    # Replacing the shots guarantees the stored storyboard maps 1:1 onto the current script.
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
            "metadata": {
                "source_block_id": frame["source_block_id"],
                "source_block_type": frame["source_block_type"],
                "source_text": frame["source_text"],
                "character_ids": frame["character_ids"],
                "characters": frame["characters"],
                "image_references": frame["image_references"],
            },
        }
        for index, frame in enumerate(planned_frames)
    ]).execute()
    shots = shots_result.data or []
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
            "prompts": [frame["prompt"] for frame in planned_frames],
        },
        "status": "running",
    }).execute()
    if not job_result.data:
        raise RuntimeError("Failed to create storyboard generation job")
    job_id = job_result.data[0]["id"]

    concurrency_limit = max(1, int(os.getenv("STORYBOARD_GENERATION_CONCURRENCY", "3")))

    def generate_image(shot: dict[str, Any], frame_meta: dict[str, Any]) -> str:
        image_inputs = frame_meta.get("image_references") or []
        response = generate_provider_images(CreateImageRequest(
            model=model,
            provider=provider,
            prompt=apply_visual_style(shot["prompt"], visual_style),
            aspect_ratio="16:9",
            num_images=1,
            resolution="1k",
            image_search=False,
            google_search=False,
            output_format="jpg",
            image_input=image_inputs if image_inputs else None,
            project_id=project_id,
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
    for shot, source_url, generation_error in sorted(results, key=lambda result: result[0].get("sort_order", 0)):
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
        frames=response_frames,
    )


def regenerate_single_shot_frame(
    project_id: str,
    shot_id: str,
    prompt_override: str | None = None,
    provider: str = "replicate",
    model: str = STORYBOARD_MODEL,
) -> StoryboardFrame:
    """Regenerate a single storyboard frame/shot."""
    supabase = get_supabase_client()
    if not supabase:
        raise RuntimeError("Supabase client not initialized")

    shot_res = supabase.table("shots").select("*").eq("id", shot_id).eq("project_id", project_id).single().execute()
    if not shot_res.data:
        raise ValueError("Shot was not found")
    shot = shot_res.data

    prompt = prompt_override.strip() if prompt_override and prompt_override.strip() else shot.get("prompt", "")
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
    if not job_result.data:
        raise RuntimeError("Failed to create storyboard regeneration job")
    job_id = job_result.data[0]["id"]

    try:
        response = generate_provider_images(CreateImageRequest(
            model=model,
            provider=provider,
            prompt=apply_visual_style(prompt, visual_style),
            aspect_ratio="16:9",
            num_images=1,
            resolution="1k",
            image_search=False,
            google_search=False,
            output_format="jpg",
            image_input=image_references or None,
            project_id=project_id,
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
            shot.get("sort_order", 0),
        )
    except Exception as error:
        supabase.table("shots").update({"status": "failed"}).eq("id", shot_id).execute()
        supabase.table("generation_jobs").update({
            "status": "failed",
            "error_message": str(error),
        }).eq("id", job_id).execute()
        raise

    supabase.table("generation_jobs").update({
        "status": "complete",
        "completed_at": datetime.now(UTC).isoformat(),
    }).eq("id", job_id).execute()
    return _frame_response({**shot, "prompt": prompt, "status": "complete"}, image_url=image_url)

