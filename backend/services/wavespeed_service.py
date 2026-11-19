import uuid
import os
import requests
import wavespeed
from core.supabase_client import get_supabase_client
from schemas.image_generation import CreateImageRequest, CreateImageResponse
from schemas.video_generation import CreateImageToVideoRequest, CreateVideoRequest, CreateMotionTransferRequest, CreateLipsyncRequest
from services.storyboard_models import GPT_IMAGE_EDIT_MODEL, LEGACY_GPT_IMAGE_EDIT_MODELS, STORYBOARD_MODELS

class WaveSpeedServiceError(Exception):
    pass


MULTI_IMAGE_ASPECT_RATIOS = {"3:2", "2:3", "3:4", "4:3"}
NANO_BANANA_ASPECT_RATIOS = {
    "1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"
}
NANO_BANANA_2_ASPECT_RATIOS = NANO_BANANA_ASPECT_RATIOS | {"1:4", "4:1", "1:8", "8:1"}
NANO_BANANA_RESOLUTIONS = {"1k", "2k", "4k"}
NANO_BANANA_2_RESOLUTIONS = {"0.5k", "1k", "2k", "4k"}
OUTPUT_FORMATS = {"png", "jpeg"}
INPAINT_MODELS = {"wavespeed-ai/flux-fill-dev", "google/nano-banana-pro/edit"}


def _create_wavespeed_client() -> wavespeed.Client:
    api_key = os.environ.get("WAVESPEED_API_KEY")
    if api_key:
        return wavespeed.Client(api_key=api_key)
    return wavespeed.Client()


def _normalize_output_format(output_format: str | None) -> str:
    normalized = (output_format or "png").strip().lower()
    if normalized == "jpg":
        normalized = "jpeg"
    return normalized if normalized in OUTPUT_FORMATS else "png"


def _normalize_resolution(resolution: str | None, allowed: set[str], fallback: str = "1k") -> str:
    normalized = (resolution or fallback).strip().lower()
    return normalized if normalized in allowed else fallback


def _normalize_aspect_ratio(aspect_ratio: str | None, allowed: set[str], fallback: str = "4:3") -> str:
    normalized = (aspect_ratio or fallback).strip()
    return normalized if normalized in allowed else fallback


def _size_from_aspect_ratio(aspect_ratio: str | None) -> str:
    mapping = {
        "1:1": "1024*1024",
        "3:2": "1216*832",
        "2:3": "832*1216",
        "3:4": "864*1152",
        "4:3": "1152*864",
        "4:5": "896*1120",
        "5:4": "1120*896",
        "9:16": "768*1344",
        "16:9": "1344*768",
        "21:9": "1536*640",
    }
    return mapping.get((aspect_ratio or "").strip(), "1024*1024")


def _size_from_dimensions(width: int | None, height: int | None, aspect_ratio: str | None) -> str:
    if not width or not height or width <= 0 or height <= 0:
        return _size_from_aspect_ratio(aspect_ratio)

    output_width = float(width)
    output_height = float(height)
    max_dimension = max(output_width, output_height)
    min_dimension = min(output_width, output_height)

    if max_dimension > 1536:
        scale = 1536 / max_dimension
        output_width *= scale
        output_height *= scale
    elif min_dimension < 256:
        scale = 256 / min_dimension
        output_width *= scale
        output_height *= scale

    return f"{round(output_width)}*{round(output_height)}"


def _normalize_num_images(num_images: int | None, maximum: int = 4) -> int:
    if num_images is None:
        return 1
    return min(maximum, max(1, num_images))


def _extract_input_images(payload: CreateImageRequest) -> list[str]:
    if payload.image_mapping:
        raw_images = list(payload.image_mapping.values())
    else:
        raw_images = payload.image_input or []

    images = [image for image in raw_images if isinstance(image, str) and image.startswith(("http://", "https://"))]
    if raw_images and len(images) != len(raw_images):
        raise WaveSpeedServiceError(
            "WaveSpeed image edit requires publicly accessible HTTP image URLs. "
            "Local data/blob URLs must be uploaded before generation."
        )
    return images


def _extract_output_urls(output: object) -> list[str]:
    if not isinstance(output, dict):
        return []

    outputs = output.get("outputs")
    if outputs is None and isinstance(output.get("data"), dict):
        outputs = output["data"].get("outputs")

    if isinstance(outputs, list):
        return [item for item in outputs if isinstance(item, str)]
    if isinstance(outputs, str):
        return [outputs]
    return []


def generate_wavespeed_images(payload: CreateImageRequest) -> CreateImageResponse:
    try:
        client = _create_wavespeed_client()
        params: dict[str, object] = {
            "prompt": payload.prompt,
            "enable_base64_output": False,
            "enable_sync_mode": False
        }

        model_name = payload.model
        if model_name in LEGACY_GPT_IMAGE_EDIT_MODELS:
            model_name = GPT_IMAGE_EDIT_MODEL
        output_fmt = _normalize_output_format(payload.output_format)
        input_images = _extract_input_images(payload)

        is_edit_model = "edit" in model_name
        if is_edit_model and not input_images:
            raise WaveSpeedServiceError(f"{model_name} requires at least one input image URL.")

        if input_images:
            params["images"] = input_images

        storyboard_spec = STORYBOARD_MODELS.get(model_name)
        if storyboard_spec:
            # Storyboard edit models carry their own request shape (see storyboard_models.py).
            params = storyboard_spec.build_params(
                payload.prompt, input_images, payload.aspect_ratio, payload.resolution, payload.output_format,
            )
        # Text-to-image params
        elif "nano-banana-pro/text-to-image-multi" in model_name:
            params["aspect_ratio"] = _normalize_aspect_ratio(payload.aspect_ratio, MULTI_IMAGE_ASPECT_RATIOS)
            params["num_images"] = 2
            params["output_format"] = output_fmt
        elif "nano-banana-2/text-to-image" in model_name:
            params["aspect_ratio"] = _normalize_aspect_ratio(payload.aspect_ratio, NANO_BANANA_2_ASPECT_RATIOS, "1:1")
            params["output_format"] = output_fmt
            params["resolution"] = _normalize_resolution(payload.resolution, NANO_BANANA_2_RESOLUTIONS)
            params["enable_image_search"] = bool(payload.image_search)
            params["enable_web_search"] = bool(payload.google_search)
        elif "seedream" in model_name and "edit" not in model_name:
            params["size"] = _size_from_aspect_ratio(payload.aspect_ratio)
            
        # Image-to-image params (GPT Image edit models are in STORYBOARD_MODELS above)
        elif "edit-multi" in model_name:
            params["aspect_ratio"] = _normalize_aspect_ratio(payload.aspect_ratio, MULTI_IMAGE_ASPECT_RATIOS)
            params["num_images"] = 2
            params["output_format"] = output_fmt
        elif "nano-banana/edit" in model_name or "nano-banana-pro/edit" in model_name:
            params["aspect_ratio"] = _normalize_aspect_ratio(payload.aspect_ratio, NANO_BANANA_ASPECT_RATIOS, "1:1")
            params["output_format"] = output_fmt
            if "nano-banana-pro/edit" in model_name:
                params["resolution"] = _normalize_resolution(payload.resolution, NANO_BANANA_RESOLUTIONS)
        elif "seedream-v5.0-lite/edit-sequential" in model_name:
            params["size"] = _size_from_aspect_ratio(payload.aspect_ratio)
            params["max_images"] = payload.num_images
            params["output_format"] = output_fmt
        elif "seedream-v4.5/edit" in model_name:
            params["size"] = _size_from_aspect_ratio(payload.aspect_ratio)

        output = client.run(model_name, params)
        images = _extract_output_urls(output)

        if not images:
            raise WaveSpeedServiceError(f"No images were returned by WaveSpeed. Last output: {output!r}")

        return CreateImageResponse(
            model=model_name,
            images=images
        )
    except Exception as e:
        raise WaveSpeedServiceError(f"Wavespeed API Error: {str(e)}") from e


def upload_inpaint_image(file_bytes: bytes, filename: str, content_type: str, role: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "png"
    safe_ext = ext if ext in {"png", "jpg", "jpeg", "webp"} else "png"
    safe_role = "mask" if role == "mask" else "base"
    storage_name = f"inpaint_{safe_role}_{uuid.uuid4().hex}.{safe_ext}"
    normalized_content_type = content_type or f"image/{'jpeg' if safe_ext == 'jpg' else safe_ext}"
    return _upload_bytes_to_bucket("output-images", file_bytes, storage_name, normalized_content_type)


def generate_wavespeed_inpaint(
    model: str,
    prompt: str,
    base_image_url: str,
    mask_image_url: str,
    aspect_ratio: str = "1:1",
    resolution: str | None = "1k",
    output_format: str = "png",
    num_images: int = 1,
    source_width: int | None = None,
    source_height: int | None = None,
) -> CreateImageResponse:
    if model not in INPAINT_MODELS:
        raise WaveSpeedServiceError(f"Unsupported inpaint model: {model}")

    try:
        client = _create_wavespeed_client()
        output_fmt = _normalize_output_format(output_format)

        if model == "wavespeed-ai/flux-fill-dev":
            params: dict[str, object] = {
                "image": base_image_url,
                "mask_image": mask_image_url,
                "prompt": prompt,
                "size": _size_from_dimensions(source_width, source_height, aspect_ratio),
                "num_images": _normalize_num_images(num_images),
                "num_inference_steps": 28,
                "guidance_scale": 30,
                "seed": 0,
                "loras": [],
            }
        else:
            guided_prompt = (
                "Use the first image as the source image. Use the second image as a black-and-white mask: "
                "white pixels mark the only area to edit, and black pixels must be preserved exactly. "
                "Do not change unmasked areas. Edit the masked area with this instruction: "
                f"{prompt}"
            )
            params = {
                "prompt": guided_prompt,
                "images": [base_image_url, mask_image_url],
                "aspect_ratio": _normalize_aspect_ratio(aspect_ratio, NANO_BANANA_ASPECT_RATIOS, "1:1"),
                "resolution": _normalize_resolution(resolution, NANO_BANANA_RESOLUTIONS),
                "output_format": output_fmt,
                "enable_sync_mode": False,
                "enable_base64_output": False,
            }

        output = client.run(model, params)
        images = _extract_output_urls(output)

        if not images:
            raise WaveSpeedServiceError(f"No images were returned by WaveSpeed. Last output: {output!r}")

        return CreateImageResponse(model=model, images=images)
    except Exception as e:
        raise WaveSpeedServiceError(f"Wavespeed inpaint API Error: {str(e)}") from e


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


SEEDANCE_SHOT_MODEL = "bytedance/seedance-2.0/image-to-video"
SEEDANCE_SUBMIT_URL = f"https://api.wavespeed.ai/api/v3/{SEEDANCE_SHOT_MODEL}"


def _wavespeed_headers() -> dict[str, str]:
    api_key = os.getenv("WAVESPEED_API_KEY")
    if not api_key:
        raise WaveSpeedServiceError("WAVESPEED_API_KEY not configured")
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _prediction_data(response_data: object) -> dict[str, object]:
    if not isinstance(response_data, dict):
        raise WaveSpeedServiceError("WaveSpeed returned an invalid prediction response")
    data = response_data.get("data", response_data)
    if not isinstance(data, dict):
        raise WaveSpeedServiceError("WaveSpeed prediction response is missing data")
    return data


def submit_seedance_shot_video(
    image_url: str,
    prompt: str,
    duration: int,
    resolution: str,
    aspect_ratio: str,
    generate_audio: bool,
) -> tuple[str, str]:
    payload = {
        "image": image_url,
        "prompt": prompt,
        "duration": duration,
        "resolution": resolution,
        "aspect_ratio": aspect_ratio,
        "generate_audio": generate_audio,
        "enable_web_search": False,
    }
    try:
        response = requests.post(SEEDANCE_SUBMIT_URL, headers=_wavespeed_headers(), json=payload, timeout=30)
        response.raise_for_status()
        data = _prediction_data(response.json())
    except requests.RequestException as error:
        raise WaveSpeedServiceError(f"Failed to submit Seedance shot video: {error}") from error

    prediction_id = data.get("id")
    urls = data.get("urls")
    result_url = urls.get("get") if isinstance(urls, dict) else None
    if not isinstance(prediction_id, str) or not prediction_id:
        raise WaveSpeedServiceError("WaveSpeed submission did not return a prediction ID")
    if not isinstance(result_url, str) or not result_url:
        result_url = f"https://api.wavespeed.ai/api/v3/predictions/{prediction_id}/result"
    return prediction_id, result_url


def get_seedance_shot_video_result(result_url: str) -> dict[str, object]:
    try:
        response = requests.get(result_url, headers=_wavespeed_headers(), timeout=30)
        response.raise_for_status()
        return _prediction_data(response.json())
    except requests.RequestException as error:
        raise WaveSpeedServiceError(f"Failed to poll Seedance shot video: {error}") from error


def store_seedance_shot_video(video_url: str, project_id: str, shot_id: str, batch_id: str) -> tuple[str, str]:
    video_bytes = _download_file_bytes(video_url)
    storage_path = f"shot-videos/{project_id}/{shot_id}/{batch_id}_{uuid.uuid4().hex}.mp4"
    public_url = _upload_bytes_to_bucket("output-videos", video_bytes, storage_path, "video/mp4")
    return public_url, storage_path


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
