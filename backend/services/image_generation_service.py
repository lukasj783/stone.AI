from core.config import get_settings
from schemas.image_generation import CreateImageRequest, CreateImageResponse
from services.replicate_service import generate_images
from services.wavespeed_service import generate_wavespeed_images


WAVESPEED_FALLBACK_MODELS = {
    "nanobanana": "google/nano-banana-pro/text-to-image-multi",
    "nanobanana2": "google/nano-banana-2/text-to-image",
    "seedream45": "bytedance/seedream-v4.5/text-to-image",
}


def _wavespeed_fallback_payload(payload: CreateImageRequest) -> CreateImageRequest:
    """Translate a Replicate shorthand model to its WaveSpeed equivalent."""
    has_reference_image = bool(payload.image_mapping or payload.image_input)
    fallback_model = "google/nano-banana-pro/edit" if has_reference_image else WAVESPEED_FALLBACK_MODELS.get(
        payload.model,
        "google/nano-banana-2/text-to-image",
    )
    return payload.model_copy(update={"provider": "wavespeed", "model": fallback_model})


def generate_provider_images(payload: CreateImageRequest) -> CreateImageResponse:
    """Send an image request to its configured provider."""
    if payload.provider == "wavespeed":
        return generate_wavespeed_images(payload=payload)

    settings = get_settings()
    try:
        return generate_images(payload=payload, api_token=settings.replicate_api_token)
    except Exception as replicate_error:
        fallback_payload = _wavespeed_fallback_payload(payload)
        try:
            return generate_wavespeed_images(payload=fallback_payload)
        except Exception as wavespeed_error:
            raise RuntimeError(
                f"Replicate generation failed ({replicate_error}); "
                f"WaveSpeed fallback failed ({wavespeed_error})"
            ) from wavespeed_error