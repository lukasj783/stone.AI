import json
import replicate
import uuid
from fastapi import APIRouter, HTTPException, BackgroundTasks
import asyncio
from dataclasses import asdict

from supabase import Client
from typing import Any

from core.supabase_client import get_supabase_client, require_supabase_client
from core.supabase_records import as_records, maybe_single_record
from core.config import get_settings
from schemas.script import (
    CharacterRankingSchema,
    EnvironmentRankingSchema,
    ObjectRankingSchema,
    CharacterProfileResponse,
    CharacterScriptSyncPreviewResponse,
    ConfirmCharacterScriptSyncPayload,
    ConfirmCharacterScriptSyncResponse,
    CreateObjectPayload,
    EnvironmentProfileResponse,
    ExtractedCharacterSchema,
    ExtractedObjectSchema,
    ExtractScriptCharactersPayload,
    ExtractScriptCharactersResponse,
    ExtractScriptEnvironmentsPayload,
    ExtractScriptEnvironmentsResponse,
    ExtractScriptObjectsPayload,
    ExtractScriptObjectsResponse,
    GenerateOutlineResponse,
    GenerateScriptPayload,
    GenerateScriptResponse,
    MovieIdeaPayload,
    ObjectProfileResponse,
    PreviewCharacterScriptSyncPayload,
    UpdateEnvironmentPayload,
    UpdateObjectPayload,
    UpdateCharacterProfilePayload,
)
from schemas.image_generation import (
    GenerateStoryboardRequest,
    GenerateStoryboardResponse,
    RegenerateShotFrameRequest,
    StoryboardModelOption,
    StoryboardFrame,
)
from services.storyboard_generation import generate_scene_storyboard, regenerate_single_shot_frame
from services.storyboard_models import DEFAULT_STORYBOARD_MODEL, STORYBOARD_MODELS
from services.character_views import (
    EDITABLE_CHARACTER_FIELDS,
    PROFILE_TEXT_MAX_CHARS,
    TYPE_DETAILS_PREFIX,
    VOICE_FIELD_NAMES,
    VOICE_FIELDS,
    VOICE_PREFIX,
    DETAIL_KEY_PATTERN,
    clean_physical,
    clean_type_details,
    clean_voice,
    effective_character_profile,
    is_on_camera,
    is_override_field,
    physical_fact_lines,
)
from services.character_ranking import rank_characters_from_script
from services.environment_ranking import rank_environments_from_script
from services.entity_profiles import (
    ENVIRONMENT_PROFILE_FIELDS,
    OBJECT_PROFILE_FIELDS,
    apply_profile_changes,
    profile_values,
)
from services.object_ranking import ObjectRanking, rank_objects_from_script, rank_project_objects
from services.duration_budget import PACING_GUIDANCE, format_seconds, normalize_pacing, parse_duration_seconds
from services.gemini_client import run_gemini
from services.project_runtime import load_project_runtime
from services.script_config import CharacterTypeConfig, character_type_map, load_project_script_context
from services.script_generation import (
    blocks_context,
    build_block_prompt,
    normalize_blocks,
    parse_model_json,
    PlanError,
    plan_script,
)
from routers.script_engine import compile_project_script, save_compiled_script

router = APIRouter(prefix="/api/story", tags=["story"])


def _gemini_input(
    prompt: str,
    *,
    system_instruction: str | None = None,
    thinking_level: str | None = None,
    temperature: float | None = None,
) -> dict[str, object]:
    """Build the Replicate input payload for the configured Gemini model.

    Fields mirror the google/gemini-3.5-flash schema: prompt, system_instruction,
    thinking_level ("none" | "low" | "high"), temperature, top_p,
    max_output_tokens, images, videos, video_fps and audio.
    """
    settings = get_settings()
    payload: dict[str, object] = {"prompt": prompt}
    level = (thinking_level or settings.gemini_thinking_level or "none").strip().lower()
    if level in {"none", "low", "high"}:
        payload["thinking_level"] = level
    if system_instruction:
        payload["system_instruction"] = system_instruction
    if temperature is not None:
        payload["temperature"] = temperature
    return payload


def _run_gemini(
    client: replicate.Client,
    prompt: str,
    *,
    system_instruction: str | None = None,
    thinking_level: str | None = None,
    temperature: float | None = None,
) -> str:
    """Run the configured Gemini model on Replicate and return the response text.

    `client` is kept for existing callers but unused: the call goes over HTTP because
    replicate-python 1.0.x cannot parse predictions for official models.
    """
    return run_gemini(
        prompt,
        system_instruction=system_instruction,
        thinking_level=thinking_level,
        temperature=temperature,
    )


def _parse_json_object(value: str) -> object:
    cleaned = value.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        cleaned = "\n".join(lines[1:-1] if lines and lines[-1].strip() == "```" else lines[1:]).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = min((index for index in (cleaned.find("{"), cleaned.find("[")) if index >= 0), default=-1)
        end = max(cleaned.rfind("}"), cleaned.rfind("]"))
        if start < 0 or end <= start:
            raise
        return json.loads(cleaned[start : end + 1])


def _normalize_character_name(value: str) -> str:
    return " ".join(value.upper().strip().split())


def _as_int(value: object, default: int = 0) -> int:
    """Read an integer out of a JSON payload without trusting its runtime type."""
    if isinstance(value, bool) or not isinstance(value, int):
        return default
    return value


def _manual_override_fields(metadata: object) -> list[str]:
    overrides = metadata.get("manual_overrides") if isinstance(metadata, dict) else None
    if not isinstance(overrides, dict):
        return []
    return [field for field in EDITABLE_CHARACTER_FIELDS if field in overrides]


def _all_override_fields(metadata: object) -> list[str]:
    """Every manual profile key: core and physical fields, type, presence, voice and details."""
    overrides = metadata.get("manual_overrides") if isinstance(metadata, dict) else None
    if not isinstance(overrides, dict):
        return []
    return [field for field in overrides if isinstance(field, str) and is_override_field(field)]


def _character_profile_response(
    character: dict, character_types: dict[str, CharacterTypeConfig] | None = None
) -> CharacterProfileResponse:
    effective = effective_character_profile(character)
    types = character_types if character_types is not None else character_type_map()
    voice = effective.get("voice")
    type_details = effective.get("type_details")
    response = CharacterProfileResponse(
        id=str(character["id"]),
        name=str(character["name"]),
        role=effective.get("role") if isinstance(effective.get("role"), str) else None,
        age=effective.get("age") if isinstance(effective.get("age"), int) else None,
        gender=effective.get("gender") if isinstance(effective.get("gender"), str) else None,
        race=effective.get("race") if isinstance(effective.get("race"), str) else None,
        appearance=effective.get("appearance") if isinstance(effective.get("appearance"), str) else None,
        personality=effective.get("personality") if isinstance(effective.get("personality"), str) else None,
        character_type=str(effective.get("character_type") or "supporting"),
        on_camera=is_on_camera(character, types),
        voice=voice if isinstance(voice, dict) else {},
        type_details=type_details if isinstance(type_details, dict) else {},
        manual_override_fields=_all_override_fields(character.get("metadata")),
    )
    return response.model_copy(update=clean_physical(effective.get("physical")))


def _build_character_script_description(character: dict) -> str:
    if not is_on_camera(character, character_type_map()):
        raise ValueError(
            f"{character['name']} is only heard, so the script has no on-screen description of them to update"
        )
    effective = effective_character_profile(character)
    details: list[str] = []
    age = effective.get("age")
    if isinstance(age, int) and not isinstance(age, bool):
        details.append(f"{age} years old")
    for field in ("gender", "race", "role"):
        value = effective.get(field)
        if isinstance(value, str) and value.strip():
            details.append(value.strip())
    details.extend(f"{label.lower()}: {value}" for label, value in physical_fact_lines(effective))
    appearance = effective.get("appearance")
    personality = effective.get("personality")
    description = ", ".join(details)
    if isinstance(appearance, str) and appearance.strip():
        description = f"{description}, {appearance.strip()}" if description else appearance.strip()
    if isinstance(personality, str) and personality.strip():
        description = f"{description}. {personality.strip()}" if description else personality.strip()
    if not description:
        raise ValueError("Add at least one character profile value before updating the script")
    return f"{character['name']} is {description}."


def _load_script_character_for_profile(supabase: Client, project_id: str, character_id: str) -> dict:
    result = supabase.table("characters").select(
        "id, name, character_type, on_camera, role, age, gender, race, appearance, personality, "
        "physical, voice, type_details, metadata"
    ).eq("id", character_id).eq("project_id", project_id).maybe_single().execute()
    character = maybe_single_record(result)
    metadata = (character or {}).get("metadata") or {}
    if not character or not isinstance(metadata, dict) or metadata.get("source") != "script":
        raise ValueError("Script-derived character was not found in this project")
    return character


def _find_character_first_appearance(supabase: Client, project_id: str, character: dict) -> tuple[dict, dict, dict | None]:
    scenes_result = supabase.table("scenes").select("id, slugline_raw, sort_order").eq(
        "project_id", project_id
    ).eq("is_leaf", True).order("sort_order").execute()
    scenes_by_id = {str(scene["id"]): scene for scene in as_records(scenes_result.data) if scene.get("id")}
    blocks_result = supabase.table("script_blocks").select(
        "id, scene_id, character_id, character_name, sort_order, metadata"
    ).eq("project_id", project_id).execute()
    blocks = as_records(blocks_result.data)
    character_name = _normalize_character_name(str(character["name"]))
    appearances = [
        block for block in blocks
        if block.get("scene_id") in scenes_by_id
        and (block.get("character_id") == character["id"] or _normalize_character_name(str(block.get("character_name") or "")) == character_name)
    ]
    if not appearances:
        raise ValueError("This character does not have an on-screen appearance in the saved script")
    first = min(
        appearances,
        key=lambda block: (
            _as_int(scenes_by_id[str(block["scene_id"])].get("sort_order")),
            _as_int(block.get("sort_order")),
        ),
    )
    managed = next((
        block for block in blocks
        if block.get("scene_id") == first["scene_id"]
        and isinstance(block.get("metadata"), dict)
        and block["metadata"].get("source") == "character_profile_sync"
        and block["metadata"].get("character_id") == character["id"]
    ), None)
    first_scene = scenes_by_id.get(str(first["scene_id"]))
    if first_scene is None:
        raise ValueError("The first appearance of this character could not be resolved to a scene")
    return first, first_scene, managed


def _normalize_environment_name(value: str) -> str:
    return " ".join(value.casefold().strip().split())


def _normalize_object_name(value: str) -> str:
    return " ".join(value.casefold().strip().split())


def _normalize_object_tags(values: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str):
            continue
        tag = " ".join(value.strip().split())
        key = tag.casefold()
        if tag and key not in seen:
            normalized.append(tag)
            seen.add(key)
    return normalized


def _object_profile_response(
    prop: dict,
    primary_image_url: str | None = None,
    ranking: ObjectRanking | None = None,
) -> ObjectProfileResponse:
    metadata = prop.get("metadata") if isinstance(prop.get("metadata"), dict) else {}
    sources = metadata.get("sources") if isinstance(metadata.get("sources"), list) else []
    overrides = metadata.get("manual_overrides") if isinstance(metadata.get("manual_overrides"), dict) else {}
    return ObjectProfileResponse(
        id=str(prop["id"]),
        name=str(prop["name"]),
        description=prop.get("description") if isinstance(prop.get("description"), str) else None,
        tags=[value for value in (prop.get("tags") or []) if isinstance(value, str)],
        sources=[value for value in sources if isinstance(value, str)],
        manual_override_fields=[
            field for field in ("name", "description", "tags", *OBJECT_PROFILE_FIELDS) if field in overrides
        ],
        source_scene_ids=[value for value in metadata.get("source_scene_ids", []) if isinstance(value, str)],
        source_sluglines=[value for value in metadata.get("source_sluglines", []) if isinstance(value, str)],
        primary_image_url=primary_image_url,
        profile=profile_values(metadata, OBJECT_PROFILE_FIELDS),
        ranking=ObjectRankingSchema(**asdict(ranking)) if ranking else None,
    )


def _string_list(value: object) -> list[str]:
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def _environment_profile_response(environment: dict, primary_image_url: str | None = None) -> EnvironmentProfileResponse:
    metadata = environment.get("metadata") if isinstance(environment.get("metadata"), dict) else {}
    overrides = metadata.get("manual_overrides") if isinstance(metadata.get("manual_overrides"), dict) else {}
    scene_ids = _string_list(metadata.get("source_scene_ids"))
    scene_count = metadata.get("scene_count")
    return EnvironmentProfileResponse(
        id=str(environment["id"]),
        name=str(environment["name"]),
        description=environment.get("description") if isinstance(environment.get("description"), str) else None,
        tags=_string_list(environment.get("tags")),
        primary_image_url=primary_image_url,
        profile=profile_values(metadata, ENVIRONMENT_PROFILE_FIELDS),
        manual_override_fields=[
            field for field in ("description", "tags", *ENVIRONMENT_PROFILE_FIELDS) if field in overrides
        ],
        location_types=_string_list(metadata.get("location_types")),
        time_of_day_values=_string_list(metadata.get("time_of_day_values")),
        source_scene_ids=scene_ids,
        source_sluglines=_string_list(metadata.get("source_sluglines")),
        scene_count=scene_count if isinstance(scene_count, int) else len(scene_ids),
    )


def _extract_script_environments(scenes: list[dict]) -> list[dict]:
    """Aggregate only explicit scene-location fields into reusable environments."""
    environments_by_key: dict[str, dict] = {}

    for scene in scenes:
        location = scene.get("location")
        if not isinstance(location, str) or not location.strip():
            continue

        name = " ".join(location.strip().split())
        script_key = _normalize_environment_name(name)
        environment = environments_by_key.setdefault(script_key, {
            "name": name,
            "source_scene_ids": [],
            "source_sluglines": [],
            "location_types": [],
            "time_of_day_values": [],
        })

        scene_id = scene.get("id")
        if isinstance(scene_id, str) and scene_id not in environment["source_scene_ids"]:
            environment["source_scene_ids"].append(scene_id)

        slugline = scene.get("slugline_raw")
        if isinstance(slugline, str) and slugline.strip() and slugline not in environment["source_sluglines"]:
            environment["source_sluglines"].append(slugline)

        for source_field, target_field in (("location_type", "location_types"), ("time_of_day", "time_of_day_values")):
            value = scene.get(source_field)
            if isinstance(value, str) and value.strip():
                normalized_value = " ".join(value.strip().split())
                if normalized_value not in environment[target_field]:
                    environment[target_field].append(normalized_value)

    return list(environments_by_key.values())


def _persist_script_environments(supabase: Client, project_id: str, environments: list[dict]) -> None:
    existing_result = supabase.table("environments").select("id, description, metadata").eq("project_id", project_id).execute()
    existing_by_key = {
        metadata.get("script_key"): environment
        for environment in as_records(existing_result.data)
        if isinstance((metadata := environment.get("metadata")), dict)
        and metadata.get("source") == "script"
        and isinstance(metadata.get("script_key"), str)
    }

    for environment in environments:
        script_key = _normalize_environment_name(environment["name"])
        existing = existing_by_key.get(script_key)
        existing_metadata = existing.get("metadata") if existing and isinstance(existing.get("metadata"), dict) else {}
        overrides = existing_metadata.get("manual_overrides") if isinstance(existing_metadata.get("manual_overrides"), dict) else {}
        metadata = {
            # What the user typed (profile fields and their Manual marks) survives a fresh extraction.
            **{key: existing_metadata[key] for key in ("profile", "manual_overrides") if key in existing_metadata},
            "source": "script",
            "script_key": script_key,
            "source_scene_ids": environment["source_scene_ids"],
            "source_sluglines": environment["source_sluglines"],
            "location_types": environment["location_types"],
            "time_of_day_values": environment["time_of_day_values"],
            "scene_count": len(environment["source_scene_ids"]),
            "extraction_version": 1,
        }
        values: dict[str, Any] = {"name": environment["name"], "metadata": metadata}
        if "description" not in overrides:
            values["description"] = None
        if "tags" not in overrides:
            values["tags"] = []
        if existing:
            supabase.table("environments").update(values).eq("id", existing["id"]).execute()
        else:
            supabase.table("environments").insert({"project_id": project_id, **values}).execute()


def _extract_script_objects(client: replicate.Client, screenplay: dict) -> list[ExtractedObjectSchema]:
    prompt = f"""You extract explicitly supported, reusable physical objects from a screenplay.

Screenplay JSON:
{json.dumps(screenplay)}

Return ONLY valid JSON in this shape:
{{"objects":[{{"name":"", "description":null, "tags":[], "image_prompt":"", "source_scene_indexes":[]}}]}}

Include only story-significant physical objects that are explicitly named or unambiguously described, such as a named weapon, letter, vehicle, device, or recurring personal item. Exclude characters, locations, generic set dressing, clothing, food, and broad groups of objects. Do not infer factual details. Merge repeated mentions into one object. `source_scene_indexes` must use the zero-based scene indexes supplied in the screenplay. `description` and `image_prompt` must contain only explicit screenplay facts; use null or an empty string when unavailable."""
    parsed = _parse_json_object(_run_gemini(client, prompt, thinking_level="low"))
    raw_objects = parsed.get("objects", []) if isinstance(parsed, dict) else parsed
    if not isinstance(raw_objects, list):
        raise ValueError("Object extractor response is missing objects")

    extracted_by_name: dict[str, ExtractedObjectSchema] = {}
    for raw_object in raw_objects:
        if not isinstance(raw_object, dict):
            continue
        try:
            extracted = ExtractedObjectSchema.model_validate(raw_object)
        except Exception:
            continue
        name = " ".join(extracted.name.strip().split())
        key = _normalize_object_name(name)
        if not key:
            continue
        normalized = extracted.model_copy(update={
            "name": name,
            "description": " ".join(extracted.description.strip().split()) if extracted.description else None,
            "tags": _normalize_object_tags(extracted.tags),
            "image_prompt": extracted.image_prompt.strip(),
            "source_scene_indexes": sorted({index for index in extracted.source_scene_indexes if index >= 0}),
        })
        previous = extracted_by_name.get(key)
        if previous:
            normalized = normalized.model_copy(update={
                "description": previous.description or normalized.description,
                "tags": _normalize_object_tags([*previous.tags, *normalized.tags]),
                "image_prompt": previous.image_prompt or normalized.image_prompt,
                "source_scene_indexes": sorted(set(previous.source_scene_indexes) | set(normalized.source_scene_indexes)),
            })
        extracted_by_name[key] = normalized
    return list(extracted_by_name.values())


def _persist_script_objects(supabase: Client, project_id: str, objects: list[ExtractedObjectSchema], scenes: list[dict]) -> None:
    existing_result = supabase.table("props").select("id, name, description, tags, metadata").eq("project_id", project_id).execute()
    existing_by_key: dict[str, dict] = {}
    for prop in as_records(existing_result.data):
        metadata = prop.get("metadata") if isinstance(prop.get("metadata"), dict) else {}
        for key in (_normalize_object_name(str(prop.get("name") or "")), metadata.get("script_key")):
            if isinstance(key, str) and key:
                existing_by_key[key] = prop

    for extracted in objects:
        script_key = _normalize_object_name(extracted.name)
        source_scenes = [scenes[index] for index in extracted.source_scene_indexes if index < len(scenes)]
        scene_ids = [scene["id"] for scene in source_scenes if isinstance(scene.get("id"), str)]
        sluglines = [scene["slugline_raw"] for scene in source_scenes if isinstance(scene.get("slugline_raw"), str) and scene["slugline_raw"].strip()]
        existing = existing_by_key.get(script_key)
        existing_metadata = existing.get("metadata") if existing and isinstance(existing.get("metadata"), dict) else {}
        overrides = existing_metadata.get("manual_overrides") if isinstance(existing_metadata.get("manual_overrides"), dict) else {}
        sources = {value for value in existing_metadata.get("sources", []) if isinstance(value, str)}
        sources.add("script")
        metadata = {
            **existing_metadata,
            "sources": sorted(sources),
            "script_key": script_key,
            "script_facts": {"name": extracted.name, "description": extracted.description, "tags": extracted.tags},
            "image_prompt": extracted.image_prompt,
            "source_scene_ids": scene_ids,
            "source_sluglines": sluglines,
            "extraction_version": 1,
            "manual_overrides": overrides,
        }
        values: dict[str, Any] = {"metadata": metadata}
        if "name" not in overrides:
            values["name"] = extracted.name
        if "description" not in overrides:
            values["description"] = extracted.description
        if "tags" not in overrides:
            values["tags"] = extracted.tags
        if existing:
            supabase.table("props").update(values).eq("id", existing["id"]).eq("project_id", project_id).execute()
        else:
            supabase.table("props").insert({"project_id": project_id, "name": extracted.name, "description": extracted.description, "tags": extracted.tags, **values}).execute()


DEFAULT_CHARACTER_TYPES = ("main", "supporting")
PHYSICAL_FACT_MAX_CHARS = 300
FALLBACK_CHARACTER_TYPE = "supporting"


def _character_type_configs(
    allowed_types: "tuple[str | CharacterTypeConfig, ...] | list[str | CharacterTypeConfig]",
) -> dict[str, CharacterTypeConfig]:
    """Allowed types by key; bare keys become plain on-camera types with no details."""
    configs: dict[str, CharacterTypeConfig] = {}
    for item in allowed_types or DEFAULT_CHARACTER_TYPES:
        config = item if isinstance(item, CharacterTypeConfig) else CharacterTypeConfig(key=item, label=item.title())
        configs[config.key] = config
    return configs


def _normalize_extracted_character(
    raw_character: dict,
    allowed_types: "tuple[str | CharacterTypeConfig, ...] | list[str | CharacterTypeConfig]" = DEFAULT_CHARACTER_TYPES,
) -> dict:
    types = _character_type_configs(allowed_types)
    normalized = dict(raw_character)
    age = normalized.get("age")
    if isinstance(age, str):
        age = age.strip()
        normalized["age"] = int(age) if age.isdigit() else None
    elif isinstance(age, bool) or not isinstance(age, int):
        normalized["age"] = None
    character_type = str(normalized.get("character_type") or "").strip().lower()
    if character_type not in types:
        character_type = FALLBACK_CHARACTER_TYPE if FALLBACK_CHARACTER_TYPE in types else next(iter(types))
    normalized["character_type"] = character_type
    type_config = types[character_type]

    # on_camera is stored only when the script contradicts the type's default.
    on_camera = normalized.get("on_camera")
    normalized["on_camera"] = on_camera if isinstance(on_camera, bool) and on_camera == type_config.voice_only else None
    seen = normalized["on_camera"] if normalized["on_camera"] is not None else not type_config.voice_only

    # Unknown keys are dropped and long answers trimmed so one verbose fact cannot fail the character.
    normalized["physical"] = {
        key: value[:PHYSICAL_FACT_MAX_CHARS] for key, value in clean_physical(normalized.get("physical")).items()
    } if seen else {}
    normalized["voice"] = clean_voice(normalized.get("voice"))
    normalized["type_details"] = clean_type_details(normalized.get("type_details"), type_config.detail_keys)
    if not seen:
        # Nobody sees a voice-only character, so there is nothing to draw.
        normalized["image_prompt"] = ""
    return normalized


def _character_type_guide(types: dict[str, CharacterTypeConfig]) -> str:
    lines = []
    for config in types.values():
        presence = "voice only: heard, never seen" if config.voice_only else (
            "on camera, speaks straight to the lens" if config.addresses_camera else "on camera"
        )
        details = f" type_details keys: {', '.join(config.detail_keys)}." if config.detail_keys else ""
        description = f" {config.description}" if config.description else ""
        lines.append(f'- "{config.key}" ({presence}).{description}{details}')
    return "\n".join(lines)


def _extract_script_characters(
    client: replicate.Client,
    screenplay: dict,
    allowed_types: "tuple[str | CharacterTypeConfig, ...] | list[str | CharacterTypeConfig]" = DEFAULT_CHARACTER_TYPES,
) -> list[ExtractedCharacterSchema]:
    types = _character_type_configs(allowed_types)
    type_choices = " | ".join(f'"{key}"' for key in types)
    voice_shape = ", ".join(f'"{name}":null' for name in VOICE_FIELD_NAMES)
    voice_labels = ", ".join(label.lower() for _, label in VOICE_FIELDS)
    plain_type = FALLBACK_CHARACTER_TYPE if FALLBACK_CHARACTER_TYPE in types else next(iter(types))
    prompt = f"""You extract only explicitly supported character and people facts from a script.

Script JSON:
{json.dumps(screenplay)}

Character types this production uses:
{_character_type_guide(types)}

Return ONLY valid JSON in this shape:
{{"characters":[{{"name":"", "character_type":{type_choices}, "on_camera":null, "role":null, "age":null, "gender":null, "race":null, "appearance":null, "personality":null, "physical":{{"height":null, "build":null, "skin_tone":null, "face":null, "eyes":null, "hair":null, "facial_hair":null, "distinguishing_marks":null, "glasses":null, "demeanor":null}}, "voice":{{{voice_shape}}}, "type_details":{{}}, "tags":[], "image_prompt":""}}]}}

Include every named speaking person or explicitly named character, including narrators, announcers, presenters, hosts, interviewees and spokespeople. Pick the `character_type` from the list above that matches the function the script shows: an off-screen voice-over or announcer is a narrator-type voice, a person who represents the brand on screen is a spokesperson, a person who runs a show is a host. Use `main` only for characters central to a story's main plot; otherwise use `{plain_type}`. Leave `on_camera` null when the character behaves as their type says; set it to true or false only when the script clearly shows otherwise, such as a narrator who appears on screen or an interviewer who is only heard. Do not infer, guess, or stereotype age, gender, race, visual traits, role, or personality. `age` must be an exact whole number or null; do not use ranges or labels such as "40s". Use null when the screenplay does not explicitly establish a fact. `physical` holds permanent body and face facts only (height, build, skin tone, face, eyes, hair, facial hair, scars/tattoos/birthmarks as `distinguishing_marks`, glasses, and habitual posture or bearing as `demeanor`), each a short phrase; never put clothing, a passing expression or a scene-specific state there. Characters who are only heard have no physical facts and an empty `image_prompt`. `appearance` holds any other explicit visual detail, such as usual clothing. `voice` holds explicit facts about how the character sounds ({voice_labels}), for example from parentheticals such as (V.O., excited) or from a description of their voice; null when not stated. `type_details` holds only the keys listed for the chosen type, each a short phrase stated or clearly shown by the script; omit keys the script does not support. `image_prompt` must be a concise visual description composed only from explicit screenplay facts; use an empty string when no visual facts are present."""
    parsed = _parse_json_object(_run_gemini(client, prompt, thinking_level="low"))
    raw_characters = parsed.get("characters", []) if isinstance(parsed, dict) else parsed
    if not isinstance(raw_characters, list):
        raise ValueError("Character extractor response is missing characters")

    extracted: list[ExtractedCharacterSchema] = []
    seen_names: set[str] = set()
    for raw_character in raw_characters:
        if not isinstance(raw_character, dict):
            continue
        character = ExtractedCharacterSchema.model_validate(_normalize_extracted_character(raw_character, allowed_types))
        normalized_name = _normalize_character_name(character.name)
        if not normalized_name or normalized_name in seen_names:
            continue
        seen_names.add(normalized_name)
        extracted.append(character)
    return extracted


def _persist_script_characters(supabase: Client, project_id: str, characters: list[ExtractedCharacterSchema]) -> None:
    existing_result = supabase.table("characters").select("id, name, metadata").eq("project_id", project_id).execute()
    existing_by_name = {
        _normalize_character_name(str(character.get("name") or "")): character
        for character in as_records(existing_result.data)
    }
    character_id_by_name: dict[str, str] = {}

    for character in characters:
        normalized_name = _normalize_character_name(character.name)
        values = character.model_dump(exclude={"image_prompt"})
        values["tags"] = values.get("tags") or []
        values["physical"] = clean_physical(values.get("physical"))
        existing = existing_by_name.get(normalized_name)
        existing_metadata = existing.get("metadata") if existing and isinstance(existing.get("metadata"), dict) else {}
        values["metadata"] = {
            **existing_metadata,
            "source": "script",
            "script_key": normalized_name,
            "image_prompt": character.image_prompt,
        }
        if existing:
            supabase.table("characters").update(values).eq("id", existing["id"]).execute()
            character_id_by_name[normalized_name] = str(existing["id"])
        else:
            result = supabase.table("characters").insert({"project_id": project_id, **values}).execute()
            inserted = as_records(result.data)
            if not inserted:
                inserted = as_records(
                    supabase.table("characters").select("id").eq("project_id", project_id).eq(
                        "name", character.name
                    ).order("created_at", desc=True).limit(1).execute().data
                )
            if inserted:
                character_id_by_name[normalized_name] = str(inserted[0]["id"])

    blocks_result = supabase.table("script_blocks").select("id, character_name").eq("project_id", project_id).execute()
    for block in as_records(blocks_result.data):
        character_name = block.get("character_name")
        if not isinstance(character_name, str):
            continue
        character_id = character_id_by_name.get(_normalize_character_name(character_name))
        if character_id:
            supabase.table("script_blocks").update({"character_id": character_id}).eq("id", block["id"]).execute()


@router.post("/extract-characters", response_model=ExtractScriptCharactersResponse)
async def extract_characters_from_existing_script(
    payload: ExtractScriptCharactersPayload,
) -> ExtractScriptCharactersResponse:
    """Build the script-derived character catalog from an already saved screenplay."""
    settings = get_settings()
    if not settings.replicate_api_token:
        raise HTTPException(status_code=500, detail="REPLICATE_API_TOKEN not configured")

    supabase = require_supabase_client()

    scenes = as_records(
        supabase.table("scenes").select("id, slugline_raw, title, sort_order").eq(
            "project_id", payload.project_id
        ).eq("is_leaf", True).order("sort_order").execute().data
    )
    blocks_by_scene: dict[str, list[dict]] = {}
    for block in as_records(
        supabase.table("script_blocks").select(
            "scene_id, block_type, content, character_name, parenthetical, sort_order"
        ).eq("project_id", payload.project_id).order("sort_order").execute().data
    ):
        scene_id = block.get("scene_id")
        if isinstance(scene_id, str):
            blocks_by_scene.setdefault(scene_id, []).append(block)

    screenplay_scenes: list[dict[str, Any]] = [
        {
            "slugline_raw": scene.get("slugline_raw") or scene.get("title") or "",
            "blocks": blocks_by_scene.get(str(scene["id"]), []),
        }
        for scene in scenes
    ]
    if not any(scene_payload["blocks"] for scene_payload in screenplay_scenes):
        raise HTTPException(status_code=400, detail="No script blocks were found for this project")
    screenplay: dict[str, Any] = {"scenes": screenplay_scenes}

    try:
        context = await asyncio.to_thread(load_project_script_context, payload.project_id)
        client = replicate.Client(api_token=settings.replicate_api_token)
        characters = await asyncio.to_thread(
            _extract_script_characters, client, screenplay, context.type_config.character_type_configs
        )
        await asyncio.to_thread(_persist_script_characters, supabase, payload.project_id, characters)
        return ExtractScriptCharactersResponse(count=len(characters))
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Character extraction failed: {error}") from error


@router.patch("/characters/profile", response_model=CharacterProfileResponse)
async def update_character_profile(payload: UpdateCharacterProfilePayload) -> CharacterProfileResponse:
    """Store explicit user choices separately from extracted screenplay facts."""
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")
    unknown = [field for field in payload.clear_fields if not is_override_field(field)]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown profile field: {', '.join(unknown)}")
    try:
        character = _load_script_character_for_profile(supabase, payload.project_id, payload.character_id)
        metadata = dict(character.get("metadata") or {})
        overrides = dict(metadata.get("manual_overrides") or {})
        for field in EDITABLE_CHARACTER_FIELDS:
            if field in payload.model_fields_set:
                value = getattr(payload, field)
                if field == "age":
                    if value is not None:
                        overrides[field] = value
                elif isinstance(value, str) and value.strip():
                    overrides[field] = value.strip()
        _apply_role_overrides(payload, character, overrides)
        for field in payload.clear_fields:
            overrides.pop(field, None)
        metadata["manual_overrides"] = overrides
        metadata["manual_override_fields"] = [field for field in overrides if is_override_field(field)]
        supabase.table("characters").update({"metadata": metadata}).eq(
            "id", payload.character_id
        ).eq("project_id", payload.project_id).execute()
        updated_character = _load_script_character_for_profile(supabase, payload.project_id, payload.character_id)
        return _character_profile_response(updated_character)
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Character profile update failed: {error}") from error


def _apply_role_overrides(payload: UpdateCharacterProfilePayload, character: dict, overrides: dict[str, Any]) -> None:
    """Character type, on-camera choice, voice and type details from the payload.

    A type equal to the script's, or an on-camera choice equal to the type's default, is
    stored as no override, so the character keeps following the script and its type.
    """
    fields_set = payload.model_fields_set
    if "character_type" in fields_set and payload.character_type:
        offered = load_project_script_context(payload.project_id).type_config
        if payload.character_type not in offered.character_types:
            raise HTTPException(
                status_code=400,
                detail=f"{payload.character_type!r} is not a character type for {offered.label} projects",
            )
        if payload.character_type == character.get("character_type"):
            overrides.pop("character_type", None)
        else:
            overrides["character_type"] = payload.character_type
    if "on_camera" in fields_set:
        if payload.on_camera is None:
            overrides.pop("on_camera", None)
        else:
            overrides["on_camera"] = payload.on_camera
            # A choice that matches the type's own presence is not an override.
            types = character_type_map()
            follows_type = {**character, "on_camera": None, "metadata": {"manual_overrides": {
                key: value for key, value in overrides.items() if key != "on_camera"
            }}}
            if is_on_camera(follows_type, types) == payload.on_camera:
                overrides.pop("on_camera", None)
    for prefix, values, valid in (
        (VOICE_PREFIX, payload.voice, lambda key: key in VOICE_FIELD_NAMES),
        (TYPE_DETAILS_PREFIX, payload.type_details, lambda key: bool(DETAIL_KEY_PATTERN.match(key))),
    ):
        for key, value in (values or {}).items():
            if not valid(key):
                raise HTTPException(status_code=400, detail=f"Unknown profile field: {prefix}{key}")
            if isinstance(value, str) and value.strip():
                overrides[f"{prefix}{key}"] = value.strip()[:PROFILE_TEXT_MAX_CHARS]
            else:
                overrides.pop(f"{prefix}{key}", None)


@router.get("/storyboard/models", response_model=list[StoryboardModelOption])
async def list_storyboard_models() -> list[StoryboardModelOption]:
    """WaveSpeed edit models available for storyboard frames, default first."""
    models = sorted(STORYBOARD_MODELS.values(), key=lambda model: model.id != DEFAULT_STORYBOARD_MODEL)
    return [
        StoryboardModelOption(
            id=model.id, label=model.label, family=model.family, max_images=model.max_images,
            verified=model.verified, page_url=model.page_url, notes=model.notes,
            is_default=model.id == DEFAULT_STORYBOARD_MODEL,
        )
        for model in models
    ]


@router.post("/storyboard", response_model=GenerateStoryboardResponse)
async def generate_storyboard(payload: GenerateStoryboardRequest) -> GenerateStoryboardResponse:
    """Generate durable storyboard stills for a screenplay scene using character views, environment, objects, and action lines."""
    try:
        return await asyncio.to_thread(
            generate_scene_storyboard,
            project_id=payload.project_id,
            scene_id=payload.scene_id,
            force_regenerate=payload.force_regenerate,
            provider=payload.provider,
            model=payload.model,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Storyboard generation failed: {error}") from error


@router.post("/storyboard/regenerate-shot", response_model=StoryboardFrame)
async def regenerate_shot(payload: RegenerateShotFrameRequest) -> StoryboardFrame:
    """Regenerate a single shot/frame image in a storyboard."""
    try:
        return await asyncio.to_thread(
            regenerate_single_shot_frame,
            project_id=payload.project_id,
            shot_id=payload.shot_id,
            prompt_override=payload.prompt_override,
            provider=payload.provider,
            model=payload.model,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Shot regeneration failed: {error}") from error


@router.post("/characters/script-sync/preview", response_model=CharacterScriptSyncPreviewResponse)
async def preview_character_script_sync(
    payload: PreviewCharacterScriptSyncPayload,
) -> CharacterScriptSyncPreviewResponse:
    """Preview one managed action line before the character's first appearance."""
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")
    try:
        character = _load_script_character_for_profile(supabase, payload.project_id, payload.character_id)
        if not _manual_override_fields(character.get("metadata")):
            raise ValueError("Save at least one manual character value before updating the script")
        _, scene, managed_block = _find_character_first_appearance(supabase, payload.project_id, character)
        return CharacterScriptSyncPreviewResponse(
            character_id=payload.character_id,
            scene_id=str(scene["id"]),
            scene_slugline=scene.get("slugline_raw"),
            content=_build_character_script_description(character),
            action="replace" if managed_block else "insert",
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Character script preview failed: {error}") from error


@router.post("/characters/script-sync/confirm", response_model=ConfirmCharacterScriptSyncResponse)
async def confirm_character_script_sync(
    payload: ConfirmCharacterScriptSyncPayload,
) -> ConfirmCharacterScriptSyncResponse:
    """Insert or replace the single script block owned by character-profile synchronization."""
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")
    try:
        character = _load_script_character_for_profile(supabase, payload.project_id, payload.character_id)
        expected_content = _build_character_script_description(character)
        if payload.content != expected_content:
            raise ValueError("The script update preview is outdated. Preview it again before confirming.")
        first_appearance, scene, managed_block = _find_character_first_appearance(supabase, payload.project_id, character)
        metadata = {
            "source": "character_profile_sync",
            "character_id": payload.character_id,
            "manual_override_fields": _manual_override_fields(character.get("metadata")),
        }
        if managed_block:
            script_block_id = str(managed_block["id"])
            supabase.table("script_blocks").update({"content": expected_content, "metadata": metadata}).eq(
                "id", script_block_id
            ).execute()
            action = "replace"
        else:
            scene_blocks = as_records(supabase.table("script_blocks").select("id, sort_order").eq(
                "scene_id", first_appearance["scene_id"]
            ).order("sort_order", desc=True).execute().data)
            insert_order = _as_int(first_appearance.get("sort_order"))
            for block in scene_blocks:
                if not block.get("id") or _as_int(block.get("sort_order")) < insert_order:
                    continue
                supabase.table("script_blocks").update(
                    {"sort_order": _as_int(block.get("sort_order")) + 1}
                ).eq("id", block["id"]).execute()
            script_block_id = str(uuid.uuid4())
            supabase.table("script_blocks").insert({
                "id": script_block_id,
                "project_id": payload.project_id,
                "scene_id": first_appearance["scene_id"],
                "block_type": "action",
                "content": expected_content,
                "sort_order": insert_order,
                "metadata": metadata,
            }).execute()
            action = "insert"
        return ConfirmCharacterScriptSyncResponse(
            character_id=payload.character_id,
            scene_id=str(scene["id"]),
            scene_slugline=scene.get("slugline_raw"),
            content=expected_content,
            action=action,
            script_block_id=script_block_id,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Character script update failed: {error}") from error


@router.post("/extract-environments", response_model=ExtractScriptEnvironmentsResponse)
async def extract_environments_from_existing_script(
    payload: ExtractScriptEnvironmentsPayload,
) -> ExtractScriptEnvironmentsResponse:
    """Build a source-backed environment catalog from saved scene headings."""
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")

    try:
        result = supabase.table("scenes").select(
            "id, slugline_raw, location_type, location, time_of_day, sort_order"
        ).eq("project_id", payload.project_id).eq("is_leaf", True).order("sort_order").execute()
        environments = _extract_script_environments(as_records(result.data))
        _persist_script_environments(supabase, payload.project_id, environments)
        return ExtractScriptEnvironmentsResponse(count=len(environments))
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Environment extraction failed: {error}") from error


@router.post("/extract-objects", response_model=ExtractScriptObjectsResponse)
async def extract_objects_from_existing_script(
    payload: ExtractScriptObjectsPayload,
) -> ExtractScriptObjectsResponse:
    """Extract explicit physical objects and merge them into the project catalog."""
    settings = get_settings()
    if not settings.replicate_api_token:
        raise HTTPException(status_code=500, detail="REPLICATE_API_TOKEN not configured")
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")
    try:
        scenes_result = supabase.table("scenes").select("id, slugline_raw, title, sort_order").eq(
            "project_id", payload.project_id
        ).eq("is_leaf", True).order("sort_order").execute()
        scenes = as_records(scenes_result.data)
        blocks_result = supabase.table("script_blocks").select(
            "scene_id, block_type, content, character_name, parenthetical, sort_order"
        ).eq("project_id", payload.project_id).order("sort_order").execute()
        blocks_by_scene: dict[str, list[dict]] = {}
        for block in as_records(blocks_result.data):
            scene_id = block.get("scene_id")
            if isinstance(scene_id, str):
                blocks_by_scene.setdefault(scene_id, []).append(block)
        screenplay = {
            "scenes": [
                {
                    "scene_index": index,
                    "slugline_raw": scene.get("slugline_raw") or scene.get("title") or "",
                    "blocks": blocks_by_scene.get(str(scene["id"]), []),
                }
                for index, scene in enumerate(scenes)
            ],
        }
        if not any(scene["blocks"] for scene in screenplay["scenes"]):
            raise HTTPException(status_code=400, detail="No screenplay blocks were found for this project")
        client = replicate.Client(api_token=settings.replicate_api_token)
        objects = await asyncio.to_thread(_extract_script_objects, client, screenplay)
        await asyncio.to_thread(_persist_script_objects, supabase, payload.project_id, objects, scenes)
        await asyncio.to_thread(rank_project_objects, payload.project_id)
        return ExtractScriptObjectsResponse(count=len(objects))
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Object extraction failed: {error}") from error


@router.get("/characters/ranking", response_model=list[CharacterRankingSchema])
async def rank_characters(project_id: str) -> list[CharacterRankingSchema]:
    """Characters ranked fresh from the current script, most important first."""
    try:
        rankings = await asyncio.to_thread(rank_characters_from_script, project_id)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to rank characters: {error}") from error
    ordered = sorted(rankings.items(), key=lambda item: item[1].rank)
    return [
        CharacterRankingSchema(
            character_id=character_id,
            **{key: value for key, value in asdict(ranking).items() if key != "scene_ids"},
        )
        for character_id, ranking in ordered
    ]


@router.get("/environments/ranking", response_model=list[EnvironmentRankingSchema])
async def rank_environments(project_id: str) -> list[EnvironmentRankingSchema]:
    """Environments ranked fresh from the current script, most important first."""
    try:
        rankings = await asyncio.to_thread(rank_environments_from_script, project_id)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to rank environments: {error}") from error
    ordered = sorted(rankings.items(), key=lambda item: item[1].rank)
    return [
        EnvironmentRankingSchema(
            environment_id=environment_id,
            **{key: value for key, value in asdict(ranking).items() if key != "scene_ids"},
        )
        for environment_id, ranking in ordered
    ]


def _reject_unknown_profile_fields(profile: dict | None, fields: tuple[str, ...]) -> None:
    unknown = sorted(key for key in (profile or {}) if key not in fields)
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown profile field: {', '.join(unknown)}")


def _primary_image_urls(supabase: Client, rows: list[dict]) -> dict[str, str]:
    asset_ids = [str(row["primary_asset_id"]) for row in rows if isinstance(row.get("primary_asset_id"), str)]
    if not asset_ids:
        return {}
    assets = as_records(supabase.table("assets").select("id, url").in_("id", asset_ids).execute().data)
    return {str(asset["id"]): str(asset["url"]) for asset in assets if isinstance(asset.get("url"), str)}


_ENVIRONMENT_COLUMNS = "id, name, description, tags, primary_asset_id, metadata"


@router.get("/environments", response_model=list[EnvironmentProfileResponse])
async def list_environments(project_id: str) -> list[EnvironmentProfileResponse]:
    """The project's script environments with their profile and main image, by name."""
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")
    try:
        rows = as_records(supabase.table("environments").select(_ENVIRONMENT_COLUMNS).eq("project_id", project_id).eq(
            "metadata->>source", "script"
        ).order("name").execute().data)
        urls = _primary_image_urls(supabase, rows)
        return [_environment_profile_response(row, urls.get(str(row.get("primary_asset_id")))) for row in rows]
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to load environments: {error}") from error


@router.patch("/environments/{environment_id}", response_model=EnvironmentProfileResponse)
async def update_environment(environment_id: str, payload: UpdateEnvironmentPayload) -> EnvironmentProfileResponse:
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")
    _reject_unknown_profile_fields(payload.profile, ENVIRONMENT_PROFILE_FIELDS)

    def load() -> dict | None:
        return maybe_single_record(supabase.table("environments").select(_ENVIRONMENT_COLUMNS).eq("id", environment_id).eq(
            "project_id", payload.project_id
        ).maybe_single().execute())

    try:
        loaded = load()
        if not loaded:
            raise ValueError("Environment was not found in this project")
        metadata = dict(loaded.get("metadata") or {})
        overrides = dict(metadata.get("manual_overrides") or {})
        values: dict[str, Any] = {}
        if "description" in payload.model_fields_set:
            description = " ".join((payload.description or "").strip().split()) or None
            values["description"] = description
            # A cleared description goes back to "From script" like a cleared profile field.
            if description:
                overrides["description"] = True
            else:
                overrides.pop("description", None)
        if "tags" in payload.model_fields_set:
            values["tags"] = _normalize_object_tags(payload.tags or [])
            overrides["tags"] = True
        metadata["manual_overrides"] = overrides
        if "profile" in payload.model_fields_set and payload.profile:
            metadata = apply_profile_changes(metadata, ENVIRONMENT_PROFILE_FIELDS, payload.profile)
        values["metadata"] = metadata
        supabase.table("environments").update(values).eq("id", environment_id).eq("project_id", payload.project_id).execute()
        updated = load()
        if not updated:
            raise ValueError("Environment was not found after updating")
        return _environment_profile_response(updated, _primary_image_urls(supabase, [updated]).get(str(updated.get("primary_asset_id"))))
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Environment update failed: {error}") from error


@router.get("/objects", response_model=list[ObjectProfileResponse])
async def list_objects(project_id: str) -> list[ObjectProfileResponse]:
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")
    try:
        result = supabase.table("props").select("id, name, description, tags, primary_asset_id, metadata").eq(
            "project_id", project_id
        ).order("name").execute()
        props = as_records(result.data)
        asset_ids = [str(prop["primary_asset_id"]) for prop in props if isinstance(prop.get("primary_asset_id"), str)]
        assets = (
            as_records(supabase.table("assets").select("id, url").in_("id", asset_ids).execute().data)
            if asset_ids
            else []
        )
        urls = {str(asset["id"]): str(asset["url"]) for asset in assets if isinstance(asset.get("url"), str)}
        # Ranked fresh from the current script on every load, most important object first.
        rankings = rank_objects_from_script(project_id, props)
        props.sort(key=lambda prop: (rankings[str(prop["id"])].rank if str(prop["id"]) in rankings else 10**6))
        return [
            _object_profile_response(
                prop,
                urls.get(str(prop.get("primary_asset_id"))) if isinstance(prop.get("primary_asset_id"), str) else None,
                rankings.get(str(prop["id"])),
            )
            for prop in props
        ]
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to load objects: {error}") from error


@router.post("/objects", response_model=ObjectProfileResponse, status_code=201)
async def create_object(payload: CreateObjectPayload) -> ObjectProfileResponse:
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")
    name = " ".join(payload.name.strip().split())
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    description = " ".join(payload.description.strip().split()) if payload.description else None
    tags = _normalize_object_tags(payload.tags)
    metadata = {"sources": ["manual"], "manual_overrides": {"name": True, "description": True, "tags": True}}
    try:
        created = as_records(supabase.table("props").insert({
            "project_id": payload.project_id, "name": name, "description": description, "tags": tags, "metadata": metadata,
        }).execute().data)
        if not created:
            raise RuntimeError("Object could not be created")
        return _object_profile_response(created[0])
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Object creation failed: {error}") from error


@router.patch("/objects/{object_id}", response_model=ObjectProfileResponse)
async def update_object(object_id: str, payload: UpdateObjectPayload) -> ObjectProfileResponse:
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")
    _reject_unknown_profile_fields(payload.profile, OBJECT_PROFILE_FIELDS)
    try:
        loaded = maybe_single_record(supabase.table("props").select("id, name, description, tags, metadata").eq("id", object_id).eq(
            "project_id", payload.project_id
        ).maybe_single().execute())
        if not loaded:
            raise ValueError("Object was not found in this project")
        metadata = dict(loaded.get("metadata") or {})
        overrides = dict(metadata.get("manual_overrides") or {})
        sources = {value for value in metadata.get("sources", []) if isinstance(value, str)}
        sources.add("manual")
        metadata["sources"] = sorted(sources)
        values: dict[str, Any] = {"metadata": metadata}
        if "name" in payload.model_fields_set:
            name = " ".join((payload.name or "").strip().split())
            if not name:
                raise ValueError("Name is required")
            values["name"] = name
            overrides["name"] = True
        if "description" in payload.model_fields_set:
            values["description"] = " ".join(payload.description.strip().split()) if payload.description else None
            overrides["description"] = True
        if "tags" in payload.model_fields_set:
            values["tags"] = _normalize_object_tags(payload.tags or [])
            overrides["tags"] = True
        metadata["manual_overrides"] = overrides
        if "profile" in payload.model_fields_set and payload.profile:
            metadata = apply_profile_changes(metadata, OBJECT_PROFILE_FIELDS, payload.profile)
            values["metadata"] = metadata
        supabase.table("props").update(values).eq("id", object_id).eq("project_id", payload.project_id).execute()
        updated = maybe_single_record(supabase.table("props").select("id, name, description, tags, metadata").eq("id", object_id).eq(
            "project_id", payload.project_id
        ).maybe_single().execute())
        if not updated:
            raise ValueError("Object was not found after updating")
        return _object_profile_response(updated)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Object update failed: {error}") from error


@router.delete("/objects/{object_id}", status_code=204)
async def delete_object(object_id: str, project_id: str) -> None:
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")
    try:
        existing = maybe_single_record(
            supabase.table("props").select("id").eq("id", object_id).eq("project_id", project_id).maybe_single().execute()
        )
        if not existing:
            raise ValueError("Object was not found in this project")
        supabase.table("props").delete().eq("id", object_id).eq("project_id", project_id).execute()
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Object deletion failed: {error}") from error

def _outline_runtime_line(duration: str, pacing: str = "") -> str:
    """Ask the outline to fit the runtime and pacing the user chose."""
    seconds = parse_duration_seconds(duration)
    guidance = PACING_GUIDANCE.get(normalize_pacing(pacing), "")
    if not seconds:
        return guidance
    return (
        f"The finished film must run about {format_seconds(seconds)}. Scale the number of scenes and "
        "story beats to that runtime, and note an approximate length (in minutes or seconds) beside each act."
        + (f"\n{guidance}" if guidance else "")
    )


@router.post("/generate-outline", response_model=GenerateOutlineResponse)
async def generate_outline(payload: MovieIdeaPayload) -> GenerateOutlineResponse:
    try:
        settings = get_settings()
        api_token = settings.replicate_api_token
        if not api_token:
            raise HTTPException(status_code=500, detail="REPLICATE_API_TOKEN not configured")

        characters_text = "\n".join(
            [
                f"- {character.name} ({character.role or 'Character'}): "
                f"Archetype={character.archetype or 'N/A'}, "
                f"Personality={character.personality or 'N/A'}, "
                f"Traits={', '.join(character.tags) if character.tags else 'N/A'}"
                for character in payload.characters
            ]
        ) or "- No characters supplied"

        prompt = f"""
You are an expert Hollywood screenwriter and story consultant. 
Generate a detailed movie outline based on the following project data:

Basics:
- Project Type: {payload.basics.projectType}
- Duration: {payload.basics.duration}
- Genres: {', '.join(payload.basics.genres) if payload.basics.genres else 'N/A'}
- Ending Type: {payload.basics.endingType}

Story:
- Logline: {payload.story.logline}
- Premise: {payload.story.premise}

Characters:
{characters_text}

Please structure the outline into:
1. Act I (Inciting Incident, Plot Point 1)
2. Act II (Rising Action, Midpoint, Lowest Point)
3. Act III (Climax, Resolution)

Return the output in clean Markdown format with professional sluglines.
{_outline_runtime_line(payload.basics.duration, payload.basics.pacing)}"""

        client = replicate.Client(api_token=api_token)

        outline_text = _run_gemini(client, prompt)

        return GenerateOutlineResponse(outline=outline_text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate-script", response_model=GenerateScriptResponse)
async def generate_script(payload: GenerateScriptPayload, background_tasks: BackgroundTasks) -> GenerateScriptResponse:
    try:
        settings = get_settings()
        api_token = settings.replicate_api_token
        if not api_token:
            raise HTTPException(status_code=500, detail="REPLICATE_API_TOKEN not configured")
            
        supabase = require_supabase_client()

        # Check if we already have scenes to generate.
        # Step 1: Draft the scene index/beatsheet outline dividing the whole story into a sequence of scenes
        characters_text = "\n".join(
            [f"- {c.name}: {c.archetype or c.role}" for c in payload.characters]
        ) if payload.characters else "- Elements inferred from the source material"

        outline_text = payload.outline.strip()

        brief = payload.brief
        brief_lines: list[str] = []
        if brief:
            if brief.concept.strip():
                brief_lines.append(f"- Concept: {brief.concept.strip()}")
            if brief.keyMoments:
                brief_lines.append(
                    "- Key moments:\n" + "\n".join(f"  * {m}" for m in brief.keyMoments if m.strip())
                )
            if brief.targetAudience.strip():
                brief_lines.append(f"- Target audience: {brief.targetAudience.strip()}")
            if brief.references.strip():
                brief_lines.append(f"- References: {brief.references.strip()}")
            if brief.duration.strip():
                brief_lines.append(f"- Duration: {brief.duration.strip()}")
            if brief.visualStyle.strip():
                brief_lines.append(f"- Visual style: {brief.visualStyle.strip()}")
        brief_text = "\n".join(brief_lines)

        # The project type (not the request) decides the structure: which unit types
        # the plan may use and which format the script is written in.
        context = await asyncio.to_thread(load_project_script_context, payload.project_id)
        type_config = context.type_config

        if outline_text and (type_config.requires_outline or not brief_text):
            source_label = "Here is the outline:"
            source_body = outline_text
        else:
            source_label = "Here is the creative brief:"
            source_body = brief_text or outline_text

        if not source_body:
            raise HTTPException(
                status_code=400,
                detail="Either an outline or a creative brief is required to generate a script.",
            )

        duration = (brief.duration.strip() if brief and brief.duration else "") or (
            payload.basics.duration if payload.basics else ""
        )
        pacing = payload.basics.pacing if payload.basics else ""
        if not duration or not pacing:
            # The film flow (Outline -> Generate Script) sends only the outline; use
            # the runtime and pacing saved on the project's idea form.
            saved = await asyncio.to_thread(load_project_runtime, supabase, payload.project_id)
            if not duration and saved.target_seconds:
                duration = f"{saved.target_seconds} sec"
            pacing = pacing or saved.pacing
        client = replicate.Client(api_token=api_token)
        # Plan, then make the scene count and lengths fit the runtime the user chose:
        # long runtimes are planned part by part; every plan is re-asked when it does
        # not fit, then overlong scenes are split.
        try:
            plan, runtime = await asyncio.to_thread(
                plan_script,
                lambda prompt: _run_gemini(client, prompt),
                type_config,
                context.format,
                source_label,
                source_body,
                characters_text,
                duration,
                pacing,
            )
        except PlanError as plan_error:
            raise HTTPException(status_code=500, detail=str(plan_error)) from plan_error
        print(f"Script plan runtime fit: {runtime}")

        # Replace any previous script for the project.
        supabase.table("scenes").delete().eq("project_id", payload.project_id).execute()
        supabase.table("project_documents").delete().eq("project_id", payload.project_id).eq("type", "script").execute()

        scenes_inserted: list[dict] = []
        sort_counter = 0

        def insert_units(units: list, parent: dict | None) -> None:
            nonlocal sort_counter
            for unit in units:
                row = {"project_id": payload.project_id, **unit.row(), "sort_order": sort_counter}
                sort_counter += 1
                if parent:
                    row["parent_id"] = parent["id"]
                inserted = as_records(supabase.table("scenes").insert(row).execute().data)
                if not inserted:
                    raise RuntimeError(f"Failed to save {unit.unit_type} '{unit.title}'")
                record = inserted[0]
                if unit.is_leaf:
                    record["parent_title"] = parent.get("title") if parent else None
                    scenes_inserted.append(record)
                else:
                    insert_units(unit.children, record)

        await asyncio.to_thread(insert_units, plan, None)

        basics_dict = payload.basics.dict() if payload.basics else {}

        # Launch the progressive backdrop generator
        background_tasks.add_task(
            progressive_generation_worker,
            payload.project_id,
            scenes_inserted,
            characters_text,
            basics_dict,
        )

        # Blocks are written in the background; the response lists the leaf units.
        response_scenes = [
            {
                "slugline_raw": s.get("slugline_raw") or s.get("title") or "",
                "unit_type": s.get("unit_type") or type_config.leaf_unit.key,
                "title": s.get("title"),
                "parent_title": s.get("parent_title"),
                "summary": s.get("summary"),
                "location_type": s.get("location_type"),
                "location": s.get("location"),
                "time_of_day": s.get("time_of_day"),
                "duration_seconds": s.get("duration_seconds"),
                "blocks": [],
            }
            for s in scenes_inserted
        ]
        return GenerateScriptResponse(
            project_type=type_config.key,
            script_format=context.format.key,
            scenes=response_scenes,
            target_seconds=runtime["target_seconds"],
            planned_seconds=runtime["planned_seconds"],
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in prepare script pipeline: {e}")
        raise HTTPException(status_code=500, detail=str(e))


from pydantic import BaseModel

class RewriteIncompletePayload(BaseModel):
    project_id: str

@router.post("/rewrite-incomplete")
async def rewrite_incomplete(payload: RewriteIncompletePayload, background_tasks: BackgroundTasks):
    try:
        supabase = require_supabase_client()
        
        # 1. Fetch the units that hold script content (scenes, sections, segments...)
        units = as_records(
            supabase.table("scenes").select("*").eq("project_id", payload.project_id).order("sort_order", desc=False).execute().data
        )
        titles_by_id = {u.get("id"): u.get("title") for u in units}
        all_scenes = [u for u in units if u.get("is_leaf", True)]
        for unit in all_scenes:
            unit["parent_title"] = titles_by_id.get(unit.get("parent_id"))

        if not all_scenes:
            raise HTTPException(status_code=400, detail="No scenes found for this project. Please generate the screenplay layout first.")

        # 2. Fetch script blocks to find which scene ids already have content
        blocks_data = as_records(
            supabase.table("script_blocks").select("scene_id").eq("project_id", payload.project_id).execute().data
        )
        completed_scene_ids = {b.get("scene_id") for b in blocks_data if b.get("scene_id")}

        # 3. Filter to find the incomplete scenes (or scenes with no blocks)
        incomplete_scenes: list[dict] = []
        for s in all_scenes:
            scene_id = s.get("id")
            if scene_id not in completed_scene_ids or s.get("status") in ["pending", "failed", "in_progress"]:
                # Clear any partial blocks for this scene
                try:
                    supabase.table("script_blocks").delete().eq("scene_id", scene_id).execute()
                except Exception as del_err:
                    print(f"Error purging blocks for scene {scene_id}: {del_err}")
                
                # Reset status to pending in database
                try:
                    supabase.table("scenes").update({"status": "pending"}).eq("id", scene_id).execute()
                except Exception as up_err:
                    print(f"Error resetting status for scene {scene_id}: {up_err}")
                
                s["status"] = "pending"
                incomplete_scenes.append(s)

        if not incomplete_scenes:
            return {"message": "All scenes are already generated and completed!", "rewritten_count": 0}

        # 4. Fetch characters to build the description text
        char_list = as_records(
            supabase.table("characters").select("*").eq("project_id", payload.project_id).execute().data
        )
        characters_text = "\n".join(
            [f"- {c.get('name')}: {c.get('role') or c.get('archetype', 'Character')}" for c in char_list]
        ) if char_list else "- Elements inferred from outline"

        # 5. The worker reads the project type and format itself.
        basics_dict: dict[str, Any] = {"genres": []}

        # 6. Launch the progressive backdrop generator
        background_tasks.add_task(
            progressive_generation_worker,
            payload.project_id,
            incomplete_scenes,
            characters_text,
            basics_dict
        )

        return {
            "message": f"Successfully launched background writing worker for {len(incomplete_scenes)} incomplete scenes.",
            "incomplete_scenes": [s.get("slugline_raw") or s.get("title") for s in incomplete_scenes],
            "rewritten_count": len(incomplete_scenes)
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in rewrite incomplete pipeline: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _insert_script_block(supabase: Client, row: dict[str, Any]) -> bool:
    """Insert one block; if only its metadata is rejected, keep the block without it."""
    try:
        supabase.table("script_blocks").insert(row).execute()
        return True
    except Exception as error:
        if row.get("metadata"):
            try:
                supabase.table("script_blocks").insert({**row, "metadata": {}}).execute()
                return True
            except Exception:
                pass
        print(f"Failed to insert script block ({row.get('block_type')}): {error}")
        return False


async def progressive_generation_worker(
    project_id: str,
    scenes: list,
    characters_text: str,
    basics_dict: dict
) -> None:
    """Write every leaf unit's blocks with the project type's block vocabulary."""
    consolidated_script: dict[str, Any] = {"scenes": []}
    supabase = None
    try:
        settings = get_settings()
        supabase = require_supabase_client()
        client = replicate.Client(api_token=settings.replicate_api_token)
        context = await asyncio.to_thread(load_project_script_context, project_id)
        type_config = context.type_config
        leaf_label = type_config.leaf_unit.label.lower()
        previous_context = f"This is the first {leaf_label}."

        for scene in scenes:
            scene_id = scene.get("id")
            try:
                supabase.table("scenes").update({"status": "in_progress"}).eq("id", scene_id).execute()
            except Exception as update_err:
                print(f"Error updating unit status to in_progress: {update_err}")

            prompt = build_block_prompt(
                type_config,
                context.format,
                scene,
                characters_text,
                previous_context,
                genres=basics_dict.get("genres") or [],
            )
            status = "complete"
            rows = []
            try:
                reply = await asyncio.to_thread(_run_gemini, client, prompt)
                rows = normalize_blocks(parse_model_json(reply), type_config)
            except Exception as gen_err:
                print(f"Block generation failed for unit {scene_id}: {gen_err}")
            if not rows:
                status = "failed"

            saved = 0
            for idx, row in enumerate(rows):
                if await asyncio.to_thread(_insert_script_block, supabase, {
                    "project_id": project_id,
                    "scene_id": scene_id,
                    "sort_order": idx,
                    **row.row(),
                }):
                    saved += 1
            if rows and not saved:
                status = "failed"

            try:
                supabase.table("scenes").update({"status": status}).eq("id", scene_id).execute()
            except Exception as status_err:
                print(f"Error updating unit status to {status}: {status_err}")

            consolidated_script["scenes"].append({
                "slugline_raw": scene.get("slugline_raw") or scene.get("title") or "",
                "blocks": [row.row() for row in rows],
            })
            previous_context = blocks_context(rows) or f"End of {leaf_label}: {scene.get('title') or scene.get('slugline_raw') or ''}"

            # Small pause to stay under Replicate rate limits.
            await asyncio.sleep(2)

        try:
            extracted_characters = await asyncio.to_thread(
                _extract_script_characters, client, consolidated_script, type_config.character_type_configs
            )
            await asyncio.to_thread(_persist_script_characters, supabase, project_id, extracted_characters)
        except Exception as extraction_error:
            print(f"Character extraction failed: {extraction_error}")

    except Exception as worker_err:
        print(f"Background worker failed: {worker_err}")

    # Store the compiled script (screenplay, two-column, treatment or instructional)
    # as the project's script document, whatever happened above.
    try:
        compiled = await asyncio.to_thread(compile_project_script, project_id)
        await asyncio.to_thread(save_compiled_script, compiled)
    except Exception as save_err:
        print(f"Failed to save compiled script document: {save_err}")
