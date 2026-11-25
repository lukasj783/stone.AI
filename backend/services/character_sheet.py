"""Character model sheet: one generated image per character, for people and for storyboards.

The image model draws the whole sheet in one pass, so the face and every angle of the body
come from the same render and agree with each other. Layout asked of the model (16:9,
plain neutral background, flat light, no text):

    ┌──────────────┬────────────────────────────────────────────────┐
    │              │                                                │
    │  FACE        │  FRONT     LEFT 3/4     LEFT PROFILE     BACK    │
    │  CLOSE-UP    │  full body, same scale, feet on one baseline    │
    │              │                                                │
    └──────────────┴────────────────────────────────────────────────┘

A sheet can come from a prompt, or from up to four reference images (each tagged face,
outfit or style) plus a prompt. Script characters always add their script profile. On the
Character page the sheet is drafted before the character exists, and saving creates the
character with the chosen draft.

Sheets are drawn by the same WaveSpeed image-edit models as storyboard frames
(services/storyboard_models.py), never Replicate. Edit models need an input image, so
image 1 is always a blank 16:9 grey canvas the sheet is drawn on; reference images follow
it. That keeps the chosen model in use for prompt-only sheets and fixes the sheet's shape
and plain background.

Every sheet the model returns is checked (services/sheet_review.py) for a face close-up
and all four full-body views of one person; a sheet that fails is regenerated with the
problems named, and after the last attempt the request fails instead of keeping an
incomplete sheet.

Every generation is kept as a candidate. A character uses exactly one approved sheet; its
first candidate is approved automatically. Approving cuts the face panel out of the sheet
(no new generation, so nothing about the character changes) and stores it as the face
close-up: storyboards send the sheet for identity and costume, and the face crop so
close-ups keep a sharp likeness.
"""

from __future__ import annotations

import io
import random
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import logging
import os

import httpx
from PIL import Image
from supabase import Client

from core.supabase_client import require_supabase_client
from core.provider_errors import describe_error
from core.supabase_records import as_record, as_records, maybe_single_record
from schemas.image_generation import CreateImageRequest
from services.character_views import build_script_character_profile, effective_character_profile, is_on_camera
from services.script_config import character_type_map
from services.image_generation_service import generate_provider_images
from services.storyboard_models import DEFAULT_STORYBOARD_MODEL, storyboard_model
from services.sheet_review import (
    FACE_PANEL_SHARE,
    SheetReview,
    background_color,
    column_runs,
    foreground_mask,
    review_sheet,
)
from services.visual_style import resolve_character_visual_style, resolve_visual_style

logger = logging.getLogger(__name__)

SHEET_ROLE = "model_sheet"
CANDIDATE_ROLE = "model_sheet_candidate"
FACE_ROLE = "face_closeup"
STORAGE_BUCKET = "output-images"

SHEET_ASPECT_RATIO = "16:9"
SHEET_RESOLUTION = "2k"
MAX_REFERENCE_IMAGES = 4
REFERENCE_TAGS = ("face", "outfit", "style")
# Generations per request before giving up on a sheet that fails the check.
DEFAULT_SHEET_ATTEMPTS = 3
DEFAULT_SHEET_MODEL = DEFAULT_STORYBOARD_MODEL
SHEET_PROVIDER = "wavespeed"
# Blank drawing surface sent as image 1: plain light grey, the sheet's requested background.
CANVAS_SIZE = (1920, 1080)
CANVAS_COLOR = (214, 214, 212)
CANVAS_PATH = "character-sheets/canvas/blank_16x9_v1.png"
FACE_CROP_ASPECT = 3 / 4  # width / height

REFERENCE_TAG_INSTRUCTIONS = {
    "face": "use this person's face and identity: facial structure, skin tone, eyes, nose, lips, hair and any marks",
    "outfit": "use this clothing, footwear and accessories, fitted to the character",
    "style": "use only the art style, medium, rendering and color treatment; do not copy the subject",
}

MODEL_SHEET_PROMPT = """\
You are a senior character designer making the production model sheet for a film.

{character}
{references}
Create ONE character model sheet image, landscape, showing this ONE character only:
- Left third: a large head-and-shoulders face close-up, looking straight into the camera
  with a calm neutral expression, eyes open and in sharp focus.
- Right two thirds: a full-body turnaround in one horizontal row, left to right:
  front view; left three-quarter view (turned 45 degrees toward their left);
  left side profile; back view.
  All four figures at the same scale and height, feet on the same baseline, neutral
  standing pose with relaxed arms, the complete body visible from head to feet.

Every figure and the close-up is the same person: identical face, hairstyle, body
proportions, clothing, accessories, footwear and colors. Do not mirror or flip the
character; keep asymmetric details on the same side of the body.

One plain, uniform, neutral light-grey studio background across the whole sheet. Flat,
even, soft front lighting with no dramatic shadows or colored light, so the character can
be relit in any scene. Leave clear empty background between the close-up and the figures
and between neighbouring figures so nothing touches or overlaps.

No text, names, labels, numbers, arrows, color swatches, panels, borders, divider lines,
floor shadows, props or other people.
"""


@dataclass(frozen=True)
class SheetReference:
    url: str
    tag: str


def normalize_reference_tag(tag: object) -> str:
    value = str(tag or "").strip().casefold()
    return value if value in REFERENCE_TAGS else "face"


CANVAS_NOTE = (
    "Image 1 is an empty grey canvas, not a reference: draw the whole model sheet on it, "
    "filling the canvas, and keep its plain grey background."
)


def _references_block(references: list[SheetReference]) -> str:
    """Images after the canvas, numbered as the model receives them (the canvas is image 1)."""
    if not references:
        return ""
    lines = ["\nReference images (attached in this order, after the canvas):"]
    lines.extend(
        f"- Image {index}: {REFERENCE_TAG_INSTRUCTIONS[reference.tag]}."
        for index, reference in enumerate(references, start=2)
    )
    lines.append("Where a reference and the character facts disagree on identity, follow the reference image.")
    lines.append(
        "Do not return or retouch a reference image: draw a NEW model sheet in the layout below, "
        "with the face close-up AND all four full-body views."
    )
    return "\n".join(lines) + "\n"


def build_model_sheet_prompt(character_block: str, direction: str = "", references: list[SheetReference] | None = None) -> str:
    character = character_block.strip()
    if direction.strip():
        character += f"\n\nDirection from the filmmaker (follow it):\n{direction.strip()}"
    references_block = _references_block(list(references or []))
    return MODEL_SHEET_PROMPT.format(character=character, references=f"\n{CANVAS_NOTE}\n{references_block}")


def retry_note(problems: list[str]) -> str:
    """Prompt addition after a rejected attempt, naming what was wrong."""
    return (
        "\n\nIMPORTANT: a previous attempt was rejected because it "
        + "; ".join(problems)
        + ". This image MUST contain the large face close-up on the left AND four full-body figures "
        "on the right: front, three-quarter, side profile and back, each from head to feet."
    )


PROFILE_DETAIL_FIELDS = ("role", "age", "gender", "race", "appearance", "personality")


def character_block_for(character: dict[str, Any], visual_style: Any, direction: str, has_references: bool) -> str:
    """Script facts and style for the prompt. A character known only by name can still be
    designed from a direction prompt or reference images, but not from the name alone."""
    effective = effective_character_profile(character)
    stored = effective.get("metadata")
    metadata: dict[str, Any] = stored if isinstance(stored, dict) else {}
    has_details = (
        any(effective.get(field) not in (None, "") for field in PROFILE_DETAIL_FIELDS)
        or bool(effective.get("physical"))
        or bool(str(metadata.get("image_prompt") or "").strip())
    )
    if not has_details and not direction.strip() and not has_references:
        raise ValueError(
            "The script has no visual details for this character. Describe them in the prompt or add a reference image."
        )
    return build_script_character_profile(character, visual_style, character_type_map())


# --------------------------------------------------------------------------- face crop


def face_panel_box(image: Image.Image, face_box: list[int] | None = None) -> tuple[int, int, int, int]:
    """Box around the face close-up of a model sheet, as a 3:4 portrait.

    ``face_box`` is where the sheet review saw the close-up ([ymin, xmin, ymax, xmax] on a
    0-1000 scale). Without it the close-up is found from the background in the left third,
    and failing that the whole left panel is used, which still holds the face.
    """
    rgb = image.convert("RGB")
    width, height = rgb.size
    if face_box:
        ymin, xmin, ymax, xmax = face_box
        box = (xmin * width // 1000, ymin * height // 1000, xmax * width // 1000, ymax * height // 1000)
        bounds_width = width
    else:
        bounds_width = max(1, int(width * FACE_PANEL_SHARE))
        mask = foreground_mask(rgb.crop((0, 0, bounds_width, height)), background_color(rgb))
        box = (0, 0, bounds_width, height)
        runs = column_runs(mask, max(2, int(bounds_width * 0.25)))
        if runs:
            start, end = runs[0]
            bbox = mask.crop((start, 0, end, height)).getbbox()
            if bbox and bbox[3] - bbox[1] >= height * 0.3:
                box = (start + bbox[0], bbox[1], start + bbox[2], bbox[3])

    left, top, right, bottom = box
    pad = int(max(right - left, bottom - top) * 0.06)
    left, top, right, bottom = max(0, left - pad), max(0, top - pad), min(bounds_width, right + pad), min(height, bottom + pad)
    # Make it a 3:4 portrait around the same center without leaving the face panel, so the
    # first turnaround figure never ends up in the crop.
    crop_width, crop_height = max(1, right - left), max(1, bottom - top)
    if crop_width / crop_height < FACE_CROP_ASPECT:
        crop_width = int(crop_height * FACE_CROP_ASPECT)
    else:
        crop_height = int(crop_width / FACE_CROP_ASPECT)
    if crop_width > bounds_width:
        crop_width, crop_height = bounds_width, int(bounds_width / FACE_CROP_ASPECT)
    if crop_height > height:
        crop_width, crop_height = int(height * FACE_CROP_ASPECT), height
    center_x, center_y = (left + right) // 2, (top + bottom) // 2
    left = min(max(0, center_x - crop_width // 2), bounds_width - crop_width)
    top = min(max(0, center_y - crop_height // 2), height - crop_height)
    return left, top, left + crop_width, top + crop_height


def crop_face_panel(image: Image.Image, face_box: list[int] | None = None) -> Image.Image:
    return image.convert("RGB").crop(face_panel_box(image, face_box))


# --------------------------------------------------------------------------- storage


def _download(url: str, tries: int = 2) -> bytes:
    """Fetch a generated image; one slow read is retried before giving up."""
    for attempt in range(1, tries + 1):
        try:
            response = httpx.get(url, timeout=httpx.Timeout(30.0, read=120.0), follow_redirects=True)
            response.raise_for_status()
            return response.content
        except httpx.TimeoutException:
            if attempt == tries:
                raise RuntimeError("Downloading the generated image from WaveSpeed timed out") from None
    raise AssertionError("unreachable")


def upload_reference_image(content: bytes, content_type: str | None) -> str:
    """Store an uploaded reference so the image provider can fetch it by public URL."""
    supabase = require_supabase_client()
    extension = {"image/jpeg": "jpg", "image/webp": "webp"}.get(content_type or "", "png")
    path = f"uploaded-references/{uuid.uuid4().hex}.{extension}"
    supabase.storage.from_(STORAGE_BUCKET).upload(
        file=content, path=path, file_options={"content-type": content_type or "image/png"},
    )
    return supabase.storage.from_(STORAGE_BUCKET).get_public_url(path)


_canvas_url: str | None = None


def blank_canvas_url() -> str:
    """Public URL of the blank canvas, uploaded once (overwriting is harmless: same pixels)."""
    global _canvas_url
    if _canvas_url:
        return _canvas_url
    supabase = require_supabase_client()
    buffer = io.BytesIO()
    Image.new("RGB", CANVAS_SIZE, CANVAS_COLOR).save(buffer, "PNG")
    try:
        supabase.storage.from_(STORAGE_BUCKET).upload(
            file=buffer.getvalue(), path=CANVAS_PATH, file_options={"content-type": "image/png", "upsert": "true"},
        )
    except Exception as error:  # already uploaded by another worker is fine
        logger.info("Canvas upload skipped: %s", error)
    _canvas_url = supabase.storage.from_(STORAGE_BUCKET).get_public_url(CANVAS_PATH)
    return _canvas_url


def sheet_model_id(model: str | None) -> str:
    """A WaveSpeed storyboard model ID; anything else (old Replicate names) is rejected."""
    return storyboard_model(model or DEFAULT_SHEET_MODEL).id


def _store_image_asset(
    supabase: Client,
    project_id: str,
    character_id: str,
    image: Image.Image,
    *,
    kind: str,
    name: str,
    metadata: dict[str, Any],
) -> tuple[str, str]:
    # JPEG at high quality: a 2K sheet is ~5x smaller than PNG, so it uploads (and is fetched
    # again as a storyboard reference) much faster, with no visible loss.
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, "JPEG", quality=92, optimize=True)
    content = buffer.getvalue()
    storage_path = f"character-sheets/{character_id}/{kind}_{uuid.uuid4().hex}.jpg"
    try:
        supabase.storage.from_(STORAGE_BUCKET).upload(file=content, path=storage_path, file_options={"content-type": "image/jpeg"})
    except httpx.TimeoutException:
        raise RuntimeError("Saving the character sheet to storage timed out; check the connection and try again") from None
    url = supabase.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)
    try:
        created = as_records(supabase.table("assets").insert({
            "project_id": project_id,
            "type": "image",
            "source": "generation",
            "name": name,
            "url": url,
            "storage_path": storage_path,
            "mime_type": "image/jpeg",
            "size_bytes": len(content),
            "width": image.width,
            "height": image.height,
            "metadata": {**metadata, "character_id": character_id, "kind": kind},
        }).execute().data)
        if not created:
            raise RuntimeError(f"Failed to create the {kind.replace('_', ' ')} asset")
    except Exception:
        supabase.storage.from_(STORAGE_BUCKET).remove([storage_path])
        raise
    return str(created[0]["id"]), url


def _link(
    supabase: Client,
    project_id: str,
    character_id: str,
    asset_id: str,
    role: str,
    metadata: dict[str, Any],
    *,
    replace: bool,
) -> None:
    """Link an asset to the character; ``replace`` makes it the only link for the role."""
    if replace:
        supabase.table("asset_links").delete().eq("project_id", project_id).eq("target_type", "character").eq(
            "target_id", character_id
        ).eq("role", role).execute()
    supabase.table("asset_links").insert({
        "project_id": project_id,
        "asset_id": asset_id,
        "target_type": "character",
        "target_id": character_id,
        "role": role,
        "sort_order": 0,
        "metadata": metadata,
    }).execute()


def _update_character_metadata(supabase: Client, project_id: str, character_id: str, changes: dict[str, Any], **columns: Any) -> None:
    row = as_record(supabase.table("characters").select("metadata").eq("id", character_id).eq(
        "project_id", project_id
    ).single().execute().data)
    stored = row.get("metadata") if row else None
    metadata = dict(stored) if isinstance(stored, dict) else {}
    metadata.update(changes)
    supabase.table("characters").update({**columns, "metadata": metadata}).eq("id", character_id).eq("project_id", project_id).execute()


def _has_approved_sheet(supabase: Client, project_id: str, character_id: str) -> bool:
    links = supabase.table("asset_links").select("id").eq("project_id", project_id).eq("target_type", "character").eq(
        "target_id", character_id
    ).eq("role", SHEET_ROLE).limit(1).execute()
    return bool(as_records(links.data))


# --------------------------------------------------------------------------- orchestration


def load_project_character(project_id: str, character_id: str) -> dict[str, Any]:
    """Any character in the project: script-extracted or created on the Character page."""
    supabase = require_supabase_client()
    character = maybe_single_record(supabase.table("characters").select(
        "id, name, character_type, on_camera, role, age, gender, race, appearance, personality, "
        "physical, type_details, tags, metadata"
    ).eq("id", character_id).eq("project_id", project_id).maybe_single().execute())
    if not character:
        raise ValueError("Character was not found in this project")
    return character


class VoiceOnlyCharacterError(ValueError):
    """The character is only heard (a narrator), so there is nothing to draw."""


def ensure_drawable(character: dict[str, Any]) -> None:
    if not is_on_camera(character, character_type_map()):
        raise VoiceOnlyCharacterError(
            f"{character.get('name') or 'This character'} is voice only, so they get no character sheet and "
            "storyboards never draw them. To show them on screen, turn on \"Appears on screen\" in their "
            "profile or change their type."
        )


class SheetIncompleteError(ValueError):
    """Every attempt lacked the face close-up or part of the turnaround."""


def sheet_attempts() -> int:
    try:
        return max(1, min(5, int(os.getenv("CHARACTER_SHEET_ATTEMPTS", str(DEFAULT_SHEET_ATTEMPTS)))))
    except ValueError:
        return DEFAULT_SHEET_ATTEMPTS


def _render_sheet(
    project_id: str,
    owner_id: str,
    owner_name: str,
    prompt: str,
    references: list[SheetReference],
    *,
    model: str,
    style_label: str,
    settings: dict[str, Any],
) -> tuple[str, str, Image.Image, dict[str, Any]]:
    """Generate one sheet image, check it, and store it as an asset tracked by a generation job.

    A sheet that fails the check is regenerated with the problems named, up to
    ``CHARACTER_SHEET_ATTEMPTS`` times; then ``SheetIncompleteError`` is raised.
    Returns the asset id, its URL, the image, and the metadata recorded on the asset
    (the generation inputs and the review, so the sheet can be redrawn and cropped later).
    """
    model = sheet_model_id(model)
    seed = random.SystemRandom().randint(0, 2_147_483_647)
    payload = CreateImageRequest(
        model=model,
        provider=SHEET_PROVIDER,
        prompt=prompt,
        aspect_ratio=SHEET_ASPECT_RATIO,
        resolution=SHEET_RESOLUTION,
        num_images=1,
        output_format="png",
        image_input=[blank_canvas_url(), *(reference.url for reference in references)],
        project_id=project_id,
        seed=seed,
        visual_style=style_label,
    )
    settings = {
        **settings,
        "kind": SHEET_ROLE,
        "references": [{"url": reference.url, "tag": reference.tag} for reference in references],
        "seed": seed,
        "visual_style": style_label,
        "model": model,
    }
    supabase = require_supabase_client()
    jobs = as_records(supabase.table("generation_jobs").insert({
        "project_id": project_id,
        "kind": "character",
        "model": model,
        "prompt": prompt,
        "settings": settings,
        "status": "running",
    }).execute().data)
    if not jobs:
        raise RuntimeError("Failed to create the character sheet generation job")
    job_id = str(jobs[0]["id"])
    reference_pairs = [(reference.url, reference.tag) for reference in references]
    attempts: list[dict[str, Any]] = []
    try:
        sheet: Image.Image | None = None
        review: SheetReview | None = None
        attempt_prompt = prompt
        for attempt in range(1, sheet_attempts() + 1):
            response = generate_provider_images(payload.model_copy(update={"prompt": attempt_prompt}))
            if not response.images:
                raise RuntimeError("The image model returned no character sheet")
            with Image.open(io.BytesIO(_download(response.images[0]))) as generated:
                sheet = generated.convert("RGB")
            review = review_sheet(sheet, response.images[0], reference_pairs)
            attempts.append({"attempt": attempt, **review.as_record()})
            if review.ok:
                break
            logger.info("Character sheet attempt %s rejected: %s", attempt, "; ".join(review.problems))
            attempt_prompt = prompt + retry_note(review.problems)
        if sheet is None or review is None or not review.ok:
            problems = "; ".join(review.problems) if review else "no image"
            raise SheetIncompleteError(
                f"The image model did not return a complete character sheet after {len(attempts)} tries ({problems}). "
                "Try again, or simplify the prompt or reference images."
            )
        metadata = {**settings, "generation_job_id": job_id, "review": review.as_record(), "attempts": len(attempts)}
        asset_id, url = _store_image_asset(
            supabase, project_id, owner_id, sheet,
            kind=SHEET_ROLE, name=f"{owner_name} - Character sheet", metadata=metadata,
        )
        supabase.table("generation_jobs").update({
            "status": "complete",
            "completed_at": datetime.now(UTC).isoformat(),
            "settings": {**settings, "review_attempts": attempts},
        }).eq("id", job_id).execute()
    except Exception as error:
        supabase.table("generation_jobs").update({
            "status": "failed",
            "error_message": describe_error(error),
            "completed_at": datetime.now(UTC).isoformat(),
            "settings": {**settings, "review_attempts": attempts},
        }).eq("id", job_id).execute()
        raise
    return asset_id, url, sheet, metadata


def generate_model_sheet(
    project_id: str,
    character_id: str,
    *,
    direction: str = "",
    references: list[SheetReference] | None = None,
    model: str | None = None,
    visual_style: str | None = None,
    approve: bool | None = None,
) -> dict[str, Any]:
    """Generate one model sheet for an existing character and keep it as a candidate.

    ``approve`` True makes it the character's sheet, False never does, and None (default)
    approves it only when the character has no approved sheet yet.
    """
    references = list(references or [])[:MAX_REFERENCE_IMAGES]
    sheet_model_id(model)  # reject an unknown model before any work
    character = load_project_character(project_id, character_id)
    ensure_drawable(character)
    style = resolve_character_visual_style(character, visual_style)
    prompt = build_model_sheet_prompt(
        character_block_for(character, style, direction, bool(references)), direction, references,
    )
    asset_id, url, sheet, metadata = _render_sheet(
        project_id, character_id, str(character.get("name") or "Character"), prompt, references,
        model=model or DEFAULT_SHEET_MODEL, style_label=style.label,
        settings={"character_id": character_id, "direction": direction},
    )
    supabase = require_supabase_client()
    _link(supabase, project_id, character_id, asset_id, CANDIDATE_ROLE, metadata, replace=False)

    should_approve = approve if approve is not None else not _has_approved_sheet(supabase, project_id, character_id)
    result: dict[str, Any] = {
        "character_id": character_id,
        "sheet_asset_id": asset_id,
        "sheet_url": url,
        "generation_job_id": metadata["generation_job_id"],
        "review": metadata["review"],
        "approved": False,
        "face_closeup_asset_id": None,
        "face_closeup_url": None,
    }
    if should_approve:
        result.update(approve_model_sheet(project_id, character_id, asset_id, sheet=sheet))
    return result


DRAFT_OWNER = "drafts"


def draft_model_sheet(
    project_id: str,
    *,
    description: str = "",
    references: list[SheetReference] | None = None,
    model: str | None = None,
    visual_style: str | None = None,
) -> dict[str, Any]:
    """Generate a sheet before the character exists (the Character page).

    The sheet is stored as a project asset; ``create_character_from_sheet`` later creates
    the character, links the chosen draft and approves it.
    """
    references = list(references or [])[:MAX_REFERENCE_IMAGES]
    sheet_model_id(model)
    description = description.strip()
    if not description and not references:
        raise ValueError("Describe the character or add a reference image.")
    style = resolve_visual_style(visual_style)
    character_block = "\n\n".join(part for part in (
        f"Character description:\n{description}" if description else "",
        style.prompt_block(),
    ) if part)
    prompt = build_model_sheet_prompt(character_block, "", references)
    asset_id, url, _, metadata = _render_sheet(
        project_id, DRAFT_OWNER, "New character", prompt, references,
        model=model or DEFAULT_SHEET_MODEL, style_label=style.label,
        settings={"draft": True, "direction": description},
    )
    return {
        "sheet_asset_id": asset_id,
        "sheet_url": url,
        "generation_job_id": metadata["generation_job_id"],
        "review": metadata["review"],
    }


def create_character_from_sheet(
    project_id: str,
    sheet_asset_id: str,
    name: str,
    role: str | None = None,
    description: str | None = None,
) -> dict[str, Any]:
    """Create a character from a draft sheet and make that sheet its approved one."""
    supabase = require_supabase_client()
    assets = as_records(supabase.table("assets").select("id, metadata").eq("id", sheet_asset_id).eq(
        "project_id", project_id
    ).limit(1).execute().data)
    stored = assets[0].get("metadata") if assets else None
    metadata: dict[str, Any] = stored if isinstance(stored, dict) else {}
    if not assets or metadata.get("kind") != SHEET_ROLE or not metadata.get("draft"):
        raise ValueError("That draft character sheet was not found in this project")

    created = as_records(supabase.table("characters").insert({
        "project_id": project_id,
        "name": name.strip(),
        "role": (role or "").strip() or None,
        "appearance": (description or "").strip() or None,
        "metadata": {"source": "manual", "visual_style": metadata.get("visual_style")},
    }).execute().data)
    if not created:
        raise RuntimeError("Failed to create the character")
    character_id = str(created[0]["id"])
    link_metadata = {key: value for key, value in metadata.items() if key not in ("draft", "character_id", "kind")}
    _link(supabase, project_id, character_id, sheet_asset_id, CANDIDATE_ROLE, link_metadata, replace=False)
    result = approve_model_sheet(project_id, character_id, sheet_asset_id)
    return {"character_id": character_id, **result}


def approve_model_sheet(
    project_id: str,
    character_id: str,
    asset_id: str,
    *,
    sheet: Image.Image | None = None,
) -> dict[str, Any]:
    """Make a candidate the character's sheet and cut its face close-up out of it."""
    supabase = require_supabase_client()
    candidates = as_records(supabase.table("asset_links").select("metadata").eq("project_id", project_id).eq(
        "target_type", "character"
    ).eq("target_id", character_id).eq("role", CANDIDATE_ROLE).eq("asset_id", asset_id).limit(1).execute().data)
    if not candidates:
        raise ValueError("That character sheet was not found for this character")
    stored_metadata = candidates[0].get("metadata")
    candidate_metadata: dict[str, Any] = stored_metadata if isinstance(stored_metadata, dict) else {}
    assets = as_records(supabase.table("assets").select("url").eq("id", asset_id).limit(1).execute().data)
    if not assets:
        raise ValueError("The character sheet image no longer exists")
    url = str(assets[0]["url"])
    if sheet is None:
        with Image.open(io.BytesIO(_download(url))) as stored:
            sheet = stored.convert("RGB")

    character = effective_character_profile(load_project_character(project_id, character_id))
    name = str(character.get("name") or "Character")
    stored_review = candidate_metadata.get("review")
    review: dict[str, Any] = stored_review if isinstance(stored_review, dict) else {}
    face_box = review.get("face_box") if isinstance(review.get("face_box"), list) else None
    face_metadata = {"source_sheet_asset_id": asset_id, "crop_box": list(face_panel_box(sheet, face_box))}
    face_asset_id, face_url = _store_image_asset(
        supabase, project_id, character_id, crop_face_panel(sheet, face_box),
        kind=FACE_ROLE, name=f"{name} - Face close-up", metadata=face_metadata,
    )
    _link(supabase, project_id, character_id, face_asset_id, FACE_ROLE, face_metadata, replace=True)
    _link(supabase, project_id, character_id, asset_id, SHEET_ROLE, candidate_metadata, replace=True)

    approved_at = datetime.now(UTC).isoformat()
    changes: dict[str, Any] = {SHEET_ROLE: {
        "asset_id": asset_id,
        "url": url,
        "face_asset_id": face_asset_id,
        "face_url": face_url,
        "approved_at": approved_at,
        "generation_job_id": candidate_metadata.get("generation_job_id"),
        "references": candidate_metadata.get("references") or [],
        "direction": candidate_metadata.get("direction") or "",
        "model": candidate_metadata.get("model"),
        "review": review,
    }}
    if candidate_metadata.get("visual_style"):
        changes["visual_style"] = candidate_metadata["visual_style"]
    _update_character_metadata(supabase, project_id, character_id, changes, primary_asset_id=face_asset_id)
    return {
        "approved": True,
        "review": review or None,
        "sheet_asset_id": asset_id,
        "sheet_url": url,
        "face_closeup_asset_id": face_asset_id,
        "face_closeup_url": face_url,
    }


def approved_sheet_model(character: dict[str, Any]) -> str:
    """The WaveSpeed model the approved sheet was drawn with, or the default."""
    stored = character.get("metadata")
    sheet = stored.get(SHEET_ROLE) if isinstance(stored, dict) else None
    model = sheet.get("model") if isinstance(sheet, dict) else None
    try:
        return sheet_model_id(model if isinstance(model, str) else None)
    except ValueError:
        return DEFAULT_SHEET_MODEL


def approved_sheet_inputs(character: dict[str, Any]) -> tuple[str, list[SheetReference]]:
    """Direction and references of the approved sheet, to regenerate it in another style."""
    stored = character.get("metadata")
    metadata: dict[str, Any] = stored if isinstance(stored, dict) else {}
    stored_sheet = metadata.get(SHEET_ROLE)
    sheet: dict[str, Any] = stored_sheet if isinstance(stored_sheet, dict) else {}
    references = [
        SheetReference(url=str(item["url"]), tag=normalize_reference_tag(item.get("tag")))
        for item in sheet.get("references") or []
        if isinstance(item, dict) and item.get("url")
    ]
    return str(sheet.get("direction") or ""), references
