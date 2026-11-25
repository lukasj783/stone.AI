from datetime import UTC, datetime
import uuid

import httpx

from core.supabase_client import get_supabase_client
from core.provider_errors import describe_error
from schemas.image_generation import CreateImageRequest
from services.visual_style import VisualStyle


def load_object(project_id: str, object_id: str) -> dict[str, object]:
    supabase = get_supabase_client()
    if not supabase:
        raise RuntimeError("Supabase client not initialized")
    result = supabase.table("props").select("id, name, description, tags, metadata").eq("id", object_id).eq(
        "project_id", project_id
    ).maybe_single().execute()
    prop = result.data
    if not prop:
        raise ValueError("Object was not found in this project")
    return prop


def build_object_prompt(
    prop: dict[str, object],
    visual_style: VisualStyle | None = None,
) -> str:
    metadata = prop.get("metadata") if isinstance(prop.get("metadata"), dict) else {}
    description = prop.get("description") if isinstance(prop.get("description"), str) else ""
    tags = prop.get("tags") if isinstance(prop.get("tags"), list) else []
    image_prompt = metadata.get("image_prompt") if isinstance(metadata.get("image_prompt"), str) else ""
    facts = [("Object", prop.get("name")), ("Description", description), ("Tags", ", ".join(tag for tag in tags if isinstance(tag, str))), ("Script visual facts", image_prompt)]
    detail_lines = [f"- {label}: {value}" for label, value in facts if isinstance(value, str) and value.strip()]
    if not detail_lines:
        raise ValueError("Add an object name or description before generating a reference image")
    sections = [
        "Create one isolated, cinematic reference image of this physical story object:",
        "\n".join(detail_lines),
        "Show the object clearly against a restrained neutral background. Preserve only the listed facts. Do not add characters, text, signage, extra objects, or unstated brand details.",
    ]
    if visual_style:
        sections.append(visual_style.prompt_block())
    return "\n\n".join(sections)


def persist_object_generation(project_id: str, object_id: str, payload: CreateImageRequest, image_url: str) -> tuple[str, str, str]:
    supabase = get_supabase_client()
    if not supabase:
        raise RuntimeError("Supabase client not initialized")
    job = supabase.table("generation_jobs").insert({
        "project_id": project_id, "kind": "prop", "model": payload.model, "prompt": payload.prompt,
        "settings": {"payload": payload.model_dump(mode="json")}, "status": "running",
    }).execute()
    if not job.data:
        raise RuntimeError("Failed to create object generation job")
    job_id = job.data[0]["id"]
    storage_path = ""
    asset_id = ""
    try:
        download = httpx.get(image_url, timeout=60.0)
        download.raise_for_status()
        storage_path = f"object-references/{job_id}/{uuid.uuid4().hex}.png"
        supabase.storage.from_("output-images").upload(file=download.content, path=storage_path, file_options={"content-type": "image/png"})
        stored_url = supabase.storage.from_("output-images").get_public_url(storage_path)
        asset = supabase.table("assets").insert({
            "project_id": project_id, "type": "image", "source": "generation", "name": "Object reference", "url": stored_url,
            "storage_path": storage_path, "mime_type": "image/png", "metadata": {
                "object_id": object_id, "object_generation": True, "visual_style": payload.visual_style,
            },
        }).execute()
        if not asset.data:
            raise RuntimeError("Failed to create object reference asset")
        asset_id = asset.data[0]["id"]
        supabase.table("props").update({"primary_asset_id": asset_id}).eq("id", object_id).eq("project_id", project_id).execute()
        supabase.table("asset_links").insert({
            "project_id": project_id, "asset_id": asset_id, "target_type": "prop", "target_id": object_id, "role": "reference",
            "metadata": {"generation_job_id": job_id},
        }).execute()
        supabase.table("generation_outputs").insert({
            "generation_job_id": job_id, "asset_id": asset_id, "output_index": 0, "selected": True,
            "metadata": {"object_id": object_id, "prompt": payload.prompt},
        }).execute()
        supabase.table("generation_jobs").update({"status": "complete", "completed_at": datetime.now(UTC).isoformat()}).eq("id", job_id).execute()
        return job_id, asset_id, stored_url
    except Exception as error:
        if asset_id:
            supabase.table("assets").delete().eq("id", asset_id).execute()
        if storage_path:
            supabase.storage.from_("output-images").remove([storage_path])
        supabase.table("generation_jobs").update({"status": "failed", "error_message": describe_error(error)}).eq("id", job_id).execute()
        raise