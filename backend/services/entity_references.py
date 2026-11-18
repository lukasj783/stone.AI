"""Multiple reference images per environment and per object (prop).

Each environment and object keeps its main image (``primary_asset_id``) plus any number
of extra references linked with ``asset_links.role = "reference"``. Every link records
an ``angle`` so the storyboard can pick the reference that suits a shot: a reverse angle
or detail of a location, a side view or close detail of an object.

Extra references come from two places:
- uploaded by the user (any image they already have), or
- generated from the main image, so the new angle shows the same place or object.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

import httpx

from core.supabase_client import require_supabase_client
from core.supabase_records import as_records, maybe_single_record
from schemas.image_generation import CreateImageRequest
from services.image_generation_service import generate_provider_images
from services.visual_style import VisualStyle, resolve_scene_visual_style, resolve_visual_style

REFERENCE_ROLE = "reference"
PRIMARY_ANGLE = "primary"
CUSTOM_ANGLE = "custom"
FORMER_MAIN_ANGLE = "former_main"  # earlier main images, and links saved before angles existed
STORAGE_BUCKET = "output-images"


@dataclass(frozen=True)
class EntityKind:
    table: str
    target_type: str
    noun: str
    aspect_ratio: str
    primary_label: str
    # angle key -> (label, what the generated image shows)
    angles: dict[str, tuple[str, str]]


ENVIRONMENT = EntityKind(
    table="environments",
    target_type="environment",
    noun="location",
    aspect_ratio="16:9",
    primary_label="Establishing view",
    angles={
        "reverse": ("Reverse angle", "the same location seen from the opposite direction, showing the part of the space that was behind the original camera"),
        "side": ("Side angle", "the same location seen from a side angle, about 90 degrees around from the original view"),
        "detail": ("Detail view", "a closer view of the main area where the action happens, showing surfaces, textures, furniture and set dressing"),
        "wide": ("Extra-wide view", "a wider, higher view that shows the whole location and its surroundings"),
    },
)

OBJECT = EntityKind(
    table="props",
    target_type="prop",
    noun="object",
    aspect_ratio="1:1",
    primary_label="Main view",
    angles={
        "three_quarter": ("3/4 view", "the same object from a three-quarter angle, slightly from above"),
        "side": ("Side view", "the same object in exact side view"),
        "back": ("Back view", "the same object seen from behind"),
        "detail": ("Detail close-up", "an extreme close-up of the object's most distinctive part, showing material, texture, markings and wear"),
    },
)

ENTITY_KINDS = {"environment": ENVIRONMENT, "prop": OBJECT, "object": OBJECT}

ENTITY_ANGLE_PROMPT = """\
The attached reference image shows a {noun} from a film: {name}.
{facts}
Create a new reference image showing {angle_description}.

This must be exactly the same {noun}: keep its design, shape, proportions, materials,
colors, markings, wear, {extra}and art style identical to the reference image.
Only the camera position changes.

{rules} Output only one image.
"""


def entity_kind(entity_type: str) -> EntityKind:
    kind = ENTITY_KINDS.get(entity_type)
    if not kind:
        raise ValueError(f"Unsupported entity type: {entity_type}")
    return kind


def angle_label(kind: EntityKind, angle: str | None) -> str:
    if not angle or angle == PRIMARY_ANGLE:
        return kind.primary_label
    if angle in kind.angles:
        return kind.angles[angle][0]
    if angle == FORMER_MAIN_ANGLE:
        return "Earlier main image"
    return angle.replace("_", " ").capitalize() if angle != CUSTOM_ANGLE else "Uploaded reference"


def load_entity(kind: EntityKind, project_id: str, entity_id: str) -> dict[str, Any]:
    supabase = require_supabase_client()
    entity = maybe_single_record(supabase.table(kind.table).select(
        "id, name, description, tags, primary_asset_id, metadata"
    ).eq("id", entity_id).eq("project_id", project_id).maybe_single().execute())
    if not entity:
        raise ValueError(f"The {kind.noun} was not found in this project")
    return entity


def list_entity_references(kind: EntityKind, project_id: str, entity: dict[str, Any]) -> list[dict[str, Any]]:
    """Main image first, then linked references oldest first, each with its angle."""
    supabase = require_supabase_client()
    links = as_records(supabase.table("asset_links").select("id, asset_id, metadata, created_at").eq(
        "project_id", project_id
    ).eq("target_type", kind.target_type).eq("target_id", entity["id"]).eq("role", REFERENCE_ROLE).order(
        "created_at"
    ).execute().data)
    primary_id = entity.get("primary_asset_id")
    asset_ids = [str(link["asset_id"]) for link in links if link.get("asset_id")]
    if primary_id and primary_id not in asset_ids:
        asset_ids.insert(0, str(primary_id))
    if not asset_ids:
        return []
    urls = {
        str(asset["id"]): str(asset["url"])
        for asset in as_records(supabase.table("assets").select("id, url").in_("id", asset_ids).execute().data)
    }
    angle_by_asset = {
        str(link["asset_id"]): (link.get("metadata") or {}).get("angle") or FORMER_MAIN_ANGLE for link in links
    }
    references = []
    for asset_id in asset_ids:
        if asset_id not in urls:
            continue
        angle = PRIMARY_ANGLE if asset_id == primary_id else angle_by_asset.get(asset_id, CUSTOM_ANGLE)
        references.append({
            "asset_id": asset_id,
            "url": urls[asset_id],
            "angle": angle,
            "label": angle_label(kind, angle),
            "is_primary": asset_id == primary_id,
        })
    references.sort(key=lambda reference: not reference["is_primary"])
    return references


def _entity_style(entity: dict[str, Any], project_id: str, override: str | None) -> VisualStyle:
    if isinstance(override, str) and override.strip():
        return resolve_visual_style(override)
    metadata = entity.get("metadata") if isinstance(entity.get("metadata"), dict) else {}
    scene_ids = metadata.get("source_scene_ids")
    return resolve_scene_visual_style(project_id, scene_ids=scene_ids if isinstance(scene_ids, list) else None)


def build_angle_prompt(kind: EntityKind, entity: dict[str, Any], angle: str, style: VisualStyle | None) -> str:
    if angle not in kind.angles:
        raise ValueError(f"Unknown {kind.noun} angle: {angle}")
    metadata = entity.get("metadata") if isinstance(entity.get("metadata"), dict) else {}
    facts = []
    if isinstance(entity.get("description"), str) and entity["description"].strip():
        facts.append(f"Description: {entity['description'].strip()}")
    for key, label in (("location_types", "Setting"), ("time_of_day_values", "Time of day")):
        values = metadata.get(key)
        if isinstance(values, list) and values:
            facts.append(f"{label}: {', '.join(str(value) for value in values)}")
    if kind is ENVIRONMENT:
        extra = "architecture, layout, lighting, time of day, weather, set dressing, "
        rules = "No people, no characters, no text or signage that is not in the reference."
    else:
        extra = ""
        rules = "Same restrained neutral background as the reference. No people, hands, text or extra objects."
    prompt = ENTITY_ANGLE_PROMPT.format(
        noun=kind.noun,
        name=entity.get("name") or kind.noun,
        facts="\n".join(facts),
        angle_description=kind.angles[angle][1],
        extra=extra,
        rules=rules,
    )
    return f"{prompt}\n{style.prompt_block()}" if style else prompt


def _store_reference(
    kind: EntityKind,
    project_id: str,
    entity: dict[str, Any],
    content: bytes,
    content_type: str,
    angle: str,
    source: str,
    extra_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Upload bytes, create the asset and its reference link; first image becomes the main one."""
    supabase = require_supabase_client()
    extension = {"image/jpeg": "jpg", "image/webp": "webp"}.get(content_type, "png")
    storage_path = f"entity-references/{kind.target_type}/{entity['id']}/{angle}_{uuid.uuid4().hex}.{extension}"
    supabase.storage.from_(STORAGE_BUCKET).upload(file=content, path=storage_path, file_options={"content-type": content_type})
    url = supabase.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)
    try:
        created = as_records(supabase.table("assets").insert({
            "project_id": project_id,
            "type": "image",
            "source": source,
            "name": f"{entity.get('name') or kind.noun.title()} - {angle_label(kind, angle)}",
            "url": url,
            "storage_path": storage_path,
            "mime_type": content_type,
            "size_bytes": len(content),
            "metadata": {f"{kind.target_type}_id": entity["id"], "angle": angle, **(extra_metadata or {})},
        }).execute().data)
        if not created:
            raise RuntimeError("Failed to create the reference asset")
        asset_id = str(created[0]["id"])
        supabase.table("asset_links").insert({
            "project_id": project_id,
            "asset_id": asset_id,
            "target_type": kind.target_type,
            "target_id": entity["id"],
            "role": REFERENCE_ROLE,
            "metadata": {"angle": angle, "source": source, **(extra_metadata or {})},
        }).execute()
        is_primary = not entity.get("primary_asset_id")
        if is_primary:
            supabase.table(kind.table).update({"primary_asset_id": asset_id}).eq("id", entity["id"]).eq(
                "project_id", project_id
            ).execute()
            entity["primary_asset_id"] = asset_id
    except Exception:
        supabase.storage.from_(STORAGE_BUCKET).remove([storage_path])
        raise
    angle_value = PRIMARY_ANGLE if is_primary else angle
    return {"asset_id": asset_id, "url": url, "angle": angle_value, "label": angle_label(kind, angle_value), "is_primary": is_primary}


def upload_entity_reference(
    entity_type: str,
    project_id: str,
    entity_id: str,
    content: bytes,
    content_type: str,
    angle: str | None = None,
) -> dict[str, Any]:
    kind = entity_kind(entity_type)
    if not content:
        raise ValueError("Uploaded image is empty")
    if not content_type.startswith("image/"):
        raise ValueError("Uploaded file must be an image")
    entity = load_entity(kind, project_id, entity_id)
    chosen_angle = angle if angle in kind.angles else CUSTOM_ANGLE
    return _store_reference(kind, project_id, entity, content, content_type, chosen_angle, "upload")


def generate_entity_reference(
    entity_type: str,
    project_id: str,
    entity_id: str,
    angle: str,
    model: str = "nanobanana",
    provider: str = "replicate",
    visual_style: str | None = None,
) -> dict[str, Any]:
    """Generate one new angle from the main image, so it shows the same place or object."""
    kind = entity_kind(entity_type)
    entity = load_entity(kind, project_id, entity_id)
    references = list_entity_references(kind, project_id, entity)
    primary = next((reference for reference in references if reference["is_primary"]), None)
    if not primary:
        raise ValueError(f"Create or upload the main {kind.noun} image before generating more angles")
    style = _entity_style(entity, project_id, visual_style)
    prompt = build_angle_prompt(kind, entity, angle, style)
    response = generate_provider_images(CreateImageRequest(
        model=model,
        provider=provider,
        prompt=prompt,
        aspect_ratio=kind.aspect_ratio,
        num_images=1,
        output_format="png",
        image_mapping={"reference": primary["url"]},
        image_search=False,
        google_search=False,
        project_id=project_id,
        visual_style=style.label,
    ))
    if not response.images:
        raise RuntimeError(f"No image returned for the {angle_label(kind, angle).lower()}")
    download = httpx.get(response.images[0], timeout=60.0, follow_redirects=True)
    download.raise_for_status()
    return _store_reference(
        kind, project_id, entity, download.content, "image/png", angle, "generation",
        {"model": model, "visual_style": style.label, "source_asset_id": primary["asset_id"]},
    )


def delete_entity_reference(entity_type: str, project_id: str, entity_id: str, asset_id: str) -> None:
    """Unlink one reference; if it was the main image, promote the next reference."""
    kind = entity_kind(entity_type)
    entity = load_entity(kind, project_id, entity_id)
    supabase = require_supabase_client()
    supabase.table("asset_links").delete().eq("project_id", project_id).eq("target_type", kind.target_type).eq(
        "target_id", entity_id
    ).eq("role", REFERENCE_ROLE).eq("asset_id", asset_id).execute()
    if str(entity.get("primary_asset_id") or "") == asset_id:
        entity["primary_asset_id"] = None
        remaining = list_entity_references(kind, project_id, entity)
        supabase.table(kind.table).update({"primary_asset_id": remaining[0]["asset_id"] if remaining else None}).eq(
            "id", entity_id
        ).eq("project_id", project_id).execute()


def set_entity_primary_reference(entity_type: str, project_id: str, entity_id: str, asset_id: str) -> None:
    kind = entity_kind(entity_type)
    entity = load_entity(kind, project_id, entity_id)
    if asset_id not in {reference["asset_id"] for reference in list_entity_references(kind, project_id, entity)}:
        raise ValueError("That image is not a reference of this item")
    supabase = require_supabase_client()
    old_primary = entity.get("primary_asset_id")
    if old_primary and old_primary != asset_id:
        # Keep the previous main image in the gallery as an ordinary reference.
        existing = as_records(supabase.table("asset_links").select("id").eq("project_id", project_id).eq(
            "target_type", kind.target_type
        ).eq("target_id", entity_id).eq("role", REFERENCE_ROLE).eq("asset_id", old_primary).execute().data)
        if not existing:
            supabase.table("asset_links").insert({
                "project_id": project_id, "asset_id": old_primary, "target_type": kind.target_type,
                "target_id": entity_id, "role": REFERENCE_ROLE, "metadata": {"angle": FORMER_MAIN_ANGLE},
            }).execute()
    supabase.table(kind.table).update({"primary_asset_id": asset_id}).eq("id", entity_id).eq("project_id", project_id).execute()
