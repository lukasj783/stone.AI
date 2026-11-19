import asyncio
import os
import random
import uuid

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile

from core.supabase_client import get_supabase_client
from schemas.image_generation import (
    BatchDeleteRequest,
    CharacterKeyframe,
    CharacterView,
    CreateImageRequest,
    CreateImageResponse,
)
from services.character_views import (
    CHARACTER_VIEW_SPECS,
    attach_generation_to_character,
    build_character_img2img_view_prompt,
    build_script_character_profile,
    load_script_character,
    persist_character_generation,
)
from services.environment_text_to_image import (
    build_script_environment_prompt,
    load_script_environment,
    persist_environment_generation,
)
from services.huggingface_service import HuggingFaceServiceError, hf_face_swap, hf_multiple_angle
from services.image_generation_service import generate_provider_images
from services.image_generation_storage import extract_storage_filename, log_generation_to_supabase
from services.replicate_service import ReplicateConfigurationError
from services.visual_style import (
    apply_visual_style,
    resolve_character_visual_style,
    resolve_scene_visual_style,
    resolve_visual_style,
)
from services.storyboard_models import GPT_IMAGE_EDIT_MODEL, LEGACY_GPT_IMAGE_EDIT_MODELS
from services.wavespeed_service import (
    INPAINT_MODELS,
    WaveSpeedServiceError,
    generate_wavespeed_inpaint,
    upload_inpaint_image,
)


router = APIRouter(prefix="/api/image", tags=["image-to-image"])


def _resolve_entity_style(
    project_id: str,
    entity: dict[str, object],
    override: str | None = None,
):
    if isinstance(override, str) and override.strip():
        return resolve_visual_style(override)
    metadata = entity.get("metadata")
    source_scene_ids = metadata.get("source_scene_ids") if isinstance(metadata, dict) else None
    return resolve_scene_visual_style(
        project_id,
        scene_ids=source_scene_ids if isinstance(source_scene_ids, list) else None,
    )


@router.post("/batch-delete")
def batch_delete_assets(payload: BatchDeleteRequest) -> dict[str, str]:
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")

    for item in payload.items:
        try:
            result = supabase.table("image_generations").select("result_images").eq("id", item.id).execute()
            if not result.data or not isinstance(result.data[0], dict):
                continue

            result_images = result.data[0].get("result_images", [])
            target_filename = extract_storage_filename(item.url)
            if target_filename:
                try:
                    supabase.storage.from_("output-images").remove([target_filename])
                except Exception as error:
                    print(f"Failed to delete {item.url} from storage: {error}")

            if isinstance(result_images, list):
                remaining_images = [
                    image_url for image_url in result_images
                    if isinstance(image_url, str) and extract_storage_filename(image_url) != target_filename
                ]
                if len(remaining_images) == len(result_images):
                    continue
                if not remaining_images:
                    supabase.table("image_generations").delete().eq("id", item.id).execute()
                else:
                    supabase.table("image_generations").update({
                        "result_images": remaining_images,
                    }).eq("id", item.id).execute()
        except Exception as error:
            print(f"Failed to process delete for image {item.id}: {error}")

    return {"message": "Batch delete processed"}

@router.post("/generate-with-image", response_model=CreateImageResponse)
async def generate_image_with_file(
    payload: CreateImageRequest,
    background_tasks: BackgroundTasks,
) -> CreateImageResponse:
    try:
        response = await asyncio.to_thread(generate_provider_images, payload)
        background_tasks.add_task(log_generation_to_supabase, payload, response)
        return response
    except ValueError as error:
        raise HTTPException(status_code=400, detail=f"Invalid payload: {error}") from error
    except (ReplicateConfigurationError, WaveSpeedServiceError) as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Image generation failed: {error}") from error


@router.post("/inpaint", response_model=CreateImageResponse)
async def inpaint_image(
    model: str = Form(...),
    prompt: str = Form(...),
    base_image: UploadFile = File(...),
    mask_image: UploadFile = File(...),
    aspect_ratio: str = Form("1:1"),
    resolution: str = Form("1k"),
    output_format: str = Form("png"),
    num_images: int = Form(1),
    source_width: int | None = Form(None),
    source_height: int | None = Form(None),
) -> CreateImageResponse:
    if model not in INPAINT_MODELS:
        raise HTTPException(status_code=400, detail=f"Unsupported inpaint model: {model}")
    if not prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt is required")
    if not (base_image.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="base_image must be an image")
    if not (mask_image.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="mask_image must be an image")

    try:
        base_bytes = await base_image.read()
        mask_bytes = await mask_image.read()
        if not base_bytes or not mask_bytes:
            raise HTTPException(status_code=400, detail="base_image and mask_image must not be empty")
        base_url = upload_inpaint_image(base_bytes, base_image.filename or "base.png", base_image.content_type or "image/png", "base")
        mask_url = upload_inpaint_image(mask_bytes, mask_image.filename or "mask.png", mask_image.content_type or "image/png", "mask")
        return generate_wavespeed_inpaint(
            model=model,
            prompt=prompt.strip(),
            base_image_url=base_url,
            mask_image_url=mask_url,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            output_format=output_format,
            num_images=min(4, max(1, num_images)),
            source_width=source_width,
            source_height=source_height,
        )
    except HTTPException:
        raise
    except WaveSpeedServiceError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Inpaint generation failed: {error}") from error


@router.post("/face-swap")
async def face_swap_route(
    reference_image: UploadFile = File(...),
    target_image: UploadFile = File(...),
    seed: int = Form(0),
    randomize_seed: bool = Form(False),
    width: int = Form(1024),
    height: int = Form(1024),
    inference_steps: int = Form(4),
    guidance_scale: float = Form(1.0),
) -> dict[str, list[str]]:
    try:
        public_url = hf_face_swap(
            target_bytes=await target_image.read(),
            reference_bytes=await reference_image.read(),
            seed=seed,
            randomize_seed=randomize_seed,
            width=width,
            height=height,
            inference_steps=inference_steps,
            guidance_scale=guidance_scale,
        )
        return {"images": [public_url]}
    except HuggingFaceServiceError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"HF Face swap failed: {error}") from error


@router.post("/multiple-angle")
async def multiple_angle_route(
    image: UploadFile = File(...),
    prompt: str = Form("Turn the cat into a tiger."),
) -> dict[str, list[str]]:
    try:
        return {"images": [hf_multiple_angle(await image.read(), prompt)]}
    except HuggingFaceServiceError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"HF Multiple angle failed: {error}") from error


@router.post("/generate-from-upload", response_model=CreateImageResponse)
async def generate_from_upload(
    image: UploadFile = File(...),
    guidance_prompt: str = Form(""),
    model: str = Form("nanobanana"),
    provider: str = Form("replicate"),
    aspect_ratio: str = Form("1:1"),
    resolution: str = Form("1K"),
    project_id: str = Form(...),
    character_id: str | None = Form(None),
    visual_style: str | None = Form(None),
    seed: int | None = Form(None),
) -> CreateImageResponse:
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")
    if not (image.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image")
    try:
        selected_character_id = character_id.strip() if isinstance(character_id, str) else None
        character_profile = ""
        if selected_character_id:
            try:
                character = await asyncio.to_thread(load_script_character, project_id, selected_character_id)
                resolved_style = resolve_character_visual_style(character, visual_style)
                character_profile = build_script_character_profile(character, resolved_style)
            except ValueError as error:
                raise HTTPException(status_code=404, detail=str(error)) from error
        else:
            resolved_style = resolve_visual_style(visual_style)

        image_bytes = await image.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="Uploaded image is empty")

        reference_filename = f"uploaded-references/{uuid.uuid4().hex}.png"
        supabase.storage.from_("output-images").upload(
            file=image_bytes,
            path=reference_filename,
            file_options={"content-type": "image/png"},
        )
        reference_url = supabase.storage.from_("output-images").get_public_url(reference_filename)

        if provider == "wavespeed":
            if "nano-banana-pro" in model:
                model = "google/nano-banana-pro/edit"
            elif "nano-banana-2" in model:
                model = "google/nano-banana/edit"
            elif model in LEGACY_GPT_IMAGE_EDIT_MODELS:
                model = GPT_IMAGE_EDIT_MODEL

        shared_seed = seed if seed is not None else random.SystemRandom().randint(0, 2_147_483_647)
        prompt_context = "\n\n".join(
            section for section in (character_profile, guidance_prompt.strip()) if section
        ) or "Generate character reference views."
        if not character_profile:
            prompt_context = apply_visual_style(prompt_context, resolved_style)
        base_payload = CreateImageRequest(
            model=model,
            provider=provider,
            prompt=prompt_context,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            image_mapping={"reference": reference_url},
            image_search=False,
            google_search=False,
            project_id=project_id,
            seed=shared_seed,
            visual_style=resolved_style.label,
        )

        concurrency_limit = max(1, int(os.getenv("CHARACTER_GENERATION_CONCURRENCY", "3")))
        semaphore = asyncio.Semaphore(concurrency_limit)

        async def generate_view(view: CharacterView, view_label: str, view_direction: str) -> CharacterKeyframe:
            prompt = build_character_img2img_view_prompt(prompt_context, view_label, view_direction)
            view_payload = base_payload.model_copy(update={"prompt": prompt, "num_images": 1})
            async with semaphore:
                response = await asyncio.to_thread(generate_provider_images, view_payload)
            if not response.images:
                raise RuntimeError(f"No image returned for {view.value}")
            return CharacterKeyframe(
                view=view,
                image_url=response.images[0],
                prompt=prompt,
                seed=shared_seed,
                model=model,
            )

        keyframes = await asyncio.gather(
            *(generate_view(view, view_label, view_direction) for view, view_label, view_direction in CHARACTER_VIEW_SPECS)
        )
        generation_job_id, keyframes = await asyncio.to_thread(
            persist_character_generation,
            project_id,
            base_payload,
            keyframes,
        )
        if selected_character_id:
            await asyncio.to_thread(
                attach_generation_to_character,
                project_id,
                selected_character_id,
                generation_job_id,
                keyframes,
                resolved_style.label,
            )
        return CreateImageResponse(
            model=model,
            images=[keyframe.image_url for keyframe in keyframes],
            keyframes=keyframes,
            generation_job_id=generation_job_id,
        )
    except HTTPException:
        raise
    except (ReplicateConfigurationError, WaveSpeedServiceError) as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Image generation from upload failed: {error}") from error


@router.post("/environment-generate-from-upload", response_model=CreateImageResponse)
async def generate_environment_from_upload(
    image: UploadFile = File(...),
    guidance_prompt: str = Form(""),
    model: str = Form("nanobanana"),
    provider: str = Form("replicate"),
    aspect_ratio: str = Form("16:9"),
    resolution: str = Form("1K"),
    project_id: str = Form(...),
    environment_id: str = Form(...),
    visual_style: str | None = Form(None),
    seed: int | None = Form(None),
) -> CreateImageResponse:
    """Generate an environment reference from an uploaded visual reference and script facts."""
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")
    if not (image.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image")

    try:
        environment = await asyncio.to_thread(load_script_environment, project_id, environment_id)
        resolved_style = _resolve_entity_style(project_id, environment, visual_style)
        environment_prompt = build_script_environment_prompt(environment, resolved_style)
        image_bytes = await image.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="Uploaded image is empty")

        reference_filename = f"uploaded-environment-references/{uuid.uuid4().hex}.png"
        supabase.storage.from_("output-images").upload(
            file=image_bytes,
            path=reference_filename,
            file_options={"content-type": image.content_type or "image/png"},
        )
        reference_url = supabase.storage.from_("output-images").get_public_url(reference_filename)

        if provider == "wavespeed":
            if "nano-banana-pro" in model:
                model = "google/nano-banana-pro/edit"
            elif "nano-banana-2" in model:
                model = "google/nano-banana/edit"

        prompt = "\n\n".join(
            section for section in (environment_prompt, guidance_prompt.strip()) if section
        )
        payload = CreateImageRequest(
            model=model,
            provider=provider,
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            num_images=1,
            resolution=resolution,
            image_mapping={"reference": reference_url},
            image_search=False,
            google_search=False,
            project_id=project_id,
            seed=seed if seed is not None else random.SystemRandom().randint(0, 2_147_483_647),
            visual_style=resolved_style.label,
        )
        response = await asyncio.to_thread(generate_provider_images, payload)
        if not response.images:
            raise RuntimeError("No image returned for environment")
        generation_job_id, _, stored_url = await asyncio.to_thread(
            persist_environment_generation,
            project_id,
            environment_id,
            payload,
            response.images[0],
        )
        return CreateImageResponse(
            model=model,
            images=[stored_url],
            generation_job_id=generation_job_id,
        )
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (ReplicateConfigurationError, WaveSpeedServiceError) as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Environment image generation failed: {error}") from error