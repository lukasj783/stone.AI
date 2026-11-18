"""WaveSpeed image-edit models that can render storyboard frames.

Storyboard frames are edits: every shot sends its character, location and prop reference
images (``images``) with the shot prompt, so only edit endpoints are listed here. A shot
with no reference images falls back to ``TEXT_ONLY_FALLBACK_MODEL``, because edit
endpoints require at least one input image.

Parameter sources. The wavespeed.ai model pages could not be fetched when this was
written (the domain was blocked), so each model records how its parameters were confirmed:
- ``verified=True``: parameter names confirmed from WaveSpeed's API docs, via search results.
- ``verified=False``: model ID taken from the model page URL; parameters follow the
  documented sibling model in the same family. Confirm against the model page's schema and
  adjust ``build_params`` if the API rejects a field.

Python SDK usage for each model is in ``backend/wavespeed_examples/``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

DEFAULT_STORYBOARD_MODEL = "google/nano-banana-2/edit"
TEXT_ONLY_FALLBACK_MODEL = "google/nano-banana-2/text-to-image"

# 16:9 at the smallest size every documented Seedream edit version accepts
# (v4.5: 1024-4096 per side; v5.0 Lite: at least 3,686,400 pixels).
SEEDREAM_SIZES = {"16:9": "2560*1440", "9:16": "1440*2560", "1:1": "2048*2048", "4:3": "2304*1728", "3:4": "1728*2304"}
GPT_IMAGE_ASPECT_RATIOS = {"1:1", "3:2", "2:3", "3:4", "4:3", "16:9", "9:16"}
NANO_BANANA_ASPECT_RATIOS = {"1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"}


def _pick(value: str | None, allowed: set[str], fallback: str) -> str:
    normalized = (value or "").strip().lower()
    return normalized if normalized in allowed else fallback


def _output_format(value: str | None, allowed: set[str]) -> str:
    normalized = (value or "png").strip().lower()
    normalized = "jpeg" if normalized == "jpg" else normalized
    return normalized if normalized in allowed else "png"


def _gpt_image_params(aspect_ratio: str | None, resolution: str | None, output_format: str | None) -> dict[str, object]:
    return {
        "aspect_ratio": _pick(aspect_ratio, GPT_IMAGE_ASPECT_RATIOS, "16:9"),
        "resolution": _pick(resolution, {"1k", "2k", "4k"}, "1k"),
        "output_format": _output_format(output_format, {"png", "jpeg", "webp"}),
    }


def _gpt_image_26_params(aspect_ratio: str | None, resolution: str | None, output_format: str | None) -> dict[str, object]:
    """GPT Image 2.6 edit (Sunburst and Flare), as WaveSpeed's own examples (quality medium, complexity high).

    The example also sends frame_count / frame_duration_ms, which look like settings for an
    animated multi-frame result; a storyboard frame is one still, so they are left out.
    """
    return {**_gpt_image_params(aspect_ratio, resolution, output_format), "quality": "medium", "complexity": "high"}


def _nano_banana_params(aspect_ratio: str | None, resolution: str | None, output_format: str | None) -> dict[str, object]:
    return {
        "aspect_ratio": _pick(aspect_ratio, NANO_BANANA_ASPECT_RATIOS, "16:9"),
        "resolution": _pick(resolution, {"0.5k", "1k", "2k", "4k"}, "1k"),
        "output_format": _output_format(output_format, {"png", "jpeg"}),
    }


def _nano_banana_21_params(aspect_ratio: str | None, resolution: str | None, output_format: str | None) -> dict[str, object]:
    """Nano Banana 2.1 edit, as WaveSpeed's own example: web and image search switched off.

    Storyboard frames must follow the reference images only, never searched images.
    """
    return {
        **_nano_banana_params(aspect_ratio, resolution, output_format),
        "enable_web_search": False,
        "enable_image_search": False,
    }


def _seedream_params(aspect_ratio: str | None, resolution: str | None, output_format: str | None) -> dict[str, object]:
    """Seedream edit: optional pixel ``size`` (no aspect_ratio/resolution) and ``output_format``.

    ``output_format`` is confirmed by WaveSpeed's own Seedream v5.0 Lite Edit example.
    """
    del resolution
    return {
        "size": SEEDREAM_SIZES.get((aspect_ratio or "").strip(), SEEDREAM_SIZES["16:9"]),
        "output_format": _output_format(output_format, {"png", "jpeg"}),
    }


def _seedream_flash_params(aspect_ratio: str | None, resolution: str | None, output_format: str | None) -> dict[str, object]:
    """Seedream v5.0 Flash edit, as WaveSpeed's own example: aspect_ratio + resolution, no ``size``."""
    return {
        "aspect_ratio": _pick(aspect_ratio, NANO_BANANA_ASPECT_RATIOS, "16:9"),
        "resolution": _pick(resolution, {"1k", "2k", "4k"}, "1k"),
        "output_format": _output_format(output_format, {"png", "jpeg"}),
    }


def _seedream_v55_params(aspect_ratio: str | None, resolution: str | None, output_format: str | None) -> dict[str, object]:
    """Seedream v5.5 edit: aspect_ratio + resolution + background, not a pixel ``size``.

    Field names are confirmed by WaveSpeed's own v5.5 example (aspect_ratio "1:1",
    resolution "1k", output_format "png", background "auto"). Other allowed values are
    assumed to match the common aspect-ratio and 1k/2k/4k sets.
    """
    return {
        "aspect_ratio": _pick(aspect_ratio, NANO_BANANA_ASPECT_RATIOS, "16:9"),
        "resolution": _pick(resolution, {"1k", "2k", "4k"}, "1k"),
        "output_format": _output_format(output_format, {"png", "jpeg"}),
        "background": "auto",
    }


@dataclass(frozen=True)
class StoryboardModel:
    id: str
    label: str
    family: str
    max_images: int
    verified: bool
    page_url: str
    notes: str
    _extra_params: Callable[[str | None, str | None, str | None], dict[str, object]]

    def build_params(
        self,
        prompt: str,
        images: list[str],
        aspect_ratio: str | None = "16:9",
        resolution: str | None = "1k",
        output_format: str | None = "png",
    ) -> dict[str, object]:
        """Request body for this model; reference images beyond its limit are dropped."""
        return {
            "prompt": prompt,
            "images": images[: self.max_images],
            **self._extra_params(aspect_ratio, resolution, output_format),
            "enable_sync_mode": False,
            "enable_base64_output": False,
        }


STORYBOARD_MODELS: dict[str, StoryboardModel] = {model.id: model for model in (
    StoryboardModel(
        id="google/nano-banana-2/edit",
        label="Nano Banana 2 Edit",
        family="Google Nano Banana",
        max_images=14,
        verified=True,
        page_url="https://wavespeed.ai/models/google/nano-banana-2/edit",
        notes="Default. Up to 14 reference images; resolution 0.5k-4k (2k costs 1.5x, 4k 2x).",
        _extra_params=_nano_banana_params,
    ),
    StoryboardModel(
        id="google/nano-banana-2.1/edit",
        label="Nano Banana 2.1 Edit",
        family="Google Nano Banana",
        max_images=14,
        verified=True,
        page_url="https://wavespeed.ai/models/google/nano-banana-2.1/edit",
        notes="Confirmed from WaveSpeed's example: aspect_ratio, resolution, output_format, enable_web_search, enable_image_search (both sent as false).",
        _extra_params=_nano_banana_21_params,
    ),
    StoryboardModel(
        id="openai/gpt-image-2.5-sunburst/edit",
        label="GPT Image 2.5 Sunburst Edit",
        family="OpenAI GPT Image",
        max_images=16,
        verified=True,
        page_url="https://wavespeed.ai/models/openai/gpt-image-2.5-sunburst/edit",
        notes="Up to 16 reference images; aspect ratio defaults to the first image's when omitted.",
        _extra_params=_gpt_image_params,
    ),
    StoryboardModel(
        id="openai/gpt-image-2.6-sunburst/edit",
        label="GPT Image 2.6 Sunburst Edit",
        family="OpenAI GPT Image",
        max_images=16,
        verified=True,
        page_url="https://wavespeed.ai/models/openai/gpt-image-2.6-sunburst/edit",
        notes="Confirmed from WaveSpeed's example: aspect_ratio, resolution, quality (medium), complexity (high), output_format. Its frame_count/frame_duration_ms (animation) are not sent. 16-image limit assumed from GPT Image 2.5.",
        _extra_params=_gpt_image_26_params,
    ),
    StoryboardModel(
        id="openai/gpt-image-2.6-flare/edit",
        label="GPT Image 2.6 Flare Edit",
        family="OpenAI GPT Image",
        max_images=16,
        verified=True,
        page_url="https://wavespeed.ai/models/openai/gpt-image-2.6-flare/edit",
        notes="Confirmed from WaveSpeed's example: same parameters as 2.6 Sunburst (aspect_ratio, resolution, quality medium, complexity high, output_format). Its frame_count/frame_duration_ms (animation) are not sent. 16-image limit assumed.",
        _extra_params=_gpt_image_26_params,
    ),
    StoryboardModel(
        id="bytedance/seedream-v5.0-lite/edit",
        label="Seedream v5.0 Lite Edit",
        family="ByteDance Seedream",
        max_images=10,
        verified=True,
        page_url="https://wavespeed.ai/models/bytedance/seedream-v5.0-lite/edit",
        notes="Confirmed from WaveSpeed's example (prompt, images, output_format). Optional size is width*height, 3,686,400-16,777,216 pixels.",
        _extra_params=_seedream_params,
    ),
    StoryboardModel(
        id="bytedance/seedream-v5.0-flash/edit",
        label="Seedream v5.0 Flash Edit",
        family="ByteDance Seedream",
        max_images=10,
        verified=True,
        page_url="https://wavespeed.ai/models/bytedance/seedream-v5.0-flash/edit",
        notes="Confirmed from WaveSpeed's example: aspect_ratio, resolution, output_format (no size). 10-image limit and values beyond 1:1/1k/jpeg assumed.",
        _extra_params=_seedream_flash_params,
    ),
    StoryboardModel(
        id="bytedance/seedream-v5.5/edit",
        label="Seedream v5.5 Edit",
        family="ByteDance Seedream",
        max_images=10,
        verified=True,
        page_url="https://wavespeed.ai/models/bytedance/seedream-v5.5/edit",
        notes="Confirmed from WaveSpeed's example: aspect_ratio, resolution, output_format, background (no size). Allowed values beyond 1:1/1k are assumed.",
        _extra_params=_seedream_v55_params,
    ),
)}


def storyboard_model(model_id: str | None) -> StoryboardModel:
    """Resolve a storyboard model ID, falling back to the default for empty input."""
    if not model_id:
        return STORYBOARD_MODELS[DEFAULT_STORYBOARD_MODEL]
    model = STORYBOARD_MODELS.get(model_id)
    if not model:
        raise ValueError(f"Unknown storyboard model: {model_id}")
    return model
