import asyncio
import os
import random

from fastapi import APIRouter, BackgroundTasks, HTTPException

from schemas.image_generation import (
    CharacterKeyframe,
    CharacterStylePropagation,
    CharacterView,
    CreateImageRequest,
    CreateImageResponse,
    FinalizeCharacterRequest,
    FinalizeCharacterResponse,
    GenerateScriptCharacterRequest,
    GenerateScriptEnvironmentRequest,
    GenerateObjectReferenceRequest,
    GenerateStoryboardRequest,
    GenerateStoryboardResponse,
    RegenerateCharacterKeyframeRequest,
    SetCharacterStyleRequest,
    SetCharacterStyleResponse,
)
from services.character_views import (
    CHARACTER_VIEW_SPECS,
    attach_generation_to_character,
    build_character_img2img_view_prompt,
    build_character_view_prompt,
    build_script_character_profile,
    finalize_character_generation,
    load_script_character,
    load_character_generation_payload,
    persist_character_generation,
    replace_character_keyframe,
)
from services.environment_text_to_image import (
    build_script_environment_prompt,
    load_script_environment,
    persist_environment_generation,
)
from services.object_text_to_image import build_object_prompt, load_object, persist_object_generation
from services.image_generation_service import generate_provider_images
from services.image_generation_storage import log_generation_to_supabase
from services.replicate_service import ReplicateConfigurationError
from services.storyboard_generation import generate_scene_storyboard
from services.style_propagation import character_style_impact, propagate_character_style
from services.visual_style import (
    apply_visual_style,
    character_visual_style,
    find_character_scene_ids,
    find_style_dependent_assets,
    load_character,
    resolve_character_visual_style,
    resolve_scene_visual_style,
    resolve_visual_style,
    save_character_visual_style,
)
from services.wavespeed_service import WaveSpeedServiceError


router = APIRouter(prefix="/api/image", tags=["text-to-image"])


def _resolve_entity_style(
    project_id: str,
    entity: dict[str, object],
    override: str | None = None,
):
    """Resolve an explicit request style before the entity's scene style."""
    if isinstance(override, str) and override.strip():
        return resolve_visual_style(override)
    metadata = entity.get("metadata")
    source_scene_ids = metadata.get("source_scene_ids") if isinstance(metadata, dict) else None
    return resolve_scene_visual_style(
        project_id,
        scene_ids=source_scene_ids if isinstance(source_scene_ids, list) else None,
    )


@router.post("/generate", response_model=CreateImageResponse)
def generate_image(payload: CreateImageRequest, background_tasks: BackgroundTasks) -> CreateImageResponse:
    try:
        response = generate_provider_images(payload)
        background_tasks.add_task(log_generation_to_supabase, payload, response)
        return response
    except (ReplicateConfigurationError, WaveSpeedServiceError) as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Image generation failed: {error}") from error


@router.post("/storyboard-generate", response_model=GenerateStoryboardResponse)
async def generate_storyboard(payload: GenerateStoryboardRequest) -> GenerateStoryboardResponse:
    try:
        return await asyncio.to_thread(generate_scene_storyboard, payload.project_id, payload.scene_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except (ReplicateConfigurationError, WaveSpeedServiceError) as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Storyboard generation failed: {error}") from error


@router.post("/character-generate", response_model=CreateImageResponse)
async def generate_character_images(payload: CreateImageRequest) -> CreateImageResponse:
    """Generate six independently requested, ordered character keyframes."""
    if not payload.project_id:
        raise HTTPException(status_code=400, detail="project_id is required for character generation")
    visual_style = resolve_visual_style(payload.visual_style)
    seed = payload.seed if payload.seed is not None else random.SystemRandom().randint(0, 2_147_483_647)
    concurrency_limit = max(1, int(os.getenv("CHARACTER_GENERATION_CONCURRENCY", "3")))
    semaphore = asyncio.Semaphore(concurrency_limit)

    async def generate_view(view: object) -> CharacterKeyframe:
        prompt = build_character_view_prompt(apply_visual_style(payload.prompt, visual_style), view)
        view_payload = payload.model_copy(update={
            "prompt": prompt,
            "num_images": 1,
            "seed": seed,
            "visual_style": visual_style.label,
        })
        async with semaphore:
            response = await asyncio.to_thread(generate_provider_images, view_payload)
        if not response.images:
            raise RuntimeError(f"No image returned for {view.value}")
        return CharacterKeyframe(
            view=view,
            image_url=response.images[0],
            prompt=prompt,
            seed=seed,
            model=payload.model,
        )

    try:
        keyframes = await asyncio.gather(*(generate_view(view) for view, _, _ in CHARACTER_VIEW_SPECS))
    except (ReplicateConfigurationError, WaveSpeedServiceError) as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Character generation failed: {error}") from error

    try:
        generation_job_id, keyframes = await asyncio.to_thread(
            persist_character_generation,
            payload.project_id,
            payload.model_copy(update={"seed": seed, "visual_style": visual_style.label}),
            keyframes,
        )
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Character storage failed: {error}") from error

    return CreateImageResponse(
        model=payload.model,
        images=[keyframe.image_url for keyframe in keyframes],
        keyframes=keyframes,
        generation_job_id=generation_job_id,
    )


@router.post("/character-generate-from-script", response_model=CreateImageResponse)
async def generate_script_character_images(payload: GenerateScriptCharacterRequest) -> CreateImageResponse:
    """Generate six views from facts persisted by the screenplay extractor."""
    try:
        character = await asyncio.to_thread(load_script_character, payload.project_id, payload.character_id)
        visual_style = resolve_character_visual_style(character, payload.visual_style)
        prompt = build_script_character_profile(character, visual_style)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    seed = payload.seed if payload.seed is not None else random.SystemRandom().randint(0, 2_147_483_647)
    concurrency_limit = max(1, int(os.getenv("CHARACTER_GENERATION_CONCURRENCY", "3")))
    semaphore = asyncio.Semaphore(concurrency_limit)
    image_payload = CreateImageRequest(
        model=payload.model,
        provider=payload.provider,
        prompt=prompt,
        aspect_ratio=payload.aspect_ratio,
        num_images=1,
        resolution=payload.resolution,
        output_format=payload.output_format,
        project_id=payload.project_id,
        seed=seed,
        visual_style=visual_style.label,
    )

    async def generate_view(view: CharacterView) -> CharacterKeyframe:
        view_prompt = build_character_view_prompt(prompt, view)
        async with semaphore:
            response = await asyncio.to_thread(
                generate_provider_images,
                image_payload.model_copy(update={"prompt": view_prompt}),
            )
        if not response.images:
            raise RuntimeError(f"No image returned for {view.value}")
        return CharacterKeyframe(
            view=view,
            image_url=response.images[0],
            prompt=view_prompt,
            seed=seed,
            model=payload.model,
        )

    try:
        keyframes = await asyncio.gather(*(generate_view(view) for view, _, _ in CHARACTER_VIEW_SPECS))
        generation_job_id, persisted_keyframes = await asyncio.to_thread(
            persist_character_generation,
            payload.project_id,
            image_payload,
            keyframes,
        )
        await asyncio.to_thread(
            attach_generation_to_character,
            payload.project_id,
            payload.character_id,
            generation_job_id,
            persisted_keyframes,
            visual_style=visual_style.label,
        )
    except (ReplicateConfigurationError, WaveSpeedServiceError) as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Script character generation failed: {error}") from error

    return CreateImageResponse(
        model=payload.model,
        images=[keyframe.image_url for keyframe in persisted_keyframes],
        keyframes=persisted_keyframes,
        generation_job_id=generation_job_id,
    )


@router.post("/environment-generate-from-script", response_model=CreateImageResponse)
async def generate_script_environment_image(payload: GenerateScriptEnvironmentRequest) -> CreateImageResponse:
    """Generate and attach one reference image from persisted screenplay environment facts."""
    try:
        environment = await asyncio.to_thread(load_script_environment, payload.project_id, payload.environment_id)
        visual_style = _resolve_entity_style(payload.project_id, environment, payload.visual_style)
        prompt = build_script_environment_prompt(environment, visual_style)
        image_payload = CreateImageRequest(
            model=payload.model,
            provider=payload.provider,
            prompt=prompt,
            aspect_ratio=payload.aspect_ratio,
            num_images=1,
            resolution=payload.resolution,
            output_format=payload.output_format,
            project_id=payload.project_id,
            seed=payload.seed,
            visual_style=visual_style.label,
        )
        response = await asyncio.to_thread(generate_provider_images, image_payload)
        if not response.images:
            raise RuntimeError("No image returned for environment")
        generation_job_id, _, stored_url = await asyncio.to_thread(
            persist_environment_generation,
            payload.project_id,
            payload.environment_id,
            image_payload,
            response.images[0],
        )
        return CreateImageResponse(
            model=payload.model,
            images=[stored_url],
            generation_job_id=generation_job_id,
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (ReplicateConfigurationError, WaveSpeedServiceError) as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Script environment generation failed: {error}") from error


@router.post("/object-generate", response_model=CreateImageResponse)
async def generate_object_reference_image(payload: GenerateObjectReferenceRequest) -> CreateImageResponse:
    """Generate and attach one square reference image for a project object."""
    try:
        prop = await asyncio.to_thread(load_object, payload.project_id, payload.object_id)
        visual_style = _resolve_entity_style(payload.project_id, prop, payload.visual_style)
        image_payload = CreateImageRequest(
            model=payload.model, provider=payload.provider, prompt=build_object_prompt(prop, visual_style), aspect_ratio=payload.aspect_ratio,
            num_images=1, resolution=payload.resolution, output_format=payload.output_format, project_id=payload.project_id, seed=payload.seed,
            visual_style=visual_style.label,
        )
        response = await asyncio.to_thread(generate_provider_images, image_payload)
        if not response.images:
            raise RuntimeError("No image returned for object")
        generation_job_id, _, stored_url = await asyncio.to_thread(
            persist_object_generation, payload.project_id, payload.object_id, image_payload, response.images[0]
        )
        return CreateImageResponse(model=payload.model, images=[stored_url], generation_job_id=generation_job_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (ReplicateConfigurationError, WaveSpeedServiceError) as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Object generation failed: {error}") from error


@router.post("/character-style", response_model=SetCharacterStyleResponse)
async def set_character_style(
    payload: SetCharacterStyleRequest,
    background_tasks: BackgroundTasks,
) -> SetCharacterStyleResponse:
    """Save a character style and regenerate its existing visual assets."""
    try:
        existing = await asyncio.to_thread(
            load_character,
            payload.project_id,
            payload.character_id,
        )
        previous_style = character_visual_style(existing)
        visual_style = await asyncio.to_thread(
            save_character_visual_style,
            payload.project_id,
            payload.character_id,
            payload.visual_style,
        )
        changed = previous_style.label != visual_style.label
        impact = await asyncio.to_thread(
            character_style_impact,
            payload.project_id,
            payload.character_id,
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Character style update failed: {error}") from error

    environment_ids = impact["environment_ids"]
    object_ids = impact["object_ids"]
    has_character_views = bool(impact["has_character_views"])
    total = int(has_character_views) + len(environment_ids) + len(object_ids)

    if changed:
        background_tasks.add_task(
            propagate_character_style,
            payload.project_id,
            payload.character_id,
            visual_style.label,
            payload.model,
            payload.provider,
        )

    return SetCharacterStyleResponse(
        character_id=payload.character_id,
        visual_style=visual_style.label,
        changed=changed,
        propagation_started=changed,
        propagation=CharacterStylePropagation(
            status="queued" if changed else "idle",
            visual_style=visual_style.label,
            affected_character_views=has_character_views,
            affected_environment_ids=environment_ids,
            affected_object_ids=object_ids,
            total=total,
        ),
    )


@router.post("/character-keyframes/{generation_job_id}/{view}/regenerate", response_model=CharacterKeyframe)
async def regenerate_character_keyframe(
    generation_job_id: str,
    view: CharacterView,
    payload: RegenerateCharacterKeyframeRequest,
) -> CharacterKeyframe:
    try:
        source_payload = await asyncio.to_thread(
            load_character_generation_payload,
            payload.project_id,
            generation_job_id,
        )
        view_label, view_direction = next(
            (label, direction) for candidate_view, label, direction in CHARACTER_VIEW_SPECS if candidate_view == view
        )
        base_prompt = source_payload.prompt
        if payload.correction.strip():
            base_prompt += f"\nAdditional repair guidance: {payload.correction.strip()}"
        if source_payload.image_mapping:
            prompt = build_character_img2img_view_prompt(base_prompt, view_label, view_direction)
        else:
            prompt = build_character_view_prompt(base_prompt, view)
        response = await asyncio.to_thread(
            generate_provider_images,
            source_payload.model_copy(update={"prompt": prompt, "num_images": 1}),
        )
        if not response.images:
            raise RuntimeError("No image returned for the replacement keyframe")
        return await asyncio.to_thread(
            replace_character_keyframe,
            payload.project_id,
            generation_job_id,
            CharacterKeyframe(
                view=view,
                image_url=response.images[0],
                prompt=prompt,
                seed=source_payload.seed,
                model=source_payload.model,
            ),
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except (ReplicateConfigurationError, WaveSpeedServiceError) as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Character keyframe regeneration failed: {error}") from error


@router.post("/character-finalize", response_model=FinalizeCharacterResponse)
async def finalize_character(payload: FinalizeCharacterRequest) -> FinalizeCharacterResponse:
    try:
        character_id, primary_asset_id = await asyncio.to_thread(
            finalize_character_generation,
            payload.project_id,
            payload.generation_job_id,
            payload.name,
            payload.role,
            payload.description,
            payload.primary_view,
        )
        return FinalizeCharacterResponse(
            character_id=character_id,
            primary_asset_id=primary_asset_id,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Character save failed: {error}") from error