import concurrent.futures
import json
import os
import re
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
import replicate

from core.config import get_settings
from core.supabase_client import get_supabase_client
from schemas.image_generation import (
    CreateImageRequest,
    GenerateStoryboardResponse,
    StoryboardFrame,
)
from services.image_generation_service import generate_provider_images
from services.project_visual_style import ProjectVisualStyle, apply_visual_style, load_project_visual_style


STORYBOARD_MODEL = "nanobanana"
MIN_STORYBOARD_FRAMES = 2
MAX_STORYBOARD_FRAMES = 8


def _extract_json_object(value: str) -> dict[str, Any]:
    cleaned = value.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Storyboard planner did not return a JSON object")
    result = json.loads(cleaned[start : end + 1])
    if not isinstance(result, dict):
        raise ValueError("Storyboard planner returned an invalid response")
    return result


def _scene_context(
    scene: dict[str, Any],
    blocks: list[dict[str, Any]],
    characters: list[dict[str, Any]] | None = None,
    environment: dict[str, Any] | None = None,
    objects: list[dict[str, Any]] | None = None,
    visual_style: ProjectVisualStyle | None = None,
) -> str:
    lines = []
    for b in blocks:
        if not b.get("content"):
            continue
        b_type = str(b.get("block_type", "action")).upper()
        c_name = f" ({b['character_name']})" if b.get("character_name") else ""
        lines.append(f"{b_type}{c_name}: {b['content']}")
    block_text = "\n".join(lines)
    
    char_lines = []
    for c in characters or []:
        c_name = c.get("name", "Unknown Character")
        views = c.get("views", {})
        view_summary = ", ".join(f"{v}: {url}" for v, url in views.items() if url)
        char_lines.append(
            f"- {c_name} (Role: {c.get('role', 'N/A')}, Age: {c.get('age', 'N/A')}, Gender: {c.get('gender', 'N/A')}, Race: {c.get('race', 'N/A')})\n"
            f"  Appearance: {c.get('appearance', 'N/A')}\n"
            f"  Visual Keyframe Views: {view_summary or 'None'}"
        )
    char_text = "\n".join(char_lines) if char_lines else "No specific character keyframes linked."

    env_text = "No specific environment reference linked."
    if environment:
        env_text = (
            f"Name: {environment.get('name', 'N/A')}\n"
            f"Prompt/Details: {environment.get('prompt', 'N/A')}\n"
            f"Reference Image URL: {environment.get('image_url', 'None')}"
        )

    obj_lines = [
        f"- {o.get('name', 'Object')}: {o.get('prompt', 'N/A')} (Reference Image: {o.get('image_url', 'None')})"
        for o in objects or []
    ]
    obj_text = "\n".join(obj_lines) if obj_lines else "No specific object references linked."

    style_text = visual_style.prompt_block() if visual_style else "No project visual contract is available."
    return f"""Slugline: {scene.get('slugline_raw') or 'Untitled scene'}
Location: {scene.get('location') or 'Unknown'}
Time: {scene.get('time_of_day') or 'Unknown'}
Scene Summary: {scene.get('summary') or 'No summary provided.'}

=== PROJECT VISUAL CONTRACT ===
{style_text}

=== LINKED VISUAL ENTITIES ===
CHARACTERS:
{char_text}

ENVIRONMENT LOOK:
{env_text}

OBJECTS / PROPS:
{obj_text}

=== SCREENPLAY ACTION & DIALOGUE BEATS ===
{block_text or 'No screenplay blocks are available.'}"""


def _plan_storyboard_frames(
    scene: dict[str, Any],
    blocks: list[dict[str, Any]],
    characters: list[dict[str, Any]] | None = None,
    environment: dict[str, Any] | None = None,
    objects: list[dict[str, Any]] | None = None,
    visual_style: ProjectVisualStyle | None = None,
) -> list[dict[str, Any]]:
    settings = get_settings()
    if not settings.replicate_api_token:
        raise RuntimeError("REPLICATE_API_TOKEN not configured")

    prompt = f"""You are an expert cinematic storyboard director. Break the following screenplay scene into essential visual 16:9 storyboard stills based on the action lines and linked visual assets.

{_scene_context(scene, blocks, characters, environment, objects, visual_style)}

Create between {MIN_STORYBOARD_FRAMES} and {MAX_STORYBOARD_FRAMES} shots based on character actions, dialogue beats, and visual changes. Use fewer shots for simple moments and more only when narrative needs them.

Return ONLY valid JSON in this exact shape:
{{
  "shots": [
    {{
      "description": "What the frame shows and its narrative purpose",
      "camera_angle": "wide shot, medium shot, close-up, over the shoulder, etc.",
      "camera_motion": "static, tracking shot, pan, zoom in, etc.",
      "prompt": "A complete cinematic image-generation prompt for one 16:9 storyboard still",
      "image_references": ["http://url-of-character-keyframe-or-environment-if-applicable"]
    }}
  ]
}}

Each prompt must describe one single finished 16:9 cinematic previs frame. It must obey the project visual contract and match linked reference assets. Do not request collages, split screens, text overlays, multiple panels, rough sketches, or a different rendering medium."""
    client = replicate.Client(api_token=settings.replicate_api_token)
    output = client.run("google/gemini-2.5-flash", input={"prompt": prompt})
    text = output if isinstance(output, str) else "".join(output)
    planned = _extract_json_object(text).get("shots")
    if not isinstance(planned, list):
        raise ValueError("Storyboard planner response is missing shots")

    frames: list[dict[str, Any]] = []
    for raw_frame in planned[:MAX_STORYBOARD_FRAMES]:
        if not isinstance(raw_frame, dict):
            continue
        description = str(raw_frame.get("description") or "").strip()
        image_prompt = str(raw_frame.get("prompt") or "").strip()
        if not description or not image_prompt:
            continue
        refs = raw_frame.get("image_references")
        image_refs = [str(r).strip() for r in refs if isinstance(r, str) and str(r).strip()] if isinstance(refs, list) else []
        frames.append({
            "description": description,
            "camera_angle": str(raw_frame.get("camera_angle") or "").strip(),
            "camera_motion": str(raw_frame.get("camera_motion") or "").strip(),
            "prompt": image_prompt,
            "image_references": image_refs,
        })

    if len(frames) < MIN_STORYBOARD_FRAMES:
        raise ValueError(f"Storyboard planner must produce at least {MIN_STORYBOARD_FRAMES} usable shots")
    return frames


def _frame_response(shot: dict[str, Any], image_url: str | None = None, error: str | None = None) -> StoryboardFrame:
    return StoryboardFrame(
        shot_id=shot["id"],
        shot_number=shot.get("shot_number") or shot.get("sort_order", 0) + 1,
        description=shot.get("description") or "Untitled shot",
        camera_angle=shot.get("camera_angle"),
        camera_motion=shot.get("camera_motion"),
        prompt=shot.get("prompt") or "",
        image_url=image_url,
        status=shot.get("status") or ("failed" if error else "pending"),
        error=error,
    )


def _existing_storyboard(project_id: str, scene_id: str) -> GenerateStoryboardResponse | None:
    supabase = get_supabase_client()
    shots_result = supabase.table("shots").select(
        "id, shot_number, description, camera_angle, camera_motion, prompt, status, sort_order"
    ).eq("project_id", project_id).eq("scene_id", scene_id).order("sort_order").execute()
    shots = shots_result.data or []
    if not shots:
        return None

    shot_ids = [shot["id"] for shot in shots]
    links_result = supabase.table("asset_links").select("target_id, asset_id").eq(
        "project_id", project_id
    ).eq("target_type", "shot").eq("role", "storyboard").in_("target_id", shot_ids).execute()
    links = links_result.data or []
    if not links:
        return None

    asset_ids = [link["asset_id"] for link in links]
    assets_result = supabase.table("assets").select("id, url").in_("id", asset_ids).execute()
    urls = {asset["id"]: asset["url"] for asset in assets_result.data or []}
    image_by_shot = {link["target_id"]: urls.get(link["asset_id"]) for link in links}
    return GenerateStoryboardResponse(
        scene_id=scene_id,
        status="complete",
        reused=True,
        frames=[_frame_response(shot, image_by_shot.get(shot["id"])) for shot in shots],
    )


def _persist_frame_image(
    project_id: str,
    scene_id: str,
    job_id: str,
    shot: dict[str, Any],
    source_url: str,
    output_index: int,
) -> str:
    supabase = get_supabase_client()
    download = httpx.get(source_url, timeout=60.0)
    download.raise_for_status()
    storage_path = f"storyboards/{scene_id}/{job_id}/{output_index}_{uuid.uuid4().hex}.jpg"
    supabase.storage.from_("output-images").upload(
        file=download.content,
        path=storage_path,
        file_options={"content-type": "image/jpeg"},
    )
    image_url = supabase.storage.from_("output-images").get_public_url(storage_path)
    asset_result = supabase.table("assets").insert({
        "project_id": project_id,
        "type": "image",
        "source": "generation",
        "name": f"Storyboard - {shot['shot_number']}",
        "url": image_url,
        "storage_path": storage_path,
        "mime_type": "image/jpeg",
        "metadata": {"storyboard": True, "scene_id": scene_id, "shot_id": shot["id"]},
    }).execute()
    if not asset_result.data:
        raise RuntimeError("Failed to save storyboard image asset")
    asset_id = asset_result.data[0]["id"]
    supabase.table("generation_outputs").insert({
        "generation_job_id": job_id,
        "asset_id": asset_id,
        "output_index": output_index,
        "selected": output_index == 0,
        "metadata": {"shot_id": shot["id"], "prompt": shot.get("prompt", "")},
    }).execute()
    supabase.table("asset_links").insert({
        "project_id": project_id,
        "asset_id": asset_id,
        "target_type": "shot",
        "target_id": shot["id"],
        "role": "storyboard",
        "sort_order": output_index,
    }).execute()
    supabase.table("shots").update({"status": "complete"}).eq("id", shot["id"]).execute()
    return image_url


def _gather_scene_linked_entities(
    project_id: str, scene_id: str, blocks: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, list[dict[str, Any]]]:
    """Gather all character keyframe views, environment images, and object/prop images for a scene."""
    supabase = get_supabase_client()

    # 1. Characters
    characters_out: list[dict[str, Any]] = []
    char_names = {
        block["character_name"].strip().upper()
        for block in blocks
        if block.get("character_name") and str(block["character_name"]).strip()
    }
    if char_names:
        chars_res = supabase.table("characters").select(
            "id, name, role, age, gender, race, appearance, personality"
        ).eq("project_id", project_id).execute()
        scene_chars = [c for c in (chars_res.data or []) if c.get("name", "").strip().upper() in char_names]
        
        char_ids = [c["id"] for c in scene_chars]
        if char_ids:
            links_res = supabase.table("asset_links").select("target_id, asset_id, metadata").eq(
                "project_id", project_id
            ).eq("target_type", "character").in_("target_id", char_ids).execute()
            links = links_res.data or []
            
            asset_ids = [l["asset_id"] for l in links if l.get("asset_id")]
            assets_dict = {}
            if asset_ids:
                assets_res = supabase.table("assets").select("id, url").in_("id", asset_ids).execute()
                assets_dict = {a["id"]: a["url"] for a in (assets_res.data or [])}

            links_by_char: dict[str, dict[str, str]] = {}
            for l in links:
                c_id = l["target_id"]
                view = (l.get("metadata") or {}).get("view") or "front"
                url = assets_dict.get(l["asset_id"])
                if url:
                    if c_id not in links_by_char:
                        links_by_char[c_id] = {}
                    links_by_char[c_id][view] = url

            for c in scene_chars:
                characters_out.append({
                    **c,
                    "views": links_by_char.get(c["id"], {}),
                })

    # 2. Environment
    environment_out: dict[str, Any] | None = None
    env_res = supabase.table("environments").select(
        "id, name, description, primary_asset_id"
    ).eq("project_id", project_id).execute()
    all_envs = env_res.data or []
    if all_envs:
        scene_info = supabase.table("scenes").select("location").eq("id", scene_id).maybe_single().execute()
        loc_name = (scene_info.data or {}).get("location", "").strip().upper()
        matched_env = next((e for e in all_envs if e.get("name", "").strip().upper() == loc_name), all_envs[0] if all_envs else None)
        if matched_env:
            env_url = None
            if matched_env.get("primary_asset_id"):
                a_res = supabase.table("assets").select("url").eq("id", matched_env["primary_asset_id"]).maybe_single().execute()
                env_url = (a_res.data or {}).get("url")
            environment_out = {
                **matched_env,
                "image_url": env_url,
            }

    # 3. Objects / Props
    objects_out: list[dict[str, Any]] = []
    objs_res = supabase.table("props").select("id, name, description, primary_asset_id").eq("project_id", project_id).execute()
    if objs_res.data:
        for obj in objs_res.data:
            obj_url = None
            if obj.get("primary_asset_id"):
                a_res = supabase.table("assets").select("url").eq("id", obj["primary_asset_id"]).maybe_single().execute()
                obj_url = (a_res.data or {}).get("url")
            objects_out.append({
                **obj,
                "image_url": obj_url,
            })

    return characters_out, environment_out, objects_out


def generate_scene_storyboard(
    project_id: str,
    scene_id: str,
    force_regenerate: bool = False,
    provider: str = "replicate",
    model: str = STORYBOARD_MODEL,
) -> GenerateStoryboardResponse:
    """Plan and generate durable storyboard stills for one screenplay scene."""
    supabase = get_supabase_client()
    if not supabase:
        raise RuntimeError("Supabase client not initialized")

    if not force_regenerate:
        existing = _existing_storyboard(project_id, scene_id)
        if existing:
            return existing

    scene_result = supabase.table("scenes").select(
        "id, project_id, slugline_raw, location, time_of_day, summary"
    ).eq("id", scene_id).eq("project_id", project_id).execute()
    if not scene_result.data:
        raise ValueError("Scene was not found in this project")
    scene = scene_result.data[0]
    blocks_result = supabase.table("script_blocks").select(
        "block_type, content, character_name, sort_order"
    ).eq("project_id", project_id).eq("scene_id", scene_id).order("sort_order").execute()
    blocks = blocks_result.data or []

    visual_style = load_project_visual_style(project_id, supabase)
    characters, environment, objects = _gather_scene_linked_entities(project_id, scene_id, blocks)
    planned_frames = _plan_storyboard_frames(scene, blocks, characters, environment, objects, visual_style)

    if force_regenerate:
        # Delete old shots and linked storyboard asset_links
        old_shots_res = supabase.table("shots").select("id").eq("scene_id", scene_id).eq("project_id", project_id).execute()
        old_shot_ids = [s["id"] for s in (old_shots_res.data or [])]
        if old_shot_ids:
            supabase.table("asset_links").delete().eq("project_id", project_id).eq("target_type", "shot").eq("role", "storyboard").in_("target_id", old_shot_ids).execute()
            supabase.table("shots").delete().eq("scene_id", scene_id).eq("project_id", project_id).execute()

    shots_result = supabase.table("shots").insert([
        {
            "project_id": project_id,
            "scene_id": scene_id,
            "shot_number": index + 1,
            "description": frame["description"],
            "camera_angle": frame["camera_angle"] or None,
            "camera_motion": frame["camera_motion"] or None,
            "prompt": frame["prompt"],
            "status": "in_progress",
            "sort_order": index,
        }
        for index, frame in enumerate(planned_frames)
    ]).execute()
    shots = shots_result.data or []
    if len(shots) != len(planned_frames):
        raise RuntimeError("Failed to create storyboard shots")

    job_result = supabase.table("generation_jobs").insert({
        "project_id": project_id,
        "scene_id": scene_id,
        "kind": "storyboard",
        "model": model,
        "prompt": _scene_context(scene, blocks, characters, environment, objects, visual_style),
        "settings": {"frame_count": len(shots), "prompts": [frame["prompt"] for frame in planned_frames]},
        "status": "running",
    }).execute()
    if not job_result.data:
        raise RuntimeError("Failed to create storyboard generation job")
    job_id = job_result.data[0]["id"]

    concurrency_limit = max(1, int(os.getenv("STORYBOARD_GENERATION_CONCURRENCY", "3")))

    def generate_image(shot: dict[str, Any], frame_meta: dict[str, Any]) -> str:
        image_inputs = frame_meta.get("image_references") or []
        response = generate_provider_images(CreateImageRequest(
            model=model,
            provider=provider,
            prompt=apply_visual_style(shot["prompt"], visual_style),
            aspect_ratio="16:9",
            num_images=1,
            resolution="1k",
            image_search=False,
            google_search=False,
            output_format="jpg",
            image_input=image_inputs if image_inputs else None,
            project_id=project_id,
        ))
        if not response.images:
            raise RuntimeError("Image model did not return a storyboard image")
        return response.images[0]

    results: list[tuple[dict[str, Any], str | None, str | None]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency_limit) as executor:
        future_to_shot = {
            executor.submit(generate_image, shot, planned_frames[idx]): shot
            for idx, shot in enumerate(shots)
        }
        for future in concurrent.futures.as_completed(future_to_shot):
            shot = future_to_shot[future]
            try:
                results.append((shot, future.result(), None))
            except Exception as error:
                results.append((shot, None, str(error)))

    response_frames: list[StoryboardFrame] = []
    has_failure = False
    for shot, source_url, generation_error in sorted(results, key=lambda result: result[0].get("sort_order", 0)):
        if generation_error or not source_url:
            has_failure = True
            supabase.table("shots").update({"status": "failed"}).eq("id", shot["id"]).execute()
            response_frames.append(_frame_response({**shot, "status": "failed"}, error=generation_error))
            continue
        try:
            image_url = _persist_frame_image(project_id, scene_id, job_id, shot, source_url, shot["sort_order"])
            response_frames.append(_frame_response({**shot, "status": "complete"}, image_url=image_url))
        except Exception as error:
            has_failure = True
            message = str(error)
            supabase.table("shots").update({"status": "failed"}).eq("id", shot["id"]).execute()
            response_frames.append(_frame_response({**shot, "status": "failed"}, error=message))

    status = "failed" if has_failure else "complete"
    supabase.table("generation_jobs").update({
        "status": status,
        "completed_at": datetime.now(UTC).isoformat() if not has_failure else None,
        "error_message": "One or more storyboard frames failed" if has_failure else None,
    }).eq("id", job_id).execute()
    return GenerateStoryboardResponse(
        scene_id=scene_id,
        generation_job_id=job_id,
        status="partial" if has_failure and any(frame.image_url for frame in response_frames) else status,
        frames=response_frames,
    )


def regenerate_single_shot_frame(
    project_id: str,
    shot_id: str,
    prompt_override: str | None = None,
    provider: str = "replicate",
    model: str = STORYBOARD_MODEL,
) -> StoryboardFrame:
    """Regenerate a single storyboard frame/shot."""
    supabase = get_supabase_client()
    if not supabase:
        raise RuntimeError("Supabase client not initialized")

    shot_res = supabase.table("shots").select("*").eq("id", shot_id).eq("project_id", project_id).single().execute()
    if not shot_res.data:
        raise ValueError("Shot was not found")
    shot = shot_res.data

    prompt = prompt_override.strip() if prompt_override and prompt_override.strip() else shot.get("prompt", "")
    if not prompt:
        raise ValueError("Prompt is required to regenerate shot")
    visual_style = load_project_visual_style(project_id, supabase)

    if prompt != shot.get("prompt"):
        supabase.table("shots").update({"prompt": prompt, "status": "in_progress"}).eq("id", shot_id).execute()
    else:
        supabase.table("shots").update({"status": "in_progress"}).eq("id", shot_id).execute()

    job_result = supabase.table("generation_jobs").insert({
        "project_id": project_id,
        "scene_id": shot["scene_id"],
        "shot_id": shot_id,
        "kind": "storyboard",
        "model": model,
        "prompt": apply_visual_style(prompt, visual_style),
        "settings": {"regeneration": True, "provider": provider},
        "status": "running",
    }).execute()
    if not job_result.data:
        raise RuntimeError("Failed to create storyboard regeneration job")
    job_id = job_result.data[0]["id"]

    try:
        response = generate_provider_images(CreateImageRequest(
            model=model,
            provider=provider,
            prompt=apply_visual_style(prompt, visual_style),
            aspect_ratio="16:9",
            num_images=1,
            resolution="1k",
            image_search=False,
            google_search=False,
            output_format="jpg",
            project_id=project_id,
        ))
        if not response.images:
            error_message = "Image model returned no image"
            supabase.table("shots").update({"status": "failed"}).eq("id", shot_id).execute()
            supabase.table("generation_jobs").update({
                "status": "failed",
                "error_message": error_message,
            }).eq("id", job_id).execute()
            return _frame_response({**shot, "status": "failed"}, error=error_message)

        source_url = response.images[0]

        # Delete previous asset links for this shot
        supabase.table("asset_links").delete().eq("project_id", project_id).eq("target_type", "shot").eq("role", "storyboard").eq("target_id", shot_id).execute()

        image_url = _persist_frame_image(
            project_id,
            shot["scene_id"],
            job_id,
            {**shot, "prompt": apply_visual_style(prompt, visual_style)},
            source_url,
            shot.get("sort_order", 0),
        )
    except Exception as error:
        supabase.table("shots").update({"status": "failed"}).eq("id", shot_id).execute()
        supabase.table("generation_jobs").update({
            "status": "failed",
            "error_message": str(error),
        }).eq("id", job_id).execute()
        raise

    supabase.table("generation_jobs").update({
        "status": "complete",
        "completed_at": datetime.now(UTC).isoformat(),
    }).eq("id", job_id).execute()
    return _frame_response({**shot, "prompt": prompt, "status": "complete"}, image_url=image_url)

