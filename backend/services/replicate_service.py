from collections.abc import Iterable, Mapping
import httpx
import replicate

from schemas.image_generation import CreateImageRequest, CreateImageResponse, ImageModel


MODEL_REGISTRY = {
    ImageModel.nanobanana: "google/nano-banana-pro",
    ImageModel.nanobanana2: "google/nano-banana-2",
    ImageModel.seedream45: "bytedance/seedream-4.5",
    ImageModel.qwen: "qwen/qwen-image-2512",
    ImageModel.z_image: "prunaai/z-image-turbo",
    ImageModel.flux_klein: "black-forest-labs/flux-2-klein-9b",
}


class ReplicateConfigurationError(Exception):
    pass


def _to_url(item: object) -> str | None:
    if isinstance(item, str):
        return item if item.startswith("http") else None

    if isinstance(item, bytes):
        decoded = item.decode(errors="ignore")
        return decoded if decoded.startswith("http") else None

    if isinstance(item, Mapping):
        for key in ("url", "uri", "href"):
            value = item.get(key)
            if isinstance(value, str) and value.startswith("http"):
                return value
        for key in ("output", "outputs", "images", "image"):
            nested = item.get(key)
            nested_urls = _normalize_output(nested)
            if nested_urls:
                return nested_urls[0]

    if hasattr(item, "url"):
        value = getattr(item, "url")
        if callable(value):
            try:
                value = value()
            except Exception:
                value = None
        if isinstance(value, str) and value.startswith("http"):
            return value

    as_string = str(item)
    if as_string.startswith("http"):
        return as_string

    return None


def _normalize_output(output: object) -> list[str]:
    if output is None:
        return []

    # First try to extract a URL from the object directly (handles strings, FileOutput, dicts with url keys)
    url = _to_url(output)
    if url:
        return [url]

    # If it's a collection (list, generator) but NOT a string/bytes/mapping, iterate it
    # We exclude Mapping because _to_url should have handled dicts with 'url'/'output' keys.
    # Iterating a dict yields keys, which is rarely what we want for image extraction.
    if isinstance(output, Iterable) and not isinstance(output, (str, bytes, Mapping)):
        urls: list[str] = []
        for item in output:
            urls.extend(_normalize_output(item))
        return urls

    return []


def _build_nanobanana_input(payload: CreateImageRequest) -> dict[str, object]:
    return {
        "prompt": payload.prompt,
        "aspect_ratio": payload.aspect_ratio,
        "output_format": "png",
    }


def _build_nanobanana2_input(payload: CreateImageRequest) -> dict[str, object]:
    return {
        "prompt": payload.prompt,
        "resolution": payload.resolution or "1k",
        "image_input": payload.image_input or [],
        "aspect_ratio": payload.aspect_ratio or "1:1",
        "image_search": payload.image_search,
        "google_search": payload.google_search,
        "output_format": payload.output_format or "jpg",
    }


def _build_seedream_input(payload: CreateImageRequest) -> dict[str, object]:
    # Default values based on the documentation for bytedance/seedream-4.5
    return {
        "prompt": payload.prompt,
        "aspect_ratio": payload.aspect_ratio or "16:9",
        "max_images": payload.num_images,
        "size": "4K",
        "image_input": payload.image_input or [],
        "sequential_image_generation": "disabled",
    }


def _get_dimensions_from_aspect_ratio(aspect_ratio: str) -> tuple[int, int]:
    mapping = {
        "1:1": (1024, 1024),
        "16:9": (1344, 768),
        "9:16": (768, 1344),
        "4:3": (1152, 864),
        "3:4": (864, 1152),
        "3:2": (1216, 832),
        "2:3": (832, 1216),
        "21:9": (1536, 640),
        "9:21": (640, 1536),
    }
    return mapping.get(aspect_ratio, (1024, 1024))


def _build_qwen_input(payload: CreateImageRequest) -> dict[str, object]:
    return {
        "prompt": payload.prompt,
        "aspect_ratio": payload.aspect_ratio or "16:9",
        "go_fast": True,
        "guidance": 4,
        "strength": 0.8,
        "output_format": "webp",
        "output_quality": 95,
        "negative_prompt": " ",
    }


def _build_z_image_input(payload: CreateImageRequest) -> dict[str, object]:
    width, height = _get_dimensions_from_aspect_ratio(payload.aspect_ratio or "16:9")
    return {
        "prompt": payload.prompt,
        "width": width,
        "height": height,
        "go_fast": False,
        "guidance_scale": 0,
        "output_quality": 80,
        "num_inference_steps": 8,
        "output_format": "jpg",
    }


def _build_flux_klein_input(payload: CreateImageRequest) -> dict[str, object]:
    return {
        "prompt": payload.prompt,
        "aspect_ratio": payload.aspect_ratio or "1:1",
        "go_fast": True,
        "output_format": "jpg",
        "output_quality": 95,
        "output_megapixels": "1",
        "images": [],
    }


def generate_images(payload: CreateImageRequest, api_token: str | None) -> CreateImageResponse:
    if not api_token:
        raise ReplicateConfigurationError("REPLICATE_API_TOKEN is not configured")

    # Use a custom timeout to prevent SSL handshake timeouts on slow connections
    client = replicate.Client(
        api_token=api_token, 
        timeout=httpx.Timeout(120.0, connect=60.0)
    )
    model_id = MODEL_REGISTRY[ImageModel(payload.model)]
    image_urls: list[str] = []
    output: object = None

    # Map tags from frontend into `image_input` array
    if payload.image_mapping:
        if payload.image_input is None:
            payload.image_input = []
        for tag, url in payload.image_mapping.items():
            payload.image_input.append(url)
            # Replace tag in prompt with actual URL if the model expects it inline
            payload.prompt = payload.prompt.replace(f"[{tag}]", f" {url} ")

    if payload.model == ImageModel.nanobanana:
        model_input = _build_nanobanana_input(payload)
        for _ in range(payload.num_images):
            output = client.run(model_id, input=model_input)
            image_urls.extend(_normalize_output(output))

    elif payload.model == ImageModel.nanobanana2:
        model_input = _build_nanobanana2_input(payload)
        for _ in range(payload.num_images):
            output = client.run(model_id, input=model_input)
            image_urls.extend(_normalize_output(output))

    elif payload.model == ImageModel.seedream45:
        model_input = _build_seedream_input(payload)
        output = client.run(model_id, input=model_input)
        image_urls.extend(_normalize_output(output))

    elif payload.model == ImageModel.qwen:
        model_input = _build_qwen_input(payload)
        # Qwen produces one image per run usually, but let's loop if multiple requested (though it might be slow)
        # However, checking the text file, it doesn't seem to have a 'num_outputs' param.
        # We will loop for num_images.
        for _ in range(payload.num_images):
            output = client.run(model_id, input=model_input)
            image_urls.extend(_normalize_output(output))

    elif payload.model == ImageModel.z_image:
        model_input = _build_z_image_input(payload)
        for _ in range(payload.num_images):
            output = client.run(model_id, input=model_input)
            image_urls.extend(_normalize_output(output))

    elif payload.model == ImageModel.flux_klein:
        model_input = _build_flux_klein_input(payload)
        for _ in range(payload.num_images):
            output = client.run(model_id, input=model_input)
            image_urls.extend(_normalize_output(output))

    deduped: list[str] = []
    seen: set[str] = set()
    for url in image_urls:
        if url and url not in seen:
            seen.add(url)
            deduped.append(url)
        if len(deduped) >= payload.num_images:
            break

    if not deduped:
        raise RuntimeError(f"No images were returned. Last output: {output!r}")

    return CreateImageResponse(
        model=payload.model,
        images=deduped,
    )
