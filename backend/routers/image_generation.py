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
from services.wavespeed_service import generate_wavespeed_images, WaveSpeedServiceError


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


