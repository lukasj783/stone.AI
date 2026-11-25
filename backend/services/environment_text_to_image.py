from datetime import UTC, datetime
import uuid

import httpx

from core.supabase_client import get_supabase_client
from core.provider_errors import describe_error
from schemas.image_generation import CreateImageRequest
from services.visual_style import VisualStyle


def load_script_environment(project_id: str, environment_id: str) -> dict[str, object]:
    supabase = get_supabase_client()
    if not supabase:
        raise RuntimeError("Supabase client not initialized")

    result = supabase.table("environments").select("id, name, metadata").eq("id", environment_id).eq(
        "project_id", project_id
    ).maybe_single().execute()
    environment = result.data
    metadata = (environment or {}).get("metadata") or {}
    if not environment or not isinstance(metadata, dict) or metadata.get("source") != "script":
        raise ValueError("Script-derived environment was not found in this project")
    return environment


def build_script_environment_prompt(
    environment: dict[str, object],
    visual_style: VisualStyle | None = None,
) -> str:
    """Build an image prompt strictly from persisted screenplay setting facts."""
    metadata = environment.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}

    location_types = metadata.get("location_types")
    time_of_day_values = metadata.get("time_of_day_values")
    fields = [("Environment", environment.get("name"))]
    if isinstance(location_types, list) and location_types:
        fields.append(("Setting", ", ".join(str(value) for value in location_types if str(value).strip())))
    if isinstance(time_of_day_values, list) and time_of_day_values:
        fields.append(("Time of day", ", ".join(str(value) for value in time_of_day_values if str(value).strip())))

    facts = "\n".join(f"- {label}: {value}" for label, value in fields if value)
    if not facts:
        raise ValueError("The script does not contain environment facts to generate")

    sections = [
        "Create one cinematic establishing image from these canonical screenplay setting facts:",
        facts,
        "Preserve the environment name, setting type, and time of day exactly when provided. Do not add specific geography, architecture, weather, era, characters, props, text, signage, or other factual details not stated above.",
    ]
    if visual_style:
        sections.append(visual_style.prompt_block())
    return "\n\n".join(sections)


def persist_environment_generation(project_id: str, environment_id: str, payload: CreateImageRequest, image_url: str) -> tuple[str, str, str]:
    supabase = get_supabase_client()
    if not supabase:
        raise RuntimeError("Supabase client not initialized")

    job_result = supabase.table("generation_jobs").insert({
        "project_id": project_id,
        "kind": "environment",
        "model": payload.model,
        "prompt": payload.prompt,
        "settings": {"payload": payload.model_dump(mode="json")},
        "status": "running",
    }).execute()
    if not job_result.data:
        raise RuntimeError("Failed to create environment generation job")

    job_id = job_result.data[0]["id"]
    storage_path = ""
    asset_id = ""
    try:
        download = httpx.get(image_url, timeout=60.0)
        download.raise_for_status()
        storage_path = f"environment-keyframes/{job_id}/{uuid.uuid4().hex}.png"
        supabase.storage.from_("output-images").upload(
            file=download.content,
            path=storage_path,
            file_options={"content-type": "image/png"},
        )
        stored_url = supabase.storage.from_("output-images").get_public_url(storage_path)
        asset_result = supabase.table("assets").insert({
            "project_id": project_id,
            "type": "image",
            "source": "generation",
            "name": "Environment reference",
            "url": stored_url,
            "storage_path": storage_path,
            "mime_type": "image/png",
            "metadata": {
                "environment_id": environment_id,
                "environment_generation": True,
                "visual_style": payload.visual_style,
            },
        }).execute()
        if not asset_result.data:
            raise RuntimeError("Failed to create environment reference asset")
        asset_id = asset_result.data[0]["id"]
        supabase.table("environments").update({"primary_asset_id": asset_id}).eq("id", environment_id).eq(
            "project_id", project_id
        ).execute()
        supabase.table("generation_outputs").insert({
            "generation_job_id": job_id,
            "asset_id": asset_id,
            "output_index": 0,
            "selected": True,
            "metadata": {"environment_id": environment_id, "prompt": payload.prompt},
        }).execute()
        supabase.table("generation_jobs").update({
            "status": "complete",
            "completed_at": datetime.now(UTC).isoformat(),
        }).eq("id", job_id).execute()
        return job_id, asset_id, stored_url
    except Exception as error:
        if asset_id:
            supabase.table("assets").delete().eq("id", asset_id).execute()
        if storage_path:
            supabase.storage.from_("output-images").remove([storage_path])
        supabase.table("generation_jobs").update({"status": "failed", "error_message": describe_error(error)}).eq("id", job_id).execute()
        raise