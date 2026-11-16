import json
import replicate
import uuid
from fastapi import APIRouter, HTTPException, BackgroundTasks
import asyncio

from supabase import Client
from typing import Any

from core.supabase_client import get_supabase_client, require_supabase_client
from core.supabase_records import as_records, maybe_single_record
from core.config import get_settings
from schemas.script import (
    CharacterProfileResponse,
    CharacterScriptSyncPreviewResponse,
    ConfirmCharacterScriptSyncPayload,
    ConfirmCharacterScriptSyncResponse,
    CreateObjectPayload,
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
    UpdateObjectPayload,
    UpdateCharacterProfilePayload,
)
from schemas.image_generation import (
    GenerateStoryboardRequest,
    GenerateStoryboardResponse,
    RegenerateShotFrameRequest,
    StoryboardFrame,
)
from services.storyboard_generation import generate_scene_storyboard, regenerate_single_shot_frame
from services.character_views import EDITABLE_CHARACTER_FIELDS, effective_character_profile

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

    Gemini 3.x streams its answer (output schema is `string[]`), so the client
    returns either a plain string or an iterator of chunks that must be joined.
    """
    settings = get_settings()
    output = client.run(
        settings.gemini_model,
        input=_gemini_input(
            prompt,
            system_instruction=system_instruction,
            thinking_level=thinking_level,
            temperature=temperature,
        ),
    )
    return output if isinstance(output, str) else "".join(output)


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


def _character_profile_response(character: dict) -> CharacterProfileResponse:
    effective = effective_character_profile(character)
    return CharacterProfileResponse(
        id=str(character["id"]),
        name=str(character["name"]),
        role=effective.get("role") if isinstance(effective.get("role"), str) else None,
        age=effective.get("age") if isinstance(effective.get("age"), int) else None,
        gender=effective.get("gender") if isinstance(effective.get("gender"), str) else None,
        race=effective.get("race") if isinstance(effective.get("race"), str) else None,
        appearance=effective.get("appearance") if isinstance(effective.get("appearance"), str) else None,
        personality=effective.get("personality") if isinstance(effective.get("personality"), str) else None,
        manual_override_fields=_manual_override_fields(character.get("metadata")),
    )


def _build_character_script_description(character: dict) -> str:
    effective = effective_character_profile(character)
    details: list[str] = []
    age = effective.get("age")
    if isinstance(age, int) and not isinstance(age, bool):
        details.append(f"{age} years old")
    for field in ("gender", "race", "role"):
        value = effective.get(field)
        if isinstance(value, str) and value.strip():
            details.append(value.strip())
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
        "id, name, role, age, gender, race, appearance, personality, metadata"
    ).eq("id", character_id).eq("project_id", project_id).maybe_single().execute()
    character = maybe_single_record(result)
    metadata = (character or {}).get("metadata") or {}
    if not character or not isinstance(metadata, dict) or metadata.get("source") != "script":
        raise ValueError("Script-derived character was not found in this project")
    return character


def _find_character_first_appearance(supabase: Client, project_id: str, character: dict) -> tuple[dict, dict, dict | None]:
    scenes_result = supabase.table("scenes").select("id, slugline_raw, sort_order").eq(
        "project_id", project_id
    ).order("sort_order").execute()
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


def _object_profile_response(prop: dict, primary_image_url: str | None = None) -> ObjectProfileResponse:
    metadata = prop.get("metadata") if isinstance(prop.get("metadata"), dict) else {}
    sources = metadata.get("sources") if isinstance(metadata.get("sources"), list) else []
    overrides = metadata.get("manual_overrides") if isinstance(metadata.get("manual_overrides"), dict) else {}
    return ObjectProfileResponse(
        id=str(prop["id"]),
        name=str(prop["name"]),
        description=prop.get("description") if isinstance(prop.get("description"), str) else None,
        tags=[value for value in (prop.get("tags") or []) if isinstance(value, str)],
        sources=[value for value in sources if isinstance(value, str)],
        manual_override_fields=[field for field in ("name", "description", "tags") if field in overrides],
        source_scene_ids=[value for value in metadata.get("source_scene_ids", []) if isinstance(value, str)],
        source_sluglines=[value for value in metadata.get("source_sluglines", []) if isinstance(value, str)],
        primary_image_url=primary_image_url,
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
    existing_result = supabase.table("environments").select("id, metadata").eq("project_id", project_id).execute()
    existing_by_key = {
        metadata.get("script_key"): environment
        for environment in as_records(existing_result.data)
        if isinstance((metadata := environment.get("metadata")), dict)
        and metadata.get("source") == "script"
        and isinstance(metadata.get("script_key"), str)
    }

    for environment in environments:
        script_key = _normalize_environment_name(environment["name"])
        metadata = {
            "source": "script",
            "script_key": script_key,
            "source_scene_ids": environment["source_scene_ids"],
            "source_sluglines": environment["source_sluglines"],
            "location_types": environment["location_types"],
            "time_of_day_values": environment["time_of_day_values"],
            "scene_count": len(environment["source_scene_ids"]),
            "extraction_version": 1,
        }
        values = {"name": environment["name"], "description": None, "tags": [], "metadata": metadata}
        existing = existing_by_key.get(script_key)
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


def _normalize_extracted_character(raw_character: dict) -> dict:
    normalized = dict(raw_character)
    age = normalized.get("age")
    if isinstance(age, str):
        age = age.strip()
        normalized["age"] = int(age) if age.isdigit() else None
    elif isinstance(age, bool) or not isinstance(age, int):
        normalized["age"] = None
    if normalized.get("character_type") not in {"main", "supporting"}:
        normalized["character_type"] = "supporting"
    return normalized


def _extract_script_characters(client: replicate.Client, screenplay: dict) -> list[ExtractedCharacterSchema]:
    prompt = f"""You extract only explicitly supported character facts from a screenplay.

Screenplay JSON:
{json.dumps(screenplay)}

Return ONLY valid JSON in this shape:
{{"characters":[{{"name":"", "character_type":"main" | "supporting", "role":null, "age":null, "gender":null, "race":null, "appearance":null, "personality":null, "tags":[], "image_prompt":""}}]}}

Include every named speaking or explicitly named character. Set `character_type` to `main` only for characters central to the screenplay's main plot; set it to `supporting` for all other named characters. Do not infer, guess, or stereotype age, gender, race, visual traits, role, or personality. `age` must be an exact whole number or null; do not use ranges or labels such as "40s". Use null when the screenplay does not explicitly establish a fact. `image_prompt` must be a concise visual description composed only from explicit screenplay facts; use an empty string when no visual facts are present."""
    parsed = _parse_json_object(_run_gemini(client, prompt, thinking_level="low"))
    raw_characters = parsed.get("characters", []) if isinstance(parsed, dict) else parsed
    if not isinstance(raw_characters, list):
        raise ValueError("Character extractor response is missing characters")

    extracted: list[ExtractedCharacterSchema] = []
    seen_names: set[str] = set()
    for raw_character in raw_characters:
        if not isinstance(raw_character, dict):
            continue
        character = ExtractedCharacterSchema.model_validate(_normalize_extracted_character(raw_character))
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
        supabase.table("scenes").select("id, slugline_raw, sort_order").eq(
            "project_id", payload.project_id
        ).order("sort_order").execute().data
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
            "slugline_raw": scene.get("slugline_raw", ""),
            "blocks": blocks_by_scene.get(str(scene["id"]), []),
        }
        for scene in scenes
    ]
    if not any(scene_payload["blocks"] for scene_payload in screenplay_scenes):
        raise HTTPException(status_code=400, detail="No screenplay blocks were found for this project")
    screenplay: dict[str, Any] = {"scenes": screenplay_scenes}

    try:
        client = replicate.Client(api_token=settings.replicate_api_token)
        characters = await asyncio.to_thread(_extract_script_characters, client, screenplay)
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
            if field in payload.clear_fields:
                overrides.pop(field, None)
        metadata["manual_overrides"] = overrides
        metadata["manual_override_fields"] = [field for field in EDITABLE_CHARACTER_FIELDS if field in overrides]
        supabase.table("characters").update({"metadata": metadata}).eq(
            "id", payload.character_id
        ).eq("project_id", payload.project_id).execute()
        updated_character = _load_script_character_for_profile(supabase, payload.project_id, payload.character_id)
        return _character_profile_response(updated_character)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Character profile update failed: {error}") from error


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
        ).eq("project_id", payload.project_id).order("sort_order").execute()
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
        scenes_result = supabase.table("scenes").select("id, slugline_raw, sort_order").eq(
            "project_id", payload.project_id
        ).order("sort_order").execute()
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
                    "slugline_raw": scene.get("slugline_raw", ""),
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
        return ExtractScriptObjectsResponse(count=len(objects))
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Object extraction failed: {error}") from error


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
        return [
            _object_profile_response(
                prop,
                urls.get(str(prop.get("primary_asset_id"))) if isinstance(prop.get("primary_asset_id"), str) else None,
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
"""

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

        video_type = (payload.video_type or "").strip() or None
        outline_text = payload.outline.strip()
        narrative_types = {"feature_film", "short_film"}

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
        brief_text = "\n".join(brief_lines)

        # Feature/short films keep a three-act narrative structure; music videos,
        # documentaries and adverts get a visual beat plan built from the brief.
        # Legacy callers that only send an outline stay on the narrative track.
        is_narrative = (video_type in narrative_types) or (
            video_type is None and bool(outline_text) and not brief_text
        )

        if is_narrative:
            structure_note = (
                "Break the outline down into an ordered sequence of screenplay scenes "
                "following a three-act narrative structure."
            )
        else:
            structure_note = (
                "This is a NON-NARRATIVE production (music video / documentary / advertisement). "
                "Do NOT force a three-act story structure or fictional characters. Sequence the "
                "scenes as a visual beat plan that realises the brief: a strong hook, the listed key "
                "moments in order, and a memorable closing beat, matching the requested duration."
            )

        if outline_text:
            source_label = "Here is the screenplay outline:"
            source_body = outline_text
        else:
            source_label = "Here is the creative brief:"
            source_body = brief_text

        if not source_body:
            raise HTTPException(
                status_code=400,
                detail="Either an outline or a creative brief is required to generate a script.",
            )

        plan_prompt = f"""
You are an expert Hollywood screenwriter and story planner.
Analyze the provided source material and break it down into a sequence of structured screenplay scenes.
Do not write the screenplay content yet. Just outline and define the sequence of scenes.

{structure_note}

{source_label}
{source_body}

Characters:
{characters_text}

Output ONLY valid JSON matching this schema:
{{
  "scenes": [
    {{
      "slugline_raw": "INT. OR EXT. LOCATION - TIME",
      "location_type": "INT." or "EXT." or "INT./EXT.",
      "location": "LOCATION",
      "time_of_day": "TIME",
      "summary": "Detailed but brief prompt/summary of what happens in this scene, character actions, narrative context, and what dialogue goals must be met."
    }}
  ]
}}

Format rules:
- Extract all scenes from the source material. Provide the list of scenes.
- Ensure strict JSON formatting. No markdown code blocks around the response, just the raw JSON object.
"""

        client = replicate.Client(api_token=api_token)

        # Gemini streams its answer (string[] output), _run_gemini joins it for us.
        beats_text = _run_gemini(client, plan_prompt)
        
        # Clean up possible markdown wrappers from LLM response
        cleaned_beats = beats_text.strip()
        if cleaned_beats.startswith("```"):
            lines = cleaned_beats.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned_beats = "\n".join(lines).strip()
            
        try:
            parsed_beats = json.loads(cleaned_beats)
        except json.JSONDecodeError as je:
            print(f"Failed to parse beats JSON directly. Attempting custom cleaning.")
            start_obj = cleaned_beats.find('{')
            end_obj = cleaned_beats.rfind('}')
            start_arr = cleaned_beats.find('[')
            end_arr = cleaned_beats.rfind(']')
            
            start_idx = -1
            end_idx = -1
            if start_obj != -1 and (start_arr == -1 or start_obj < start_arr):
                start_idx = start_obj
                end_idx = end_obj
            elif start_arr != -1:
                start_idx = start_arr
                end_idx = end_arr
                
            if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                try:
                    parsed_beats = json.loads(cleaned_beats[start_idx:end_idx+1])
                except Exception:
                    raise HTTPException(status_code=500, detail=f"Invalid layout JSON returned by LLM: {je}")
            else:
                raise HTTPException(status_code=500, detail=f"Invalid layout JSON returned by LLM: {je}")

        if isinstance(parsed_beats, list):
            beats_list = parsed_beats
        elif isinstance(parsed_beats, dict):
            beats_list = parsed_beats.get("scenes", [])
        else:
            beats_list = []

        scenes_inserted: list[dict] = []
        scene_order = 0
        
        # Clean up existing scenes and blocks for the project first
        try:
            supabase.table("scenes").delete().eq("project_id", payload.project_id).execute()
            supabase.table("project_documents").delete().eq("project_id", payload.project_id).eq("type", "script").execute()
        except Exception as delete_err:
            print(f"Error purging old screenplay objects: {delete_err}")

        # Insert scenes as pending placeholders
        for idx, scene in enumerate(beats_list):
            try:
                scene_res = supabase.table("scenes").insert({
                    "project_id": payload.project_id,
                    "slugline_raw": scene.get("slugline_raw", ""),
                    "location_type": scene.get("location_type", "INT."),
                    "location": scene.get("location", ""),
                    "time_of_day": scene.get("time_of_day", "DAY"),
                    "summary": scene.get("summary", ""),
                    "status": "pending",
                    "sort_order": idx
                }).execute()
                
                if scene_res and scene_res.data:
                    inserted_scenes = as_records(scene_res.data)
                    if inserted_scenes:
                        scenes_inserted.append(inserted_scenes[0])
            except Exception as scene_err:
                print(f"Failed to insert placeholder scene {idx}: {scene_err}")

        # Launch the progressive backdrop generator
        background_tasks.add_task(
            progressive_generation_worker,
            payload.project_id,
            scenes_inserted,
            characters_text,
            payload.basics.dict() if payload.basics else {}
        )

        # To maintain compatibility with matching GenerateScriptResponse (which expects scenes and blocks),
        # we can structure a response that tells the front-end that progressive processing is occurring,
        # or we return the scenes without blocks initially.
        response_scenes = []
        for s in scenes_inserted:
            response_scenes.append({
                "slugline_raw": s.get("slugline_raw", ""),
                "location_type": s.get("location_type"),
                "location": s.get("location"),
                "time_of_day": s.get("time_of_day"),
                "blocks": []
            })
            
        return GenerateScriptResponse(scenes=response_scenes)

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
        
        # 1. Fetch all scenes for the project
        all_scenes = as_records(
            supabase.table("scenes").select("*").eq("project_id", payload.project_id).order("sort_order", desc=False).execute().data
        )
        
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

        # 5. Fetch project detail to supply basic configuration
        proj_data = as_records(
            supabase.table("projects").select("*").eq("id", payload.project_id).execute().data
        )
        basics_dict = {
            "projectType": (proj_data[0].get("description") if proj_data else None) or "Feature Film",
            "genres": [],
        }

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
            "incomplete_scenes": [s.get("slugline_raw") for s in incomplete_scenes],
            "rewritten_count": len(incomplete_scenes)
        }

    except Exception as e:
        print(f"Error in rewrite incomplete pipeline: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def progressive_generation_worker(
    project_id: str,
    scenes: list,
    characters_text: str,
    basics_dict: dict
) -> None:
    # Assigned before the try block so the error handler below can still persist
    # whatever was generated when a scene fails mid-way.
    consolidated_screenplay: dict[str, Any] = {"scenes": []}
    try:
        settings = get_settings()
        api_token = settings.replicate_api_token
        supabase = require_supabase_client()
        client = replicate.Client(api_token=api_token)

        previous_scene_context = "This is the first scene of the screenplay."

        for i, scene in enumerate(scenes):
            scene_id = scene.get("id")
            slugline = scene.get("slugline_raw", "")
            summary = scene.get("summary", "")

            # Set status to in_progress
            try:
                supabase.table("scenes").update({"status": "in_progress"}).eq("id", scene_id).execute()
            except Exception as update_err:
                print(f"Error updating scene status to in_progress: {update_err}")

            draft_prompt = f"""
You are an expert Hollywood screenwriter and script formatter.
You are writing a formatted scene for a screenplay. Do not write the entire movie script, only generate formatting for this single active scene.

Here is the details of the scene you are writing:
Slugline: {slugline}
Beat description: {summary}

---
Global Movie Metadata:
Type: {basics_dict.get("projectType", "Feature Film")}
Genres: {", ".join(basics_dict.get("genres", []))}

Characters:
{characters_text}

---
Important Context - END OF PREVIOUS SCENE:
{previous_scene_context}
---

Write out the standard Action, Dialogue, and Character blocks for this scene.

Output ONLY valid JSON matching this schema for the blocks:
{{
  "blocks": [
    {{
      "block_type": "scene_heading" | "action" | "character" | "parenthetical" | "dialogue" | "transition",
      "content": "Text content of the block. If character, just the name. If dialogue, just the words.",
      "character_name": "Used only if block is dialogue or parenthetical",
      "parenthetical": "Used only if block is dialogue and there is a parenthetical"
    }}
  ]
}}

Format rules:
- Ensure strict JSON formatting. No markdown code blocks around the response, just the raw JSON object.
"""

            blocks_text = _run_gemini(client, draft_prompt)
            
            cleaned_blocks = blocks_text.strip()
            if cleaned_blocks.startswith("```"):
                lines = cleaned_blocks.splitlines()
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]
                cleaned_blocks = "\n".join(lines).strip()
                
            try:
                parsed_blocks = json.loads(cleaned_blocks)
            except json.JSONDecodeError:
                start_obj = cleaned_blocks.find('{')
                end_obj = cleaned_blocks.rfind('}')
                start_arr = cleaned_blocks.find('[')
                end_arr = cleaned_blocks.rfind(']')
                
                start_idx = -1
                end_idx = -1
                if start_obj != -1 and (start_arr == -1 or start_obj < start_arr):
                    start_idx = start_obj
                    end_idx = end_obj
                elif start_arr != -1:
                    start_idx = start_arr
                    end_idx = end_arr
                    
                if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                    try:
                        parsed_blocks = json.loads(cleaned_blocks[start_idx:end_idx+1])
                    except Exception:
                        parsed_blocks = []
                else:
                    parsed_blocks = []

            if isinstance(parsed_blocks, list):
                blocks = parsed_blocks
            elif isinstance(parsed_blocks, dict):
                blocks = parsed_blocks.get("blocks", [])
            else:
                blocks = []
            
            # Save the blocks
            for idx, block in enumerate(blocks):
                try:
                    block_type = block.get("block_type", "action")
                    if block_type not in ["scene_heading", "action", "dialogue", "transition", "shot", "title", "montage"]:
                        if block_type in ["character", "parenthetical"]:
                            block_type = "dialogue"
                        else:
                            block_type = "action"

                    supabase.table("script_blocks").insert({
                        "project_id": project_id,
                        "scene_id": scene_id,
                        "block_type": block_type,
                        "content": block.get("content", ""),
                        "character_name": block.get("character_name"),
                        "parenthetical": block.get("parenthetical"),
                        "sort_order": idx
                    }).execute()
                except Exception as b_err:
                    print(f"Failed to insert background script block: {b_err}")
            
            # Mark scene as complete
            try:
                supabase.table("scenes").update({"status": "complete"}).eq("id", scene_id).execute()
            except Exception as e:
                pass
            
            # Store in unified object
            scene_copy = dict(scene)
            scene_copy["blocks"] = blocks
            consolidated_screenplay["scenes"].append(scene_copy)
            
            # Extract last 10 lines to pass as context to the next scene so dialogue/plot flows smoothly.
            if blocks and len(blocks) > 0:
                last_blocks = blocks[-10:] if len(blocks) > 10 else blocks
                previous_scene_context = "\n".join(
                    [f"[{b.get('block_type', '').upper()}] {b.get('character_name', '')}: {b.get('content', '')}" if b.get('block_type') == 'dialogue' else f"[{b.get('block_type', '').upper()}] {b.get('content', '')}" for b in last_blocks]
                )
            else:
                previous_scene_context = f"End of scene: {slugline}"
            
            # Add small sleep to prevent replicate API rate limit violations.
            await asyncio.sleep(2)

        try:
            extracted_characters = _extract_script_characters(client, consolidated_screenplay)
            _persist_script_characters(supabase, project_id, extracted_characters)
        except Exception as extraction_error:
            print(f"Character extraction failed: {extraction_error}")
            
        # Optional: Render out the full json string and save to project_documents.
        try:
            full_script_str = json.dumps(consolidated_screenplay)
            supabase.table("project_documents").insert({
                "project_id": project_id,
                "type": "script",
                "title": "Generated Script",
                "content": full_script_str,
                "metadata": {"source": f"{get_settings().gemini_model}-progressive"}
            }).execute()
        except:
            pass
            
    except Exception as worker_err:
        print(f"Background worker failed: {worker_err}")

        # Finally, save consolidated full file to project_documents
        try:
            fallback_client = get_supabase_client()
            if fallback_client is not None:
                fallback_client.table("project_documents").insert({
                    "project_id": project_id,
                    "type": "script",
                    "title": "Generated Screenplay",
                    "content": json.dumps(consolidated_screenplay),
                    "metadata": {"source": f"{get_settings().gemini_model}-progressive"}
                }).execute()
        except Exception as block_save_err:
            print(f"Failed consolidating complete screenplay: {block_save_err}")
