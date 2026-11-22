import asyncio

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile

from schemas.image_generation import (
    ApproveCharacterSheetRequest,
    CharacterSheetResponse,
    CreateCharacterFromSheetRequest,
    DraftCharacterSheetResponse,
    CharacterStylePropagation,
    CreateImageRequest,
    CreateImageResponse,
    GenerateScriptEnvironmentRequest,
    GenerateObjectReferenceRequest,
    GenerateStoryboardRequest,
    GenerateStoryboardResponse,
    SetCharacterStyleRequest,
    SetCharacterStyleResponse,
)
from services.character_sheet import (
    MAX_REFERENCE_IMAGES,
    SheetReference,
    approve_model_sheet,
    create_character_from_sheet,
    draft_model_sheet,
    generate_model_sheet,
    normalize_reference_tag,
    upload_reference_image,
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
    character_visual_style,
    find_character_scene_ids,
    find_style_dependent_assets,
    load_character,
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


async def _upload_references(images: list[UploadFile] | None, image_tags: list[str] | None) -> list[SheetReference]:
    """Store up to four uploaded reference images and pair each with its face/outfit/style tag."""
    uploads = [image for image in images or [] if image.filename]
    if len(uploads) > MAX_REFERENCE_IMAGES:
        raise HTTPException(status_code=400, detail=f"Use at most {MAX_REFERENCE_IMAGES} reference images")
    tags = list(image_tags or [])
    references: list[SheetReference] = []
    for index, upload in enumerate(uploads):
        if not (upload.content_type or "").startswith("image/"):
            raise HTTPException(status_code=400, detail=f"{upload.filename} is not an image")
        content = await upload.read()
        if not content:
            raise HTTPException(status_code=400, detail=f"{upload.filename} is empty")
        url = await asyncio.to_thread(upload_reference_image, content, upload.content_type)
        references.append(SheetReference(url=url, tag=normalize_reference_tag(tags[index] if index < len(tags) else None)))
    return references


@router.post("/character-sheet/generate", response_model=CharacterSheetResponse)
async def generate_character_sheet(
    project_id: str = Form(...),
    character_id: str = Form(...),
    prompt: str = Form("", max_length=4_000),
    model: str | None = Form(None),
    visual_style: str | None = Form(None),
    images: list[UploadFile] | None = File(None),
    image_tags: list[str] | None = Form(None),
) -> CharacterSheetResponse:
    """Generate one model sheet (face close-up + turnaround) from the script profile, an
    optional prompt, and up to four reference images tagged face, outfit or style."""
    try:
        references = await _upload_references(images, image_tags)
        result = await asyncio.to_thread(
            generate_model_sheet,
            project_id,
            character_id,
            direction=prompt,
            references=references,
            model=model,
            visual_style=visual_style,
        )
        return CharacterSheetResponse(**result)
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except (ReplicateConfigurationError, WaveSpeedServiceError) as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Character sheet generation failed: {error}") from error


@router.post("/character-sheet/approve", response_model=CharacterSheetResponse)
async def approve_character_sheet(payload: ApproveCharacterSheetRequest) -> CharacterSheetResponse:
    """Use this sheet for the character in storyboards; its face panel becomes the face close-up."""
    try:
        result = await asyncio.to_thread(approve_model_sheet, payload.project_id, payload.character_id, payload.asset_id)
        return CharacterSheetResponse(character_id=payload.character_id, **result)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Character sheet approval failed: {error}") from error


@router.post("/character-sheet/draft", response_model=DraftCharacterSheetResponse)
async def draft_character_sheet(
    project_id: str = Form(...),
    prompt: str = Form("", max_length=4_000),
    model: str | None = Form(None),
    visual_style: str | None = Form(None),
    images: list[UploadFile] | None = File(None),
    image_tags: list[str] | None = Form(None),
) -> DraftCharacterSheetResponse:
    """Generate a sheet before the character exists (Character page); save it with create-character."""
    try:
        references = await _upload_references(images, image_tags)
        result = await asyncio.to_thread(
            draft_model_sheet,
            project_id,
            description=prompt,
            references=references,
            model=model,
            visual_style=visual_style,
        )
        return DraftCharacterSheetResponse(**result)
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except (ReplicateConfigurationError, WaveSpeedServiceError) as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Character sheet generation failed: {error}") from error


@router.post("/character-sheet/create-character", response_model=CharacterSheetResponse)
async def create_character_with_sheet(payload: CreateCharacterFromSheetRequest) -> CharacterSheetResponse:
    """Create a character from a draft sheet; the sheet becomes its approved reference."""
    try:
        result = await asyncio.to_thread(
            create_character_from_sheet,
            payload.project_id,
            payload.sheet_asset_id,
            payload.name,
            payload.role,
            payload.description,
        )
        return CharacterSheetResponse(**result)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Character save failed: {error}") from error
