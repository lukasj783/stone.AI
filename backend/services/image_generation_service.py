import os

from core.config import get_settings
from schemas.image_generation import CreateImageRequest, CreateImageResponse
from services.replicate_service import generate_images
from services.wavespeed_service import generate_wavespeed_images


# App shorthand model names and the WaveSpeed model that serves each one.
WAVESPEED_MODELS = {
    "nanobanana": "google/nano-banana-pro/text-to-image",
    "nanobanana2": "google/nano-banana-2/text-to-image",
    "seedream45": "bytedance/seedream-v4.5/text-to-image",
}
WAVESPEED_DEFAULT_MODEL = "google/nano-banana-2/text-to-image"
WAVESPEED_REFERENCE_MODEL = "google/nano-banana-pro/edit"


def image_provider() -> str:
    """Provider for every image request: WaveSpeed unless IMAGE_PROVIDER=replicate."""
    return "replicate" if os.getenv("IMAGE_PROVIDER", "wavespeed").strip().lower() == "replicate" else "wavespeed"


def to_wavespeed_payload(payload: CreateImageRequest) -> CreateImageRequest:
    """Translate an app shorthand model to its WaveSpeed model; WaveSpeed model ids pass through."""
    if "/" in payload.model:
        return payload.model_copy(update={"provider": "wavespeed"})
    has_reference_image = bool(payload.image_mapping or payload.image_input)
    model = WAVESPEED_REFERENCE_MODEL if has_reference_image else WAVESPEED_MODELS.get(payload.model, WAVESPEED_DEFAULT_MODEL)
    return payload.model_copy(update={"provider": "wavespeed", "model": model})


def generate_provider_images(payload: CreateImageRequest) -> CreateImageResponse:
    """Send an image request to WaveSpeed (or to Replicate with a WaveSpeed retry when IMAGE_PROVIDER=replicate)."""
    if payload.provider == "wavespeed" or image_provider() == "wavespeed":
        return generate_wavespeed_images(payload=to_wavespeed_payload(payload))

    settings = get_settings()
    try:
        return generate_images(payload=payload, api_token=settings.replicate_api_token)
    except Exception as replicate_error:
        try:
            return generate_wavespeed_images(payload=to_wavespeed_payload(payload))
        except Exception as wavespeed_error:
            raise RuntimeError(
                f"Replicate generation failed ({replicate_error}); "
                f"WaveSpeed fallback failed ({wavespeed_error})"
            ) from wavespeed_error
