import concurrent.futures
import os
import random
from datetime import UTC, datetime
from typing import Any

from core.supabase_client import get_supabase_client
from schemas.image_generation import CharacterKeyframe, CharacterView, CreateImageRequest
from services.character_views import (
    CHARACTER_VIEW_SPECS,
    attach_generation_to_character,
    build_character_view_prompt,
    build_script_character_profile,
    persist_character_generation,
)
from services.environment_text_to_image import (
    build_script_environment_prompt,
    load_script_environment,
    persist_environment_generation,
)
from services.image_generation_service import generate_provider_images
from services.object_text_to_image import build_object_prompt, load_object, persist_object_generation
from services.visual_style import (
    VisualStyle,
    find_character_scene_ids,
    find_style_dependent_assets,
    resolve_visual_style,
)


def _load_character(project_id: str, character_id: str) -> dict[str, Any]:
    supabase = get_supabase_client()
    if not supabase:
        raise RuntimeError("Supabase client not initialized")
    result = supabase.table("characters").select("*").eq("id", character_id).eq(
        "project_id", project_id
    ).maybe_single().execute()
    character = result.data
    if not character:
        raise ValueError("Character was not found in this project")
    return character


def _character_has_views(project_id: str, character: dict[str, Any]) -> bool:
    if character.get("primary_asset_id"):
        return True
    supabase = get_supabase_client()
    if not supabase:
        raise RuntimeError("Supabase client not initialized")
    links = supabase.table("asset_links").select("id").eq("project_id", project_id).eq(
        "target_type", "character"
    ).eq("target_id", character["id"]).eq("role", "keyframe").limit(1).execute()
    return bool(links.data)


def _update_propagation(
    project_id: str,
    character_id: str,
    state: dict[str, Any],
) -> None:
    supabase = get_supabase_client()
    if not supabase:
        return
    result = supabase.table("characters").select("metadata").eq("id", character_id).eq(
        "project_id", project_id
    ).maybe_single().execute()
    row = result.data or {}
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    metadata = dict(metadata)
    metadata["style_propagation"] = state
    supabase.table("characters").update({"metadata": metadata}).eq("id", character_id).eq(
        "project_id", project_id
    ).execute()


def _regenerate_character_views(
    project_id: str,
    character: dict[str, Any],
    style: VisualStyle,
    model: str,
    provider: str,
) -> None:
    character_id = str(character["id"])
    profile = build_script_character_profile(character, style)
    seed = random.SystemRandom().randint(0, 2_147_483_647)
    payload = CreateImageRequest(
        model=model,
        provider=provider,
        prompt=profile,
        aspect_ratio="2:3",
        num_images=1,
        resolution="1k",
        output_format="jpg",
        project_id=project_id,
        seed=seed,
        visual_style=style.label,
    )

    def generate_view(spec: tuple[CharacterView, str, str]) -> CharacterKeyframe:
        view, _, _ = spec
        prompt = build_character_view_prompt(profile, view)
        response = generate_provider_images(payload.model_copy(update={"prompt": prompt}))
        if not response.images:
            raise RuntimeError(f"No image returned for {view.value}")
        return CharacterKeyframe(
            view=view,
            image_url=response.images[0],
            prompt=prompt,
            seed=seed,
            model=model,
        )

    concurrency_limit = max(1, int(os.getenv("CHARACTER_GENERATION_CONCURRENCY", "3")))
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency_limit) as executor:
        keyframes = list(executor.map(generate_view, CHARACTER_VIEW_SPECS))

    generation_job_id, persisted_keyframes = persist_character_generation(
        project_id,
        payload,
        keyframes,
    )
    attach_generation_to_character(
        project_id,
        character_id,
        generation_job_id,
        persisted_keyframes,
        visual_style=style.label,
    )


def _regenerate_environment(
    project_id: str,
    environment_id: str,
    style: VisualStyle,
    model: str,
    provider: str,
) -> None:
    environment = load_script_environment(project_id, environment_id)
    prompt = build_script_environment_prompt(environment, style)
    seed = random.SystemRandom().randint(0, 2_147_483_647)
    payload = CreateImageRequest(
        model=model,
        provider=provider,
        prompt=prompt,
        aspect_ratio="16:9",
        num_images=1,
        resolution="1k",
        output_format="jpg",
        project_id=project_id,
        seed=seed,
        visual_style=style.label,
    )
    response = generate_provider_images(payload)
    if not response.images:
        raise RuntimeError("No image returned for environment")
    persist_environment_generation(project_id, environment_id, payload, response.images[0])


def _regenerate_object(
    project_id: str,
    object_id: str,
    style: VisualStyle,
    model: str,
    provider: str,
) -> None:
    prop = load_object(project_id, object_id)
    prompt = build_object_prompt(prop, style)
    seed = random.SystemRandom().randint(0, 2_147_483_647)
    payload = CreateImageRequest(
        model=model,
        provider=provider,
        prompt=prompt,
        aspect_ratio="1:1",
        num_images=1,
        resolution="1k",
        output_format="jpg",
        project_id=project_id,
        seed=seed,
        visual_style=style.label,
    )
    response = generate_provider_images(payload)
    if not response.images:
        raise RuntimeError("No image returned for object")
    persist_object_generation(project_id, object_id, payload, response.images[0])


def character_style_impact(
    project_id: str,
    character_id: str,
) -> dict[str, Any]:
    """Describe the existing assets affected by a character style change."""
    character = _load_character(project_id, character_id)
    scene_ids = find_character_scene_ids(project_id, character)
    environment_ids, object_ids = find_style_dependent_assets(project_id, scene_ids)
    return {
        "character": character,
        "scene_ids": scene_ids,
        "environment_ids": environment_ids,
        "object_ids": object_ids,
        "has_character_views": _character_has_views(project_id, character),
    }


def propagate_character_style(
    project_id: str,
    character_id: str,
    visual_style: object,
    model: str = "nanobanana",
    provider: str = "replicate",
) -> None:
    """Regenerate every existing visual asset affected by a character style change."""
    style = resolve_visual_style(visual_style)
    character = _load_character(project_id, character_id)
    scene_ids = find_character_scene_ids(project_id, character)
    environment_ids, object_ids = find_style_dependent_assets(project_id, scene_ids)
    has_character_views = _character_has_views(project_id, character)
    total = int(has_character_views) + len(environment_ids) + len(object_ids)
    completed = 0
    errors: list[str] = []
    started_at = datetime.now(UTC).isoformat()

    def state(status: str, finished: bool = False) -> dict[str, Any]:
        return {
            "status": status,
            "visual_style": style.label,
            "affected_character_views": has_character_views,
            "affected_environment_ids": environment_ids,
            "affected_object_ids": object_ids,
            "completed": completed,
            "total": total,
            "errors": errors[-5:],
            "started_at": started_at,
            "finished_at": datetime.now(UTC).isoformat() if finished else None,
        }

    _update_propagation(project_id, character_id, state("running"))
    try:
        if has_character_views:
            try:
                _regenerate_character_views(project_id, character, style, model, provider)
                completed += 1
            except Exception as error:
                errors.append(f"Character views: {error}")
            _update_propagation(project_id, character_id, state("running"))

        for environment_id in environment_ids:
            try:
                _regenerate_environment(project_id, environment_id, style, model, provider)
                completed += 1
            except Exception as error:
                errors.append(f"Environment {environment_id}: {error}")
            _update_propagation(project_id, character_id, state("running"))

        for object_id in object_ids:
            try:
                _regenerate_object(project_id, object_id, style, model, provider)
                completed += 1
            except Exception as error:
                errors.append(f"Object {object_id}: {error}")
            _update_propagation(project_id, character_id, state("running"))

        final_status = "error" if errors else "complete"
        _update_propagation(project_id, character_id, state(final_status, finished=True))
    except Exception as error:
        errors.append(str(error))
        _update_propagation(project_id, character_id, state("error", finished=True))
