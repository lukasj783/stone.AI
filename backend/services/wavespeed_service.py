import uuid
import os
import requests
import wavespeed
from core.supabase_client import get_supabase_client
from schemas.image_generation import CreateImageRequest, CreateImageResponse
from schemas.video_generation import CreateImageToVideoRequest, CreateVideoRequest, CreateMotionTransferRequest, CreateLipsyncRequest

class WaveSpeedServiceError(Exception):
    pass


def _create_wavespeed_client() -> wavespeed.Client:
    api_key = os.environ.get("WAVESPEED_API_KEY")
    return wavespeed.Client(api_key=api_key) if api_key else wavespeed.Client()


def generate_wavespeed_images(payload: CreateImageRequest) -> CreateImageResponse:
    try:
        client = _create_wavespeed_client()
        params: dict[str, object] = {
            "prompt": payload.prompt,
            "enable_base64_output": False,
            "enable_sync_mode": False
        }

        model_name = payload.model
        
        # Format correction (Wavespeed only accepts "png" or "jpeg")
        output_fmt = "jpeg" if payload.output_format == "jpg" else (payload.output_format or "png")

        # Extract images array from frontend mapping
        input_images = []
        if payload.image_mapping:
            input_images = list(payload.image_mapping.values())
        elif payload.image_input:
            input_images = payload.image_input

        if input_images:
            params["images"] = input_images

        # Text-to-image params
        if "nano-banana-pro/text-to-image-multi" in model_name:
            params["aspect_ratio"] = payload.aspect_ratio
            params["num_images"] = str(payload.num_images)
            params["output_format"] = output_fmt
        elif "nano-banana-2/text-to-image" in model_name:
            params["output_format"] = output_fmt
            params["resolution"] = payload.resolution or "1k"
            params["enable_image_search"] = payload.image_search
            params["enable_web_search"] = payload.google_search
        elif "seedream" in model_name and "edit" not in model_name:
            # Simple resolution mapping for seedream text-to-image
            size_map = {"4:3": "1024*768", "16:9": "1280*720", "1:1": "1024*1024"}
            params["size"] = size_map.get(payload.aspect_ratio, "1024*1024")
            
        # Image-to-image params
        elif "edit-multi" in model_name:
            # Wavespeed edit-multi ONLY supports exactly 2 or 4 images natively currently
            # We map any request > 2 to 4, otherwise to 2 to prevent validation errors
            params["num_images"] = 4 if payload.num_images > 2 else 2
            params["output_format"] = output_fmt
        elif "nano-banana/edit" in model_name or "nano-banana-pro/edit" in model_name:
            params["output_format"] = output_fmt
            if payload.resolution:
                params["resolution"] = payload.resolution
        elif "seedream-v5.0-lite/edit-sequential" in model_name:
            params["max_images"] = payload.num_images

        output = client.run(model_name, params)
        images = []
        if "outputs" in output and isinstance(output["outputs"], list):
            images = output["outputs"]

        return CreateImageResponse(
            model=model_name,
            images=images
        )
    except Exception as e:
        raise WaveSpeedServiceError(f"Wavespeed API Error: {str(e)}") from e


def _download_file_bytes(file_url: str) -> bytes:
    response = requests.get(file_url, timeout=120)
    response.raise_for_status()
    return response.content


def _upload_bytes_to_bucket(bucket: str, file_bytes: bytes, filename: str, content_type: str) -> str:
    supabase = get_supabase_client()
    if not supabase:
        raise WaveSpeedServiceError("Supabase client not initialized")

    try:
        supabase.storage.from_(bucket).upload(
            file=file_bytes,
            path=filename,
            file_options={"content-type": content_type}
        )
        return supabase.storage.from_(bucket).get_public_url(filename)
    except Exception as e:
        raise WaveSpeedServiceError(f"Failed to upload file to Supabase bucket '{bucket}': {str(e)}")


def upload_source_image(file_bytes: bytes, filename: str, content_type: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "png"
    safe_ext = ext if ext in {"png", "jpg", "jpeg", "webp"} else "png"
    storage_name = f"image_to_video_source_{uuid.uuid4().hex}.{safe_ext}"
    normalized_content_type = content_type or f"image/{'jpeg' if safe_ext == 'jpg' else safe_ext}"
    return _upload_bytes_to_bucket("output-images", file_bytes, storage_name, normalized_content_type)


def upload_source_video(file_bytes: bytes, filename: str, content_type: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "mp4"
    safe_ext = ext if ext in {"mp4", "mov", "webm"} else "mp4"
    storage_name = f"motion_transfer_source_{uuid.uuid4().hex}.{safe_ext}"
    normalized_content_type = content_type or f"video/{'mp4' if safe_ext == 'mp4' else safe_ext}"
    return _upload_bytes_to_bucket("input-videos", file_bytes, storage_name, normalized_content_type)


def _store_generated_video(video_url: str) -> str:
    video_bytes = _download_file_bytes(video_url)
    filename = f"wavespeed_{uuid.uuid4().hex}.mp4"
    return _upload_bytes_to_bucket("output-videos", video_bytes, filename, "video/mp4")


def _build_text_to_video_params(request: CreateVideoRequest) -> dict[str, object]:
    params: dict[str, object] = {
        "aspect_ratio": request.aspect_ratio,
        "duration": request.duration,
        "prompt": request.prompt,
    }

    if request.model.value == "kwaivgi/kling-v3.0-pro/text-to-video":
        params["cfg_scale"] = str(request.cfg_scale or 0.5)
        params["element_list"] = request.element_list if request.element_list is not None else []
        params["multi_prompt"] = request.multi_prompt if request.multi_prompt is not None else []
        if request.generate_audio is not None:
            params["sound"] = request.generate_audio
        if request.shot_type:
            params["shot_type"] = request.shot_type

    if request.model.value in ["google/veo3", "google/veo3.1-fast/text-to-video", "google/veo3.1-lite/text-to-video"]:
        if request.generate_audio is not None and request.model.value != "google/veo3.1-lite/text-to-video":
            params["generate_audio"] = request.generate_audio
        if request.resolution:
            params["resolution"] = request.resolution

    if request.model.value == "alibaba/wan-2.7/text-to-video":
        if request.resolution:
            params["resolution"] = request.resolution
        if request.enable_prompt_expansion is not None:
            params["enable_prompt_expansion"] = request.enable_prompt_expansion
        if request.seed is not None:
            params["seed"] = request.seed

    return params


def _build_image_to_video_params(request: CreateImageToVideoRequest) -> dict[str, object]:
    params: dict[str, object] = {
        "duration": request.duration,
        "image": request.image_url,
        "prompt": request.prompt,
    }

    if request.model.value in {"kwaivgi/kling-v3.0-std/image-to-video", "google/veo3.1/image-to-video"}:
        params["aspect_ratio"] = request.aspect_ratio

    if request.model.value == "kwaivgi/kling-v3.0-std/image-to-video":
        if request.cfg_scale is not None:
            params["cfg_scale"] = request.cfg_scale
        if request.element_list is not None:
            params["element_list"] = request.element_list
        if request.multi_prompt is not None:
            params["multi_prompt"] = request.multi_prompt
        if request.shot_type:
            params["shot_type"] = request.shot_type

    if request.model.value == "google/veo3.1/image-to-video":
        if request.generate_audio is not None:
            params["generate_audio"] = request.generate_audio
        if request.resolution:
            params["resolution"] = request.resolution
        if request.last_image:
            params["last_image"] = request.last_image

    if request.model.value == "bytedance/seedance-2.0/image-to-video":
        if request.resolution:
            params["resolution"] = request.resolution
        if request.last_image:
            params["last_image"] = request.last_image
        params["enable_web_search"] = False

    if request.model.value == "alibaba/wan-2.7/image-to-video":
        if request.resolution:
            params["resolution"] = request.resolution
        if request.enable_prompt_expansion is not None:
            params["enable_prompt_expansion"] = request.enable_prompt_expansion
        if request.seed is not None:
            params["seed"] = request.seed
        if request.last_image:
            params["last_image"] = request.last_image

    return params


def synthesize_video(request: CreateVideoRequest) -> str:
    """
    Calls WaveSpeed to generate a video and uploads the result to Supabase storage.
    """
    params = _build_text_to_video_params(request)

    try:
        client = _create_wavespeed_client()
        output = client.run(request.model.value, params)
        video_url = output["outputs"][0]
    except Exception as e:
        raise WaveSpeedServiceError(f"Failed to generate video via WaveSpeed: {str(e)}")

    try:
        return _store_generated_video(video_url)
    except Exception as e:
        raise WaveSpeedServiceError(f"Failed to upload generated video to Supabase: {str(e)}")


def synthesize_image_to_video(request: CreateImageToVideoRequest) -> str:
    params = _build_image_to_video_params(request)

    try:
        client = _create_wavespeed_client()
        output = client.run(request.model.value, params)
        video_url = output["outputs"][0]
    except Exception as e:
        raise WaveSpeedServiceError(f"Failed to generate image-to-video via WaveSpeed: {str(e)}")

    try:
        return _store_generated_video(video_url)
    except Exception as e:
        raise WaveSpeedServiceError(f"Failed to upload generated image-to-video output to Supabase: {str(e)}")


def _build_motion_transfer_params(request: CreateMotionTransferRequest) -> dict[str, object]:
    params: dict[str, object] = {
        "image": request.image_url,
        "video": request.video_url,
    }
    
    if request.prompt:
        params["prompt"] = request.prompt
    elif request.model.value == "wavespeed-ai/wan-2.2/animate":
        params["prompt"] = "" # Wan requires prompt to exist

    if request.model.value == "kwaivgi/kling-v3.0-std/motion-control":
        params["character_orientation"] = request.character_orientation or "video"
        params["element_list"] = request.element_list if request.element_list is not None else []
        params["keep_original_sound"] = request.keep_original_sound if request.keep_original_sound is not None else True
        if request.shot_type:
            params["shot_type"] = request.shot_type
            
    elif request.model.value == "wavespeed-ai/wan-2.2/animate":
        params["mode"] = "animate"
        if request.resolution:
            params["resolution"] = request.resolution
        params["seed"] = request.seed if request.seed is not None else -1
        
    elif request.model.value == "wavespeed-ai/steady-dancer":
        if request.resolution:
            params["resolution"] = request.resolution
        params["seed"] = request.seed if request.seed is not None else -1

    return params


def synthesize_motion_transfer(request: CreateMotionTransferRequest) -> str:
    params = _build_motion_transfer_params(request)

    try:
        client = _create_wavespeed_client()
        output = client.run(request.model.value, params)
        video_url = output["outputs"][0]
    except Exception as e:
        raise WaveSpeedServiceError(f"Failed to generate motion-transfer via WaveSpeed: {str(e)}")

    try:
        return _store_generated_video(video_url)
    except Exception as e:
        raise WaveSpeedServiceError(f"Failed to upload generated motion-transfer output to Supabase: {str(e)}")


def upload_source_audio(file_bytes: bytes, filename: str, content_type: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "mp3"
    safe_ext = ext if ext in {"mp3", "wav", "mpeg"} else "mp3"
    storage_name = f"lipsync_source_{uuid.uuid4().hex}.{safe_ext}"
    normalized_content_type = content_type or f"audio/{'mpeg' if safe_ext == 'mp3' else safe_ext}"
    return _upload_bytes_to_bucket("input-audios", file_bytes, storage_name, normalized_content_type)


def _build_lipsync_params(request: CreateLipsyncRequest) -> dict[str, object]:
    params: dict[str, object] = {
        "seed": request.seed if request.seed is not None else -1
    }
    
    if request.model.value == "wavespeed-ai/infinitetalk-fast":
        params["audio"] = request.audio_url
        params["image"] = request.image_url
    elif request.model.value == "wavespeed-ai/infinitetalk-fast/multi":
        params["image"] = request.image_url
        params["left_audio"] = request.left_audio_url
        params["right_audio"] = request.right_audio_url
        params["order"] = request.order
    elif request.model.value == "wavespeed-ai/infinitetalk-fast/video-to-video":
        params["audio"] = request.audio_url
        params["video"] = request.video_url
    elif request.model.value == "wavespeed-ai/infinitetalk/video-to-video-multi":
        params["video"] = request.video_url
        params["left_audio"] = request.left_audio_url
        params["right_audio"] = request.right_audio_url
        params["order"] = request.order
        if request.resolution:
            params["resolution"] = request.resolution
    elif request.model.value == "wavespeed-ai/longcat-avatar":
        params["audio"] = request.audio_url
        params["image"] = request.image_url
        if request.resolution:
            params["resolution"] = request.resolution
            
    return params


def synthesize_lipsync(request: CreateLipsyncRequest) -> str:
    params = _build_lipsync_params(request)

    try:
        client = _create_wavespeed_client()
        output = client.run(request.model.value, params)
        video_url = output["outputs"][0]
    except Exception as e:
        raise WaveSpeedServiceError(f"Failed to generate lipsync via WaveSpeed: {str(e)}")

    try:
        return _store_generated_video(video_url)
    except Exception as e:
        raise WaveSpeedServiceError(f"Failed to upload generated lipsync output to Supabase: {str(e)}")

