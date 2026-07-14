from fastapi import APIRouter, HTTPException, File, UploadFile, Form, BackgroundTasks
import base64
from io import BytesIO
import httpx
import uuid

from core.config import get_settings
from core.supabase_client import get_supabase_client
from schemas.image_generation import CreateImageRequest, CreateImageResponse, ImageModel, BatchDeleteRequest
from services.replicate_service import ReplicateConfigurationError, generate_images
from services.huggingface_service import hf_face_swap, hf_multiple_angle, HuggingFaceServiceError
from services.wavespeed_service import (
    INPAINT_MODELS,
    generate_wavespeed_images,
    generate_wavespeed_inpaint,
    upload_inpaint_image,
    WaveSpeedServiceError,
)
from services.character_service import (
    build_character_system_prompt,
    build_character_img2img_prompt,
    split_character_sheet,
    upload_keyframe,
    log_character_to_studio,
)


router = APIRouter(prefix="/api/image", tags=["images"])


def extract_storage_filename(url: str | None) -> str:
    if not url or not isinstance(url, str):
        return ""

    return url.split("/")[-1].split('?')[0]

def log_generation_to_supabase(payload: CreateImageRequest, response: CreateImageResponse):
    supabase = get_supabase_client()
    if supabase:
        try:
            permanent_images = []
            
            # Download from Replicate and upload to Supabase Storage
            # Requires a bucket named 'output-images'
            for idx, img_url in enumerate(response.images):
                if img_url and img_url.startswith("http"):
                    try:
                        res = httpx.get(img_url, timeout=30.0)
                        res.raise_for_status()
                        
                        file_ext = img_url.split('.')[-1].split('?')[0]
                        if file_ext not in ['png', 'jpg', 'jpeg', 'webp']:
                            file_ext = 'png'
                            
                        filename = f"{uuid.uuid4()}.{file_ext}"
                        content_type = f"image/{'jpeg' if file_ext == 'jpg' else file_ext}"
                        
                        supabase.storage.from_("output-images").upload(
                            file=res.content,
                            path=filename,
                            file_options={"content-type": content_type}
                        )
                        
                        public_url = supabase.storage.from_("output-images").get_public_url(filename)
                        permanent_images.append(public_url)
                    except Exception as upload_error:
                        print(f"Failed to upload image {img_url}: {upload_error}")
                        permanent_images.append(img_url)
                else:
                    permanent_images.append(img_url)

            # Update response with the new permanent URLs so the user gets them right away
            response.images = permanent_images
            
            # Allow for model being a string directly or an enum if str type wasn't respected somewhere
            model_val = payload.model.value if hasattr(payload.model, "value") else payload.model

            supabase.table("image_generations").insert({
                "model": model_val,
                "prompt": payload.prompt,
                "aspect_ratio": payload.aspect_ratio,
                "num_images": payload.num_images,
                "resolution": payload.resolution,
                "image_mapping": payload.image_mapping,
                "result_images": permanent_images
            }).execute()
        except Exception as e:
            print(f"Failed to log generation to Supabase: {e}")

@router.post("/batch-delete")
def batch_delete_assets(payload: BatchDeleteRequest):
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")
        
    for item in payload.items:
        try:
            res = supabase.table("image_generations").select("result_images").eq("id", item.id).execute()
            if not res.data or not isinstance(res.data[0], dict):
                continue
            
            result_images = res.data[0].get("result_images", [])
            target_filename = extract_storage_filename(item.url)
            
            # Extract filename from the standard Supabase public URL structure
            try:
                if target_filename:
                    supabase.storage.from_("output-images").remove([target_filename])
            except Exception as e:
                print(f"Failed to delete {item.url} from storage: {e}")
                
            # Clean up the DB row payload
            if isinstance(result_images, list):
                remaining_images = [
                    img for img in result_images
                    if isinstance(img, str) and extract_storage_filename(img) != target_filename
                ]

                if len(remaining_images) == len(result_images):
                    print(f"No matching DB image found for delete request: {item.url}")
                    continue

                if not remaining_images:
                    supabase.table("image_generations").delete().eq("id", item.id).execute()
                else:
                    supabase.table("image_generations").update({"result_images": remaining_images}).eq("id", item.id).execute()
                    
        except Exception as e:
            print(f"Failed to process delete for image {item.id}: {e}")
            
    return {"message": "Batch delete processed"}

@router.post("/generate", response_model=CreateImageResponse)
def generate_image(payload: CreateImageRequest, background_tasks: BackgroundTasks) -> CreateImageResponse:
    settings = get_settings()

    try:
        if payload.provider == "wavespeed":
            response = generate_wavespeed_images(payload=payload)
        else:
            response = generate_images(payload=payload, api_token=settings.replicate_api_token)
            
        background_tasks.add_task(log_generation_to_supabase, payload, response)
    except ReplicateConfigurationError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except WaveSpeedServiceError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Image generation failed: {error}") from error

    return response


@router.post("/generate-with-image", response_model=CreateImageResponse)
async def generate_image_with_file(
    payload: CreateImageRequest,
    background_tasks: BackgroundTasks
) -> CreateImageResponse:
    """Generate image using uploaded images passed in payload.image_mapping."""
    settings = get_settings()
    
    try:
        if payload.provider == "wavespeed":
            response = generate_wavespeed_images(payload=payload)
        else:
            response = generate_images(payload=payload, api_token=settings.replicate_api_token)
            
        background_tasks.add_task(log_generation_to_supabase, payload, response)
        return response
        
    except ValueError as error:
        raise HTTPException(status_code=400, detail=f"Invalid payload: {error}") from error
    except ReplicateConfigurationError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except WaveSpeedServiceError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Image generation failed: {str(error)}") from error


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

        if not base_bytes:
            raise HTTPException(status_code=400, detail="base_image is empty")
        if not mask_bytes:
            raise HTTPException(status_code=400, detail="mask_image is empty")

        base_url = upload_inpaint_image(
            file_bytes=base_bytes,
            filename=base_image.filename or "base.png",
            content_type=base_image.content_type or "image/png",
            role="base",
        )
        mask_url = upload_inpaint_image(
            file_bytes=mask_bytes,
            filename=mask_image.filename or "mask.png",
            content_type=mask_image.content_type or "image/png",
            role="mask",
        )

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
        raise HTTPException(status_code=500, detail=f"Inpaint generation failed: {str(error)}") from error

@router.post("/face-swap")
async def face_swap_route(
    reference_image: UploadFile = File(...),
    target_image: UploadFile = File(...),
    seed: int = Form(0),
    randomize_seed: bool = Form(False),
    width: int = Form(1024),
    height: int = Form(1024),
    inference_steps: int = Form(4),
    guidance_scale: float = Form(1.0)
):
    """
    Swap faces using FLUX.2 Klein 9B and the BFS-Best-Face-Swap LoRA via Hugging Face.
    """
    try:
        target_bytes = await target_image.read()
        reference_bytes = await reference_image.read()
        
        # Calling our new Hugging Face service
        public_url = hf_face_swap(
            target_bytes=target_bytes,
            reference_bytes=reference_bytes,
            seed=seed,
            randomize_seed=randomize_seed,
            width=width,
            height=height,
            inference_steps=inference_steps,
            guidance_scale=guidance_scale
        )
        
        return {"images": [public_url]}

    except HuggingFaceServiceError as error:
        raise HTTPException(status_code=500, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"HF Face swap failed: {str(error)}")

@router.post("/multiple-angle")
async def multiple_angle_route(
    image: UploadFile = File(...),
    prompt: str = Form("Turn the cat into a tiger.")
):
    """
    Generate multiple angles using dx8152/Qwen-Edit-2509-Multiple-angles via Hugging Face.
    """
    try:
        image_bytes = await image.read()
        
        # Calling our Hugging Face service
        public_url = hf_multiple_angle(
            image_bytes=image_bytes,
            prompt=prompt
        )
        
        return {"images": [public_url]}

    except HuggingFaceServiceError as error:
        raise HTTPException(status_code=500, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Multiple angle generation failed: {str(error)}")


@router.post("/character-generate", response_model=CreateImageResponse)
def generate_character_images(payload: CreateImageRequest) -> CreateImageResponse:
    """
    Generate a character turnaround sheet using Nanobanana, then split the
    composite image into individual keyframes using Pillow.

    Returns a CreateImageResponse whose ``images`` list contains one URL per
    keyframe (view) extracted from the generated sheet.
    """
    settings = get_settings()

    # Build the system prompt that instructs the model to produce a 2x3 grid
    enhanced_prompt = build_character_system_prompt(payload.prompt)

    character_payload = payload.model_copy(update={"prompt": enhanced_prompt, "num_images": 1})

    try:
        if payload.provider == "wavespeed":
            response = generate_wavespeed_images(payload=character_payload)
        else:
            response = generate_images(payload=character_payload, api_token=settings.replicate_api_token)
    except ReplicateConfigurationError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except WaveSpeedServiceError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Character generation failed: {error}") from error

    if not response.images:
        raise HTTPException(status_code=500, detail="No images were returned by the model")

    keyframe_urls: list[str] = []

    for sheet_url in response.images:
        try:
            download = httpx.get(sheet_url, timeout=60.0)
            download.raise_for_status()
            raw_bytes = download.content
        except Exception as download_error:
            print(f"Failed to download sheet {sheet_url}: {download_error}")
            keyframe_urls.append(sheet_url)
            continue

        keyframes = split_character_sheet(raw_bytes, cols=2, rows=2)

        if not keyframes:
            keyframe_urls.append(sheet_url)
            continue

        for kf_bytes in keyframes:
            try:
                keyframe_urls.append(upload_keyframe(kf_bytes))
            except Exception as upload_error:
                print(f"Failed to upload keyframe: {upload_error}")

    if not keyframe_urls:
        raise HTTPException(status_code=500, detail="Failed to process character sheet into keyframes")

    # Log to studio schema (best-effort, non-blocking)
    try:
        log_character_to_studio(
            keyframe_urls=keyframe_urls,
            prompt=payload.prompt,
            model=payload.model,
        )
    except Exception as log_error:
        print(f"Character studio logging failed (non-fatal): {log_error}")

    return CreateImageResponse(model=payload.model, images=keyframe_urls)


@router.post("/generate-from-upload", response_model=CreateImageResponse)
async def generate_from_upload(
    image: UploadFile = File(...),
    guidance_prompt: str = Form(""),
    model: str = Form("nanobanana"),
    provider: str = Form("replicate"),
    aspect_ratio: str = Form("1:1"),
    resolution: str = Form("1K"),
    num_images: int = Form(4),
    background_tasks: BackgroundTasks = None,
) -> CreateImageResponse:
    """
    Generate character style variations from an uploaded reference image.
    
    - Uploads the reference image to Supabase storage
    - Generates 4 style variations in a 2x2 grid using nanobanana
    - Returns grid with original image first, then 4 variations split into cells
    """
    settings = get_settings()
    supabase = get_supabase_client()
    
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")
    
    if not (image.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image")
    
    try:
        # Read and store the uploaded image
        image_bytes = await image.read()
        
        if not image_bytes:
            raise HTTPException(status_code=400, detail="Uploaded image is empty")
        
        # Upload reference image to Supabase
        reference_filename = f"uploaded-references/{uuid.uuid4().hex}.png"
        supabase.storage.from_("output-images").upload(
            file=image_bytes,
            path=reference_filename,
            file_options={"content-type": "image/png"},
        )
        reference_url = supabase.storage.from_("output-images").get_public_url(reference_filename)
        
        # Auto-correct the model to an image-to-image (edit) model if necessary
        if provider == "wavespeed":
            if "nano-banana-pro" in model:
                model = "google/nano-banana-pro/edit"
            elif "nano-banana-2" in model:
                model = "google/nano-banana/edit" # Note: WaveSpeed uses nano-banana/edit, not 2/edit

        # Build the exact turnaround prompt for image-to-image
        system_prompt = build_character_img2img_prompt(guidance_prompt)
        
        # Create payload for generation (img2img style with reference)
        generation_payload = CreateImageRequest(
            model=model,
            provider=provider,
            prompt=system_prompt,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            num_images=1,  # Generate one 2x2 grid composite
            image_mapping={"reference": reference_url},
            image_search=False,
            google_search=False
        )
        
        # Generate variations
        try:
            if provider == "wavespeed":
                response = generate_wavespeed_images(payload=generation_payload)
            else:
                response = generate_images(
                    payload=generation_payload,
                    api_token=settings.replicate_api_token
                )
        except (ReplicateConfigurationError, WaveSpeedServiceError) as error:
            raise HTTPException(status_code=500, detail=str(error)) from error
        
        if not response.images:
            raise HTTPException(status_code=500, detail="Generation returned no images")
        
        # Process the 2x2 grid into 4 separate variation images
        variation_urls: list[str] = []
        
        for grid_url in response.images:
            try:
                download = httpx.get(grid_url, timeout=60.0)
                download.raise_for_status()
                grid_bytes = download.content
                
                # Split 2x2 grid into 4 cells (2 columns, 2 rows)
                variations = split_character_sheet(grid_bytes, cols=2, rows=2)
                
                # Upload each variation
                for var_bytes in variations:
                    try:
                        var_filename = f"character_variation_{uuid.uuid4().hex}.png"
                        supabase.storage.from_("output-images").upload(
                            file=var_bytes,
                            path=var_filename,
                            file_options={"content-type": "image/png"},
                        )
                        var_url = supabase.storage.from_("output-images").get_public_url(var_filename)
                        variation_urls.append(var_url)
                    except Exception as upload_error:
                        print(f"Failed to upload variation: {upload_error}")
                        
            except Exception as download_error:
                print(f"Failed to process grid {grid_url}: {download_error}")
        
        # Return with original image first, then variations
        result_images = [reference_url] + variation_urls
        
        if not result_images:
            raise HTTPException(
                status_code=500,
                detail="Failed to process generation results"
            )
        
        # Log to Supabase (background task)
        if background_tasks:
            background_tasks.add_task(
                log_generation_to_supabase,
                generation_payload,
                CreateImageResponse(model=model, images=result_images)
            )
        
        return CreateImageResponse(model=model, images=result_images)
        
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Image generation from upload failed: {str(error)}"
        ) from error



