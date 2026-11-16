import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from supabase import Client

from core.supabase_client import get_supabase_client, require_supabase_client
from core.supabase_records import as_record, as_records, maybe_single_record
from schemas.image_generation import CharacterKeyframe, CharacterView, CreateImageRequest
from services.visual_style import VisualStyle


CHARACTER_VIEW_SPECS: tuple[tuple[CharacterView, str, str], ...] = (
    (CharacterView.front, "Front View", "directly facing the camera"),
    (CharacterView.left_three_quarter, "Left 3/4 View", "turned 45 degrees toward the character's left"),
    (CharacterView.left_profile, "Left Side Profile", "facing left in exact profile, with the camera viewing the character's left side"),
    (CharacterView.back, "Back View", "directly facing away from the camera"),
    (CharacterView.right_profile, "Right Side Profile", "facing right in exact profile, with the camera viewing the character's right side"),
    (CharacterView.right_three_quarter, "Right 3/4 View", "turned 45 degrees toward the character's right"),
)

CHARACTER_VIEW_LABELS = [label for _, label, _ in CHARACTER_VIEW_SPECS]
EDITABLE_CHARACTER_FIELDS = ("role", "age", "gender", "race", "appearance", "personality")

CHARACTER_VIEW_PROMPT = """\
You are a professional character designer and concept artist.

Character description:
{user_prompt}

Camera angle: {view_label}. The character is {view_direction}.

Generate exactly one full-body character image. Use a neutral standing pose with
relaxed arms on a clean, uniform studio background. Preserve the same identity,
facial features, hairstyle, body proportions, clothing, accessories, footwear,
lighting, scale, and art style across every requested view. Center the complete
character in frame with high detail and sharp focus. Do not mirror or flip the
character. Preserve asymmetric details on the same side of the character's body.

Do not create a collage, reference sheet, grid, panel, label, divider, or any
additional character view. Output only one image.
"""


def build_character_view_prompt(user_prompt: str, view: CharacterView) -> str:
    for candidate_view, view_label, view_direction in CHARACTER_VIEW_SPECS:
        if candidate_view == view:
            return CHARACTER_VIEW_PROMPT.format(
                user_prompt=user_prompt,
                view_label=view_label,
                view_direction=view_direction,
            )
    raise ValueError(f"Unsupported character view: {view}")


def load_script_character(project_id: str, character_id: str) -> dict[str, object]:
    """Load a project-scoped script character with its authoritative visual facts."""
    supabase = require_supabase_client()

    character = maybe_single_record(supabase.table("characters").select(
        "id, name, role, age, gender, race, appearance, personality, tags, metadata"
    ).eq("id", character_id).eq("project_id", project_id).maybe_single().execute())
    metadata = character.get("metadata") if character else None
    if not character or not isinstance(metadata, dict) or metadata.get("source") != "script":
        raise ValueError("Script-derived character was not found in this project")
    return character


def effective_character_profile(character: dict[str, object]) -> dict[str, object]:
    """Return script facts with explicit manual profile choices layered over them."""
    effective = dict(character)
    metadata = character.get("metadata")
    overrides = metadata.get("manual_overrides") if isinstance(metadata, dict) else None
    if not isinstance(overrides, dict):
        return effective
    for field in EDITABLE_CHARACTER_FIELDS:
        value = overrides.get(field)
        if isinstance(value, str) and value.strip():
            effective[field] = value.strip()
        elif field == "age" and isinstance(value, int) and not isinstance(value, bool):
            effective[field] = value
    return effective


def build_script_character_profile(
    character: dict[str, object],
    visual_style: VisualStyle | None = None,
) -> str:
    """Build provider instructions from persisted facts without letting hints replace them."""
    character = effective_character_profile(character)
    fields = (
        ("Name", character.get("name")),
        ("Role", character.get("role")),
        ("Age", character.get("age")),
        ("Gender", character.get("gender")),
        ("Race", character.get("race")),
        ("Appearance", character.get("appearance")),
        ("Personality", character.get("personality")),
    )
    facts = "\n".join(
        f"- {label}: {value}"
        for label, value in fields
        if value is not None and value != ""
    )
    if not facts:
        raise ValueError("The script does not contain visual character details to generate")

    sections = [
        "Canonical character facts (authoritative; preserve exactly):",
        facts,
        (
            "Do not change or contradict any known age, gender, role, race, appearance, "
            "or personality fact. Do not invent missing demographic or identity details."
        ),
    ]
    metadata = character.get("metadata") or {}
    image_prompt = metadata.get("image_prompt") if isinstance(metadata, dict) else None
    if isinstance(image_prompt, str) and image_prompt.strip():
        sections.extend(("Supplementary visual details from the screenplay:", image_prompt.strip()))
    if visual_style:
        sections.extend(("", visual_style.prompt_block()))
    return "\n\n".join(sections)


def upload_keyframe(file_bytes: bytes) -> str:
    supabase = get_supabase_client()
    if not supabase:
        raise RuntimeError("Supabase client not initialized")

    filename = f"character_keyframe_{uuid.uuid4().hex}.png"
    supabase.storage.from_("output-images").upload(
        file=file_bytes,
        path=filename,
        file_options={"content-type": "image/png"},
    )
    return supabase.storage.from_("output-images").get_public_url(filename)


def _insert_character_generation_output(supabase: Client, output: dict[str, Any]) -> None:
    try:
        supabase.table("generation_outputs").insert(output).execute()
    except Exception as error:
        if getattr(error, "code", "") != "PGRST204" and "is_active" not in str(error):
            raise
        legacy_output = {
            key: value
            for key, value in output.items()
            if key not in {"is_active", "status", "replaces_output_id", "replaced_at"}
        }
        supabase.table("generation_outputs").insert(legacy_output).execute()


def _output_view(output: dict[str, Any]) -> Any:
    """Read the stored view label from a generation output's metadata."""
    metadata = output.get("metadata")
    return metadata.get("view") if isinstance(metadata, dict) else None


def persist_character_generation(
    project_id: str,
    payload: CreateImageRequest,
    keyframes: list[CharacterKeyframe],
) -> tuple[str, list[CharacterKeyframe]]:
    """Download and store a complete ordered character generation in the studio schema."""
    supabase = require_supabase_client()

    job_result = supabase.table("generation_jobs").insert({
        "project_id": project_id,
        "kind": "character",
        "model": payload.model,
        "prompt": payload.prompt,
        "settings": {
            "payload": payload.model_dump(mode="json"),
            "seed": payload.seed,
            "visual_style": payload.visual_style,
            "views": [frame.view.value for frame in keyframes],
        },
        "status": "running",
    }).execute()
    created_jobs = as_records(job_result.data)
    if not created_jobs:
        raise RuntimeError("Failed to create character generation job")

    job_id = str(created_jobs[0]["id"])
    storage_paths: list[str] = []
    asset_ids: list[str] = []
    persisted_keyframes: list[CharacterKeyframe] = []

    try:
        for index, keyframe in enumerate(keyframes):
            download = httpx.get(keyframe.image_url, timeout=60.0)
            download.raise_for_status()
            storage_path = f"character-keyframes/{job_id}/{index}_{keyframe.view.value}.png"
            supabase.storage.from_("output-images").upload(
                file=download.content,
                path=storage_path,
                file_options={"content-type": "image/png"},
            )
            storage_paths.append(storage_path)
            image_url = supabase.storage.from_("output-images").get_public_url(storage_path)
            asset_result = supabase.table("assets").insert({
                "project_id": project_id,
                "type": "image",
                "source": "generation",
                "name": f"Character - {keyframe.view.value.replace('_', ' ').title()}",
                "url": image_url,
                "storage_path": storage_path,
                "mime_type": "image/png",
                "metadata": {
                    "view": keyframe.view.value,
                    "character_generation": True,
                    "visual_style": payload.visual_style,
                },
            }).execute()
            created_assets = as_records(asset_result.data)
            if not created_assets:
                raise RuntimeError(f"Failed to create asset for {keyframe.view.value}")
            asset_id = str(created_assets[0]["id"])
            asset_ids.append(asset_id)
            _insert_character_generation_output(supabase, {
                "generation_job_id": job_id,
                "asset_id": asset_id,
                "output_index": index,
                "selected": keyframe.view == CharacterView.front,
                "is_active": True,
                "status": "ready",
                "metadata": {
                    "view": keyframe.view.value,
                    "prompt": keyframe.prompt,
                    "visual_style": payload.visual_style,
                },
            })
            persisted_keyframes.append(keyframe.model_copy(update={"image_url": image_url, "asset_id": asset_id}))

        supabase.table("generation_jobs").update({
            "status": "complete",
            "completed_at": datetime.now(UTC).isoformat(),
        }).eq("id", job_id).execute()
        return job_id, persisted_keyframes
    except Exception as error:
        for asset_id in asset_ids:
            supabase.table("assets").delete().eq("id", asset_id).execute()
        if storage_paths:
            supabase.storage.from_("output-images").remove(storage_paths)
        supabase.table("generation_jobs").update({
            "status": "failed",
            "error_message": str(error),
        }).eq("id", job_id).execute()
        raise


def load_character_generation_payload(project_id: str, generation_job_id: str) -> CreateImageRequest:
    """Rebuild the original request context needed to repair one character view."""
    supabase = require_supabase_client()

    job = supabase.table("generation_jobs").select("model, prompt, settings").eq("id", generation_job_id).eq(
        "project_id", project_id
    ).eq("kind", "character").eq("status", "complete").execute()
    jobs = as_records(job.data)
    if not jobs:
        raise ValueError("Completed character generation was not found in this project")

    job_data = jobs[0]
    job_settings = as_record(job_data.get("settings")) or {}
    payload_data = as_record(job_settings.get("payload")) or {}
    payload_data.setdefault("model", job_data.get("model"))
    payload_data.setdefault("prompt", job_data.get("prompt"))
    payload_data["project_id"] = project_id
    payload_data["seed"] = job_settings.get("seed", payload_data.get("seed"))
    payload_data["num_images"] = 1
    return CreateImageRequest.model_validate(payload_data)


def replace_character_keyframe(
    project_id: str,
    generation_job_id: str,
    keyframe: CharacterKeyframe,
) -> CharacterKeyframe:
    """Persist a repaired keyframe while retaining its replaced output for history."""
    supabase = require_supabase_client()

    active_outputs = supabase.table("generation_outputs").select(
        "id, asset_id, output_index, selected, metadata"
    ).eq("generation_job_id", generation_job_id).eq("is_active", True).execute()
    previous_output = next(
        (output for output in as_records(active_outputs.data) if _output_view(output) == keyframe.view.value),
        None,
    )
    if not previous_output:
        raise ValueError(f"Active {keyframe.view.value} keyframe was not found")

    download = httpx.get(keyframe.image_url, timeout=60.0)
    download.raise_for_status()
    storage_path = f"character-keyframes/{generation_job_id}/{keyframe.view.value}/{uuid.uuid4().hex}.png"
    supabase.storage.from_("output-images").upload(
        file=download.content,
        path=storage_path,
        file_options={"content-type": "image/png"},
    )
    image_url = supabase.storage.from_("output-images").get_public_url(storage_path)
    try:
        asset_result = supabase.table("assets").insert({
            "project_id": project_id,
            "type": "image",
            "source": "generation",
            "name": f"Character - {keyframe.view.value.replace('_', ' ').title()} (repair)",
            "url": image_url,
            "storage_path": storage_path,
            "mime_type": "image/png",
            "metadata": {"view": keyframe.view.value, "character_generation": True, "repair": True},
        }).execute()
        replacement_assets = as_records(asset_result.data)
        if not replacement_assets:
            raise RuntimeError("Failed to create replacement keyframe asset")
        asset_id = str(replacement_assets[0]["id"])
        output_result = supabase.table("generation_outputs").insert({
            "generation_job_id": generation_job_id,
            "asset_id": asset_id,
            "output_index": previous_output.get("output_index"),
            "selected": previous_output.get("selected"),
            "is_active": False,
            "status": "ready",
            "replaces_output_id": previous_output.get("id"),
            "metadata": {"view": keyframe.view.value, "prompt": keyframe.prompt, "repair": True},
        }).execute()
        created_outputs = as_records(output_result.data)
        if not created_outputs:
            raise RuntimeError("Failed to create replacement keyframe output")

        supabase.table("generation_outputs").update({
            "is_active": False,
            "status": "replaced",
            "replaced_at": datetime.now(UTC).isoformat(),
        }).eq("id", previous_output.get("id")).execute()
        supabase.table("generation_outputs").update({"is_active": True}).eq("id", created_outputs[0]["id"]).execute()
        return keyframe.model_copy(update={"image_url": image_url, "asset_id": asset_id, "status": "ready"})
    except Exception:
        supabase.storage.from_("output-images").remove([storage_path])
        raise


def finalize_character_generation(
    project_id: str,
    generation_job_id: str,
    name: str,
    role: str | None,
    description: str | None,
    primary_view: CharacterView,
) -> tuple[str, str]:
    """Create a character from a completed project-scoped generation job."""
    supabase = require_supabase_client()

    job = supabase.table("generation_jobs").select("id, settings").eq("id", generation_job_id).eq(
        "project_id", project_id
    ).eq("kind", "character").eq("status", "complete").execute()
    jobs = as_records(job.data)
    if not jobs:
        raise ValueError("Completed character generation was not found in this project")

    job_settings = as_record(jobs[0].get("settings")) or {}
    job_payload = as_record(job_settings.get("payload")) or {}
    visual_style = job_settings.get("visual_style") or job_payload.get("visual_style")

    outputs = as_records(supabase.table("generation_outputs").select("asset_id, output_index, metadata").eq(
        "generation_job_id", generation_job_id
    ).order("output_index").execute().data)
    if len(outputs) != len(CHARACTER_VIEW_SPECS):
        raise ValueError("Character generation does not contain all six keyframes")

    character_result = supabase.table("characters").insert({
        "project_id": project_id,
        "name": name,
        "role": role or None,
        "appearance": description or None,
        "metadata": {"visual_style": visual_style} if visual_style else {},
    }).execute()
    created_characters = as_records(character_result.data)
    if not created_characters:
        raise RuntimeError("Failed to create character")
    character_id = str(created_characters[0]["id"])

    primary_asset_id: str | None = None
    for output in outputs:
        view = _output_view(output)
        asset_id = str(output["asset_id"])
        supabase.table("asset_links").insert({
            "project_id": project_id,
            "asset_id": asset_id,
            "target_type": "character",
            "target_id": character_id,
            "role": "keyframe",
            "sort_order": output.get("output_index"),
            "metadata": {"view": view},
        }).execute()
        if view == primary_view.value:
            primary_asset_id = asset_id

    if not primary_asset_id:
        raise RuntimeError("Selected primary character view was not found")
    supabase.table("characters").update({"primary_asset_id": primary_asset_id}).eq("id", character_id).execute()
    return character_id, primary_asset_id


def attach_generation_to_character(
    project_id: str,
    character_id: str,
    generation_job_id: str,
    keyframes: list[CharacterKeyframe],
    visual_style: str | None = None,
) -> None:
    """Attach a completed six-view generation to its existing script-derived character."""
    supabase = require_supabase_client()

    if len(keyframes) != len(CHARACTER_VIEW_SPECS):
        raise ValueError("Character generation does not contain all six keyframes")

    primary_asset_id: str | None = None
    for index, keyframe in enumerate(keyframes):
        if not keyframe.asset_id:
            raise RuntimeError(f"Missing persisted asset for {keyframe.view.value}")
        supabase.table("asset_links").insert({
            "project_id": project_id,
            "asset_id": keyframe.asset_id,
            "target_type": "character",
            "target_id": character_id,
            "role": "keyframe",
            "sort_order": index,
            "metadata": {
                "view": keyframe.view.value,
                "generation_job_id": generation_job_id,
                "visual_style": visual_style,
            },
        }).execute()
        if keyframe.view == CharacterView.front:
            primary_asset_id = keyframe.asset_id

    if not primary_asset_id:
        raise RuntimeError("Generated character is missing a front view")

    character_result = supabase.table("characters").select("metadata").eq("id", character_id).eq(
        "project_id", project_id
    ).single().execute()
    character_row = as_record(character_result.data)
    stored_metadata = character_row.get("metadata") if character_row else None
    metadata: dict[str, Any] = dict(stored_metadata) if isinstance(stored_metadata, dict) else {}
    metadata["latest_generation_job_id"] = generation_job_id
    if visual_style:
        metadata["visual_style"] = visual_style
    supabase.table("characters").update({
        "primary_asset_id": primary_asset_id,
        "metadata": metadata,
    }).eq("id", character_id).eq("project_id", project_id).execute()


def log_character_to_studio(
    keyframe_urls: list[str],
    view_labels: list[str] | None = None,
    prompt: str = "",
    model: str = "",
    char_name: str = "",
    char_role: str = "",
    char_description: str = "",
) -> None:
    supabase = get_supabase_client()
    if not supabase:
        return

    if view_labels is None:
        view_labels = CHARACTER_VIEW_LABELS

    try:
        job_result = supabase.table("generation_jobs").insert({
            "kind": "character",
            "model": model,
            "prompt": prompt,
            "status": "complete",
        }).execute()
        created_jobs = as_records(job_result.data)
        job_id = str(created_jobs[0]["id"]) if created_jobs else None

        character_id = None
        if char_name:
            character_result = supabase.table("characters").insert({
                "name": char_name,
                "role": char_role or None,
                "appearance": char_description or None,
            }).execute()
            created_characters = as_records(character_result.data)
            character_id = str(created_characters[0]["id"]) if created_characters else None

        for index, url in enumerate(keyframe_urls):
            view_label = view_labels[index] if index < len(view_labels) else f"View {index + 1}"
            storage_path = url.split("/storage/v1/object/public/output-images/")[-1] if "/storage/v1/object/public/" in url else None
            asset_result = supabase.table("assets").insert({
                "type": "image",
                "source": "generation",
                "name": f"{char_name or 'Character'} - {view_label}" if char_name else view_label,
                "url": url,
                "storage_path": storage_path,
                "mime_type": "image/png",
                "metadata": {"view_label": view_label, "character_generation": True},
            }).execute()
            created_assets = as_records(asset_result.data)
            created_asset_id = str(created_assets[0]["id"]) if created_assets else None

            if job_id and created_asset_id:
                supabase.table("generation_outputs").insert({
                    "generation_job_id": job_id,
                    "asset_id": created_asset_id,
                    "output_index": index,
                    "selected": index == 0,
                }).execute()
            if character_id and created_asset_id:
                supabase.table("asset_links").insert({
                    "asset_id": created_asset_id,
                    "target_type": "character",
                    "target_id": character_id,
                    "role": "keyframe",
                    "sort_order": index,
                }).execute()

        if character_id and keyframe_urls:
            first_assets = as_records(
                supabase.table("assets").select("id").eq("url", keyframe_urls[0]).execute().data
            )
            if first_assets:
                supabase.table("characters").update({
                    "primary_asset_id": first_assets[0]["id"],
                }).eq("id", character_id).execute()
    except Exception as error:
        print(f"Failed to log character to studio schema: {error}")


CHARACTER_IMG2IMG_SYSTEM_PROMPT = """\
Create a polished character image from the supplied reference image.

Preserve the character's identity, facial features, pose, proportions, art style,
photographic realism, texture, and medium unless the user's guidance explicitly
requests a change. Keep the character clearly visible, well lit, and centered.
Return one complete image per generated output. Do not create a collage, grid,
sheet, panels, labels, or divider lines.
"""

CHARACTER_IMG2IMG_VIEW_PROMPT = """\
Create a polished character image from the supplied reference image.

Camera angle: {view_label}. The character is {view_direction}.

Preserve the character's identity, facial features, hairstyle, body proportions,
clothing, accessories, footwear, art style, texture, and medium from the
reference image unless the user's guidance explicitly requests a change. Show
exactly one complete full-body character in a neutral standing pose with relaxed
arms. Keep the character centered, well lit, and on a clean uniform studio
background. Do not mirror or flip the character. Preserve asymmetric details on
the same side of the character's body.

Do not create a collage, grid, sheet, panels, labels, divider lines, or multiple
views. Output only one image.
"""


def build_character_img2img_prompt(user_guidance: str = "") -> str:
    """Build the prompt for reference-based character generation."""
    prompt = CHARACTER_IMG2IMG_SYSTEM_PROMPT
    if user_guidance:
        prompt += f"\nAdditional guidance from user: {user_guidance}\n"
    return prompt


def build_character_img2img_view_prompt(
    user_guidance: str,
    view_label: str,
    view_direction: str,
) -> str:
    """Build a reference-conditioned prompt for one character turnaround view."""
    prompt = CHARACTER_IMG2IMG_VIEW_PROMPT.format(
        view_label=view_label,
        view_direction=view_direction,
    )
    if user_guidance:
        prompt += f"\nAdditional guidance from user: {user_guidance}\n"
    return prompt
