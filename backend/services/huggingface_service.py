import os
import io
import uuid
from huggingface_hub import InferenceClient
from core.supabase_client import get_supabase_client

class HuggingFaceServiceError(Exception):
    pass

def upload_image_to_supabase(image_bytes: bytes, file_ext: str = "png") -> str:
    supabase = get_supabase_client()
    if not supabase:
        raise HuggingFaceServiceError("Supabase client not initialized")
        
    filename = f"hf_generation_{uuid.uuid4()}.{file_ext}"
    content_type = f"image/{'jpeg' if file_ext == 'jpg' else file_ext}"
    
    try:
        supabase.storage.from_("output-images").upload(
            file=image_bytes,
            path=filename,
            file_options={"content-type": content_type}
        )
        return supabase.storage.from_("output-images").get_public_url(filename)
    except Exception as e:
        raise HuggingFaceServiceError(f"Failed to upload image to Supabase: {str(e)}")

def hf_face_swap(
    target_bytes: bytes,
    reference_bytes: bytes,
    seed: int = 0,
    randomize_seed: bool = False,
    width: int = 1024,
    height: int = 1024,
    inference_steps: int = 4,
    guidance_scale: float = 1.0
) -> str:
    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
        raise HuggingFaceServiceError("HF_TOKEN environment variable is not set.")
        
    client = InferenceClient(provider="fal-ai", api_key=hf_token)
    
    try:
        # User defined pattern for InferenceClient:
        image = client.image_to_image(
            target_bytes,
            prompt="Face swap",
            model="Alissonerdx/BFS-Best-Face-Swap",
            width=width,
            height=height,
            num_inference_steps=inference_steps,
            guidance_scale=guidance_scale,
            seed=seed if not randomize_seed else None,
        )
        
        buffered = io.BytesIO()
        image.save(buffered, format="PNG")
        image_bytes = buffered.getvalue()
        
        # Uploading straight to Supabase rather than returning base64
        return upload_image_to_supabase(image_bytes)
        
    except Exception as e:
        raise HuggingFaceServiceError(f"HF Face swap failed: {str(e)}")

def hf_multiple_angle(
    image_bytes: bytes,
    prompt: str = "Generate multiple angles of this character."
) -> str:
    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
        raise HuggingFaceServiceError("HF_TOKEN environment variable is not set.")
        
    client = InferenceClient(provider="wavespeed", api_key=hf_token)
    
    try:
        image = client.image_to_image(
            image_bytes,
            prompt=prompt,
            model="dx8152/Qwen-Edit-2509-Multiple-angles",
        )
        
        buffered = io.BytesIO()
        image.save(buffered, format="PNG")
        output_bytes = buffered.getvalue()
        
        return upload_image_to_supabase(output_bytes)
        
    except Exception as e:
        raise HuggingFaceServiceError(f"HF Multiple angle failed: {str(e)}")