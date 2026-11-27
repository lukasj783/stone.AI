"""Object sheets: one approved image showing an object from several sides plus a close-up.

Modelled on character sheets (``services/character_sheet.py``) and reusing its canvas, upload
and model helpers: the sheet is drawn by a WaveSpeed storyboard edit model on a blank 16:9 canvas,
every generation is kept as an ``object_sheet_candidate`` link, and one candidate is the approved
``object_sheet``. Unlike character sheets nothing checks the image: it is approved by eye.

Approving a sheet does not change the object's ``primary_asset_id``: the gallery stays as it is,
and storyboard frames read the approved sheet from ``props.metadata["object_sheet"]``.
"""

from __future__ import annotations

import io
import logging
import random
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from PIL import Image
from supabase import Client

from core.provider_errors import describe_error
from core.supabase_client import require_supabase_client
from core.supabase_records import as_record, as_records
from schemas.image_generation import CreateImageRequest
from services.character_sheet import (
    CANVAS_NOTE,
    DEFAULT_SHEET_MODEL,
    SHEET_ASPECT_RATIO,
    SHEET_PROVIDER,
    SHEET_RESOLUTION,
    STORAGE_BUCKET,
    SheetReference,
    _download,
    blank_canvas_url,
    sheet_model_id,
)
from services.entity_profiles import describe_object
from services.image_generation_service import generate_provider_images
from services.object_text_to_image import load_object
from services.visual_style import resolve_scene_visual_style, resolve_visual_style

logger = logging.getLogger(__name__)

OBJECT_SHEET_ROLE = "object_sheet"
OBJECT_CANDIDATE_ROLE = "object_sheet_candidate"
OBJECT_REFERENCE_TAGS = ("object", "style")
MAX_OBJECT_REFERENCES = 4
TARGET_TYPE = "prop"

NAME_ONLY_ERROR = (
    "Describe the object (description or profile), add a direction, or add a reference image before generating its sheet."
)

OBJECT_REFERENCE_INSTRUCTIONS = {
    "object": "copy this object exactly: its shape, proportions, colours, materials, label and markings",
    "style": "use only the art style, medium, rendering and color treatment; do not copy the subject",
}

OBJECT_SHEET_PROMPT = """\
You are a senior prop designer making the production object sheet for a film.

{object}
{references}
Create ONE object sheet image, landscape, showing this ONE object only:
- One horizontal row, left to right: front view; back view; left side view;
  three-quarter view from slightly above. All four at the same scale, standing on the
  same baseline, the complete object visible in each.
- Beside the row: one close-up of the label or the object's key detail, large and sharp.

Every view is the identical object: same shape, proportions, colours, materials, label and
markings. Never mirror or flip the label or any lettering; asymmetric details stay on the
same side.

One plain, uniform, neutral light-grey studio background across the whole sheet. Flat, even,
soft lighting with no dramatic shadows or coloured light, so the object can be relit in any
scene. Leave clear empty background between the views so nothing touches or overlaps.

No text, captions, labels, numbers, arrows, colour swatches, panels, borders, divider lines,
hands, people or other objects.
"""


def normalize_object_reference_tag(tag: object) -> str:
    value = str(tag or "").strip().casefold()
    return value if value in OBJECT_REFERENCE_TAGS else "object"


def _references_block(references: list[SheetReference]) -> str:
    """Images after the canvas, numbered as the model receives them (the canvas is image 1)."""
    if not references:
        return ""
    lines = ["\nReference images (attached in this order, after the canvas):"]
    lines.extend(
        f"- Image {index}: {OBJECT_REFERENCE_INSTRUCTIONS[normalize_object_reference_tag(reference.tag)]}."
        for index, reference in enumerate(references, start=2)
    )
    lines.append("Where a reference and the object facts disagree on how the object looks, follow the reference image.")
    lines.append("Do not return or retouch a reference image: draw a NEW object sheet in the layout below.")
    return "\n".join(lines) + "\n"


def build_object_sheet_prompt(
    object_block: str,
    direction: str = "",
    references: list[SheetReference] | None = None,
) -> str:
    text = f"Object: {object_block.strip()}"
    if direction.strip():
        text += f"\n\nDirection from the filmmaker (follow it):\n{direction.strip()}"
    references_block = _references_block(list(references or []))
    canvas = CANVAS_NOTE.replace("model sheet", "object sheet")
    return OBJECT_SHEET_PROMPT.format(object=text, references=f"\n{canvas}\n{references_block}")


# --------------------------------------------------------------------------- storage


def _store_object_sheet_asset(
    supabase: Client,
    project_id: str,
    object_id: str,
    image: Image.Image,
    *,
    name: str,
    metadata: dict[str, Any],
) -> tuple[str, str]:
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, "JPEG", quality=92, optimize=True)
    content = buffer.getvalue()
    storage_path = f"object-sheets/{object_id}/{OBJECT_SHEET_ROLE}_{uuid.uuid4().hex}.jpg"
    try:
        supabase.storage.from_(STORAGE_BUCKET).upload(file=content, path=storage_path, file_options={"content-type": "image/jpeg"})
    except httpx.TimeoutException:
        raise RuntimeError("Saving the object sheet to storage timed out; check the connection and try again") from None
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
            "metadata": {**metadata, "object_id": object_id, "kind": OBJECT_SHEET_ROLE},
        }).execute().data)
        if not created:
            raise RuntimeError("Failed to create the object sheet asset")
    except Exception:
        supabase.storage.from_(STORAGE_BUCKET).remove([storage_path])
        raise
    return str(created[0]["id"]), url


def _link(
    supabase: Client,
    project_id: str,
    object_id: str,
    asset_id: str,
    role: str,
    metadata: dict[str, Any],
    *,
    replace: bool,
) -> None:
    """Link an asset to the object; ``replace`` makes it the only link for the role."""
    if replace:
        supabase.table("asset_links").delete().eq("project_id", project_id).eq("target_type", TARGET_TYPE).eq(
            "target_id", object_id
        ).eq("role", role).execute()
    supabase.table("asset_links").insert({
        "project_id": project_id,
        "asset_id": asset_id,
        "target_type": TARGET_TYPE,
        "target_id": object_id,
        "role": role,
        "sort_order": 0,
        "metadata": metadata,
    }).execute()


def _has_approved_object_sheet(supabase: Client, project_id: str, object_id: str) -> bool:
    links = supabase.table("asset_links").select("id").eq("project_id", project_id).eq("target_type", TARGET_TYPE).eq(
        "target_id", object_id
    ).eq("role", OBJECT_SHEET_ROLE).limit(1).execute()
    return bool(as_records(links.data))


# --------------------------------------------------------------------------- orchestration


def _object_style(project_id: str, prop: dict[str, Any], visual_style: str | None):
    if isinstance(visual_style, str) and visual_style.strip():
        return resolve_visual_style(visual_style)
    metadata = prop.get("metadata")
    scene_ids = metadata.get("source_scene_ids") if isinstance(metadata, dict) else None
    return resolve_scene_visual_style(project_id, scene_ids=scene_ids if isinstance(scene_ids, list) else None)


def _render_object_sheet(
    project_id: str,
    object_id: str,
    object_name: str,
    prompt: str,
    references: list[SheetReference],
    *,
    model: str,
    style_label: str,
    settings: dict[str, Any],
) -> tuple[str, str, dict[str, Any]]:
    """Generate one sheet image and store it as an asset tracked by a generation job."""
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
        "kind": OBJECT_SHEET_ROLE,
        "references": [{"url": reference.url, "tag": reference.tag} for reference in references],
        "seed": seed,
        "visual_style": style_label,
        "model": model,
    }
    supabase = require_supabase_client()
    jobs = as_records(supabase.table("generation_jobs").insert({
        "project_id": project_id,
        "kind": "prop",
        "model": model,
        "prompt": prompt,
        "settings": settings,
        "status": "running",
    }).execute().data)
    if not jobs:
        raise RuntimeError("Failed to create the object sheet generation job")
    job_id = str(jobs[0]["id"])
    try:
        response = generate_provider_images(payload)
        if not response.images:
            raise RuntimeError("The image model returned no object sheet")
        with Image.open(io.BytesIO(_download(response.images[0]))) as generated:
            sheet = generated.convert("RGB")
        metadata = {**settings, "generation_job_id": job_id}
        asset_id, url = _store_object_sheet_asset(
            supabase, project_id, object_id, sheet, name=f"{object_name} - Object sheet", metadata=metadata,
        )
        supabase.table("generation_jobs").update({
            "status": "complete", "completed_at": datetime.now(UTC).isoformat(),
        }).eq("id", job_id).execute()
    except Exception as error:
        supabase.table("generation_jobs").update({
            "status": "failed", "error_message": describe_error(error), "completed_at": datetime.now(UTC).isoformat(),
        }).eq("id", job_id).execute()
        raise
    return asset_id, url, metadata


def generate_object_sheet(
    project_id: str,
    object_id: str,
    *,
    direction: str = "",
    references: list[SheetReference] | None = None,
    model: str | None = None,
    visual_style: str | None = None,
    approve: bool | None = None,
) -> dict[str, Any]:
    """Generate one object sheet and keep it as a candidate.

    ``approve`` True makes it the object's sheet, False never does, and None (default) approves
    it only when the object has no approved sheet yet.
    """
    references = [
        SheetReference(url=reference.url, tag=normalize_object_reference_tag(reference.tag))
        for reference in list(references or [])[:MAX_OBJECT_REFERENCES]
    ]
    model_id = sheet_model_id(model)  # reject an unknown model before any work
    prop = load_object(project_id, object_id)
    name = " ".join(str(prop.get("name") or "").split()) or "Object"
    object_block = describe_object(prop)
    if object_block == name and not direction.strip() and not references:
        raise ValueError(NAME_ONLY_ERROR)
    style = _object_style(project_id, prop, visual_style)
    prompt = build_object_sheet_prompt(f"{object_block}\n\n{style.prompt_block()}", direction, references)
    asset_id, url, metadata = _render_object_sheet(
        project_id, object_id, name, prompt, references,
        model=model_id, style_label=style.label, settings={"object_id": object_id, "direction": direction},
    )
    supabase = require_supabase_client()
    _link(supabase, project_id, object_id, asset_id, OBJECT_CANDIDATE_ROLE, metadata, replace=False)

    should_approve = approve if approve is not None else not _has_approved_object_sheet(supabase, project_id, object_id)
    result: dict[str, Any] = {
        "object_id": object_id,
        "sheet_asset_id": asset_id,
        "sheet_url": url,
        "generation_job_id": metadata["generation_job_id"],
        "approved": False,
    }
    if should_approve:
        result.update(approve_object_sheet(project_id, object_id, asset_id))
    return result


def approve_object_sheet(project_id: str, object_id: str, asset_id: str) -> dict[str, Any]:
    """Make one of this object's candidates its sheet, used by every storyboard frame showing it."""
    supabase = require_supabase_client()
    candidates = as_records(supabase.table("asset_links").select("metadata").eq("project_id", project_id).eq(
        "target_type", TARGET_TYPE
    ).eq("target_id", object_id).eq("role", OBJECT_CANDIDATE_ROLE).eq("asset_id", asset_id).limit(1).execute().data)
    if not candidates:
        raise ValueError("That object sheet was not found for this object")
    stored = candidates[0].get("metadata")
    candidate_metadata: dict[str, Any] = stored if isinstance(stored, dict) else {}
    assets = as_records(supabase.table("assets").select("url").eq("id", asset_id).limit(1).execute().data)
    if not assets:
        raise ValueError("The object sheet image no longer exists")
    url = str(assets[0]["url"])

    _link(supabase, project_id, object_id, asset_id, OBJECT_SHEET_ROLE, candidate_metadata, replace=True)
    row = as_record(supabase.table("props").select("metadata").eq("id", object_id).eq(
        "project_id", project_id
    ).single().execute().data)
    metadata = dict(row.get("metadata") or {}) if row and isinstance(row.get("metadata"), dict) else {}
    metadata[OBJECT_SHEET_ROLE] = {
        "asset_id": asset_id,
        "url": url,
        "approved_at": datetime.now(UTC).isoformat(),
        "generation_job_id": candidate_metadata.get("generation_job_id"),
        "references": candidate_metadata.get("references") or [],
        "direction": candidate_metadata.get("direction") or "",
        "model": candidate_metadata.get("model"),
    }
    supabase.table("props").update({"metadata": metadata}).eq("id", object_id).eq("project_id", project_id).execute()
    return {"approved": True, "sheet_asset_id": asset_id, "sheet_url": url}


def object_sheet_versions_for(project_id: str, object_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    """Every generated sheet per object, newest first, with the approved one marked (one query)."""
    if not object_ids:
        return {}
    supabase = require_supabase_client()
    links = as_records(supabase.table("asset_links").select("asset_id, target_id, role, created_at").eq(
        "project_id", project_id
    ).eq("target_type", TARGET_TYPE).in_("target_id", object_ids).in_(
        "role", [OBJECT_CANDIDATE_ROLE, OBJECT_SHEET_ROLE]
    ).execute().data)
    approved = {(str(link.get("target_id")), str(link.get("asset_id"))) for link in links if link.get("role") == OBJECT_SHEET_ROLE}
    candidates = [link for link in links if link.get("role") == OBJECT_CANDIDATE_ROLE and link.get("asset_id")]
    asset_ids = sorted({str(link["asset_id"]) for link in candidates})
    if not asset_ids:
        return {}
    assets = as_records(supabase.table("assets").select("id, url").in_("id", asset_ids).execute().data)
    urls = {str(asset["id"]): str(asset["url"]) for asset in assets if isinstance(asset.get("url"), str)}
    versions: dict[str, list[dict[str, Any]]] = {}
    for link in sorted(candidates, key=lambda item: str(item.get("created_at") or ""), reverse=True):
        object_id, asset_id = str(link.get("target_id")), str(link["asset_id"])
        if asset_id not in urls:
            continue
        versions.setdefault(object_id, []).append({
            "asset_id": asset_id,
            "url": urls[asset_id],
            "created_at": link.get("created_at"),
            "approved": (object_id, asset_id) in approved,
        })
    return versions


def object_sheet_versions(project_id: str, object_id: str) -> list[dict[str, Any]]:
    """Every generated sheet for the object, newest first, with the approved one marked."""
    return object_sheet_versions_for(project_id, [object_id]).get(object_id, [])
