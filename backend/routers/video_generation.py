import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, UploadFile, File, BackgroundTasks, Form

from core.supabase_client import get_supabase_client
from schemas.video_generation import (
    CreateImageToVideoRequest,
    CreateImageToVideoResponse,
    CreateVideoRequest,
    CreateVideoResponse,
    ImageToVideoModel,
    CreateMotionTransferRequest,
    CreateMotionTransferResponse,
    MotionTransferModel,
    LipsyncModel,
    CreateLipsyncRequest,
    CreateLipsyncResponse,
    BatchDeleteRequest,
    RetryFailedShotVideosRequest,
    ShotVideoBatchResponse,
    ShotVideoItem,
    ShotListItem,
    ShotListResponse,
    StartShotVideoBatchRequest,
    AddShotVideoToTimelineRequest,
    AddShotVideoToTimelineResponse,
)
from services.duration_budget import MAX_CLIP_SECONDS, MIN_CLIP_SECONDS
from services.project_runtime import load_project_runtime
from tasks.shot_video_tasks import submit_shot_video
from services.wavespeed_service import (
    WaveSpeedServiceError,
    synthesize_image_to_video,
    synthesize_video,
    upload_source_image,
    upload_source_video,
    upload_source_audio,
    synthesize_motion_transfer,
    synthesize_lipsync
)


router = APIRouter(prefix="/api/video", tags=["Video Generation"])


def _shot_list_response(project_id: str) -> ShotListResponse:
    supabase = get_supabase_client()
    if not supabase:
        raise RuntimeError("Supabase client not configured")
    shots = supabase.table("shots").select(
        "id, scene_id, shot_number, description, camera_angle, camera_motion, sort_order, duration_seconds"
    ).eq("project_id", project_id).order("scene_id").order("sort_order").execute().data or []
    target_seconds = load_project_runtime(supabase, project_id).target_seconds
    if not shots:
        return ShotListResponse(project_id=project_id, shots=[], target_seconds=target_seconds)

    scene_ids = list({shot["scene_id"] for shot in shots if shot.get("scene_id")})
    scenes = supabase.table("scenes").select("id, slugline_raw, sort_order").in_("id", scene_ids).execute().data or []
    scene_by_id = {scene["id"]: scene for scene in scenes}
    shot_ids = [shot["id"] for shot in shots]
    links = supabase.table("asset_links").select("target_id, asset_id, role, created_at").eq(
        "project_id", project_id
    ).eq("target_type", "shot").in_("target_id", shot_ids).in_("role", ["storyboard", "video"]).execute().data or []
    asset_ids = list({link["asset_id"] for link in links if link.get("asset_id")})
    assets = supabase.table("assets").select("id, url, duration_seconds").in_("id", asset_ids).execute().data or [] if asset_ids else []
    asset_by_id = {asset["id"]: asset for asset in assets}
    assets_by_shot: dict[str, dict[str, dict[str, object]]] = {}
    for link in links:
        target_id = link.get("target_id")
        role = link.get("role")
        asset = asset_by_id.get(link.get("asset_id"))
        if not isinstance(target_id, str) or role not in {"storyboard", "video"} or not asset:
            continue
        role_assets = assets_by_shot.setdefault(target_id, {})
        existing = role_assets.get(role)
        if not existing or str(link.get("created_at") or "") > str(existing.get("created_at") or ""):
            role_assets[role] = {**asset, "created_at": link.get("created_at")}

    jobs = supabase.table("generation_jobs").select(
        "id, shot_id, batch_id, status, error_message, created_at"
    ).eq("project_id", project_id).eq("kind", "video").in_("shot_id", shot_ids).order("created_at", desc=True).execute().data or []
    latest_job_by_shot: dict[str, dict[str, object]] = {}
    for job in jobs:
        shot_id = job.get("shot_id")
        if isinstance(shot_id, str) and shot_id not in latest_job_by_shot:
            latest_job_by_shot[shot_id] = job

    result: list[ShotListItem] = []
    for shot in shots:
        shot_id = shot["id"]
        scene = scene_by_id.get(shot.get("scene_id"), {})
        linked_assets = assets_by_shot.get(shot_id, {})
        storyboard = linked_assets.get("storyboard")
        video = linked_assets.get("video")
        job = latest_job_by_shot.get(shot_id)
        status = "complete" if video else str(job.get("status")) if job else "missing"
        result.append(ShotListItem(
            shot_id=shot_id,
            scene_id=shot["scene_id"],
            scene_slugline=scene.get("slugline_raw"),
            scene_sort_order=int(scene.get("sort_order") or 0),
            shot_number=shot.get("shot_number"),
            sort_order=int(shot.get("sort_order") or 0),
            description=shot.get("description"),
            camera_angle=shot.get("camera_angle"),
            camera_motion=shot.get("camera_motion"),
            storyboard_url=storyboard.get("url") if storyboard else None,
            video_asset_id=video.get("id") if video else None,
            video_url=video.get("url") if video else None,
            duration_seconds=float(video["duration_seconds"]) if video and video.get("duration_seconds") is not None else None,
            planned_seconds=float(shot["duration_seconds"]) if shot.get("duration_seconds") is not None else None,
            generation_job_id=job.get("id") if job else None,
            batch_id=job.get("batch_id") if job else None,
            status=status,
            error_message=job.get("error_message") if job else None,
        ))
    planned = [item.planned_seconds for item in result if item.planned_seconds is not None]
    rendered = [item.duration_seconds for item in result if item.duration_seconds is not None]
    return ShotListResponse(
        project_id=project_id,
        shots=sorted(result, key=lambda item: (item.scene_sort_order, item.sort_order)),
        target_seconds=target_seconds,
        planned_seconds=round(sum(planned), 3) if planned else None,
        rendered_seconds=round(sum(rendered), 3) if rendered else None,
    )


@router.get("/shot-list", response_model=ShotListResponse)
def get_shot_list(project_id: str) -> ShotListResponse:
    try:
        return _shot_list_response(project_id)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to load shot list: {error}") from error


@router.post("/shot-list/add-to-timeline", response_model=AddShotVideoToTimelineResponse)
def add_shot_video_to_timeline(payload: AddShotVideoToTimelineRequest) -> AddShotVideoToTimelineResponse:
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")
    try:
        asset = supabase.table("assets").select("id, duration_seconds, type").eq("id", payload.asset_id).eq(
            "project_id", payload.project_id
        ).single().execute().data
        if not asset or asset.get("type") != "video":
            raise ValueError("The selected asset is not a video in this project")
        link = supabase.table("asset_links").select("id").eq("project_id", payload.project_id).eq(
            "asset_id", payload.asset_id
        ).eq("target_type", "shot").eq("target_id", payload.shot_id).eq("role", "video").execute().data or []
        if not link:
            raise ValueError("The selected video is not linked to this shot")
        existing = supabase.table("timeline_items").select("id, track_id, start_time").eq(
            "project_id", payload.project_id
        ).eq("asset_id", payload.asset_id).execute().data or []
        if existing:
            item = existing[0]
            return AddShotVideoToTimelineResponse(
                timeline_item_id=item["id"], track_id=item["track_id"], start_time=float(item["start_time"]), created=False,
            )
        track = supabase.table("timeline_tracks").select("id").eq("project_id", payload.project_id).eq(
            "type", "video"
        ).order("sort_order").limit(1).execute().data or []
        if track:
            track_id = track[0]["id"]
        else:
            track_result = supabase.table("timeline_tracks").insert({
                "project_id": payload.project_id, "type": "video", "label": "Shot Videos", "sort_order": 0,
            }).execute().data
            if not track_result:
                raise RuntimeError("Failed to create the video timeline track")
            track_id = track_result[0]["id"]
        items = supabase.table("timeline_items").select("start_time, duration").eq("track_id", track_id).execute().data or []
        start_time = max((float(item.get("start_time") or 0) + float(item.get("duration") or 0) for item in items), default=0.0)
        duration = float(asset.get("duration_seconds") or 5)
        insert_result = supabase.table("timeline_items").insert({
            "project_id": payload.project_id, "track_id": track_id, "asset_id": payload.asset_id,
            "start_time": start_time, "duration": duration,
            "metadata": {"shot_id": payload.shot_id, "source": "shot_list"},
        }).execute().data
        if not insert_result:
            raise RuntimeError("Failed to add shot video to the timeline")
        return AddShotVideoToTimelineResponse(
            timeline_item_id=insert_result[0]["id"], track_id=track_id, start_time=start_time, created=True,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to add shot video to timeline: {error}") from error


def _batch_response(project_id: str, batch_id: str) -> ShotVideoBatchResponse:
    supabase = get_supabase_client()
    if not supabase:
        raise RuntimeError("Supabase client not configured")
    batch = supabase.table("video_generation_batches").select("*").eq("id", batch_id).eq(
        "project_id", project_id
    ).single().execute().data
    if not batch:
        raise ValueError("Shot video batch was not found in this project")

    jobs = supabase.table("generation_jobs").select(
        "id, shot_id, status, error_message"
    ).eq("batch_id", batch_id).order("created_at").execute().data or []
    shot_ids = [job["shot_id"] for job in jobs if job.get("shot_id")]
    shot_numbers: dict[str, int | None] = {}
    if shot_ids:
        shots = supabase.table("shots").select("id, shot_number").in_("id", shot_ids).execute().data or []
        shot_numbers = {shot["id"]: shot.get("shot_number") for shot in shots}

    job_ids = [job["id"] for job in jobs]
    output_asset_ids: dict[str, str] = {}
    if job_ids:
        outputs = supabase.table("generation_outputs").select("generation_job_id, asset_id").in_(
            "generation_job_id", job_ids
        ).execute().data or []
        output_asset_ids = {output["generation_job_id"]: output["asset_id"] for output in outputs}
    asset_urls: dict[str, str] = {}
    if output_asset_ids:
        assets = supabase.table("assets").select("id, url").in_("id", list(output_asset_ids.values())).execute().data or []
        asset_urls = {asset["id"]: asset["url"] for asset in assets}

    return ShotVideoBatchResponse(
        batch_id=batch_id,
        project_id=project_id,
        status=batch["status"],
        total_jobs=batch.get("total_jobs", len(jobs)),
        completed_jobs=batch.get("completed_jobs", 0),
        failed_jobs=batch.get("failed_jobs", 0),
        settings=batch.get("settings") or {},
        jobs=[
            ShotVideoItem(
                generation_job_id=job["id"],
                shot_id=job["shot_id"],
                shot_number=shot_numbers.get(job["shot_id"]),
                status=job["status"],
                error_message=job.get("error_message"),
                video_url=asset_urls.get(output_asset_ids.get(job["id"], "")),
            )
            for job in jobs
            if job.get("shot_id")
        ],
    )


def _shot_clip_seconds(shot: dict, payload: StartShotVideoBatchRequest) -> int:
    """The shot's planned length (from the scene's runtime budget) when there is one,
    otherwise the batch default, clamped to what Seedance renders."""
    planned = shot.get("duration_seconds")
    if not payload.use_shot_durations or planned is None:
        return payload.duration
    try:
        seconds = round(float(planned))
    except (TypeError, ValueError):
        return payload.duration
    return min(MAX_CLIP_SECONDS, max(MIN_CLIP_SECONDS, seconds))


@router.post("/shot-batches", response_model=ShotVideoBatchResponse, status_code=202)
def start_shot_video_batch(payload: StartShotVideoBatchRequest) -> ShotVideoBatchResponse:
    """Queue one Seedance render for every completed storyboard image in a project."""
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")
    try:
        active = supabase.table("video_generation_batches").select("id").eq(
            "project_id", payload.project_id
        ).in_("status", ["queued", "running"]).execute().data or []
        if active:
            raise HTTPException(status_code=409, detail="A shot video batch is already active for this project")

        shots = supabase.table("shots").select(
            "id, shot_number, prompt, camera_motion, duration_seconds"
        ).eq("project_id", payload.project_id).eq("status", "complete").order("scene_id").order("sort_order").execute().data or []
        if not shots:
            raise ValueError("No completed storyboard shots are available for this project")
        shot_ids = [shot["id"] for shot in shots]
        links = supabase.table("asset_links").select("target_id, asset_id").eq(
            "project_id", payload.project_id
        ).eq("target_type", "shot").eq("role", "storyboard").in_("target_id", shot_ids).execute().data or []
        asset_ids = [link["asset_id"] for link in links]
        assets = supabase.table("assets").select("id, url").in_("id", asset_ids).execute().data or [] if asset_ids else []
        image_by_asset = {asset["id"]: asset["url"] for asset in assets}
        image_by_shot = {
            link["target_id"]: image_by_asset.get(link["asset_id"])
            for link in links
            if image_by_asset.get(link["asset_id"])
        }
        eligible_shots = [shot for shot in shots if image_by_shot.get(shot["id"])]
        if not eligible_shots:
            raise ValueError("No completed storyboard image assets are available for this project")

        settings = payload.model_dump()
        settings.pop("project_id")
        batch_result = supabase.table("video_generation_batches").insert({
            "project_id": payload.project_id,
            "model": "bytedance/seedance-2.0/image-to-video",
            "settings": settings,
            "status": "queued",
            "total_jobs": len(eligible_shots),
        }).execute()
        if not batch_result.data:
            raise RuntimeError("Failed to create shot video batch")
        batch_id = batch_result.data[0]["id"]
        jobs_result = supabase.table("generation_jobs").insert([
            {
                "project_id": payload.project_id,
                "shot_id": shot["id"],
                "batch_id": batch_id,
                "kind": "video",
                "model": "bytedance/seedance-2.0/image-to-video",
                "prompt": f"{shot.get('prompt') or ''}\nCamera movement: {shot.get('camera_motion') or 'natural subtle cinematic motion'}".strip(),
                "settings": {
                    **settings,
                    "duration": _shot_clip_seconds(shot, payload),
                    "storyboard_image_url": image_by_shot[shot["id"]],
                },
                "status": "queued",
            }
            for shot in eligible_shots
        ]).execute()
        jobs = jobs_result.data or []
        if len(jobs) != len(eligible_shots):
            raise RuntimeError("Failed to create all shot video jobs")
        for job in jobs:
            submit_shot_video.delay(job["id"])
        return _batch_response(payload.project_id, batch_id)
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to queue shot video batch: {error}") from error


@router.get("/shot-batches/{batch_id}", response_model=ShotVideoBatchResponse)
def get_shot_video_batch(batch_id: str, project_id: str) -> ShotVideoBatchResponse:
    try:
        return _batch_response(project_id, batch_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to load shot video batch: {error}") from error


@router.post("/shot-batches/{batch_id}/retry-failed", response_model=ShotVideoBatchResponse, status_code=202)
def retry_failed_shot_videos(batch_id: str, payload: RetryFailedShotVideosRequest) -> ShotVideoBatchResponse:
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")
    try:
        _batch_response(payload.project_id, batch_id)
        failed_jobs = supabase.table("generation_jobs").select("id").eq("batch_id", batch_id).eq(
            "status", "failed"
        ).execute().data or []
        if not failed_jobs:
            raise ValueError("This batch has no failed shot videos to retry")
        failed_ids = [job["id"] for job in failed_jobs]
        supabase.table("generation_jobs").update({
            "status": "queued", "error_message": None, "provider_prediction_id": None,
            "provider_result_url": None, "next_poll_at": None,
        }).in_("id", failed_ids).execute()
        supabase.table("video_generation_batches").update({
            "status": "queued", "failed_jobs": 0, "completed_at": None,
            "error_message": None, "updated_at": datetime.now(UTC).isoformat(),
        }).eq("id", batch_id).execute()
        for job_id in failed_ids:
            submit_shot_video.delay(job_id)
        return _batch_response(payload.project_id, batch_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to retry shot videos: {error}") from error


def extract_storage_filename(url: str | None) -> str:
    if not url or not isinstance(url, str):
        return ""

    return url.split("/")[-1].split('?')[0]


@router.post("/batch-delete")
def batch_delete_assets(payload: BatchDeleteRequest):
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")
        
    for item in payload.items:
        try:
            target_filename = extract_storage_filename(item.url)
            
            # Extract filename from the standard Supabase public URL structure
            try:
                if target_filename:
                    supabase.storage.from_("output-videos").remove([target_filename])
            except Exception as e:
                print(f"Failed to delete {item.url} from storage: {e}")
                
            # Clean up the DB row
            supabase.table("video_generations").delete().eq("id", item.id).execute()
                    
        except Exception as e:
            print(f"Failed to process delete for video {item.id}: {e}")
            
    return {"message": "Batch delete processed"}


def log_video_to_supabase(request: CreateVideoRequest, url: str):
    supabase = get_supabase_client()
    if supabase:
        try:
            supabase.table("video_generations").insert({
                "generation_type": "text-to-video",
                "model": request.model.value,
                "prompt": request.prompt,
                "aspect_ratio": request.aspect_ratio,
                "duration": request.duration,
                "resolution": request.resolution,
                "result_video_url": url
            }).execute()
        except Exception as e:
            print(f"Failed to log video generation to Supabase: {e}")


def log_image_to_video_to_supabase(request: CreateImageToVideoRequest, url: str):
    supabase = get_supabase_client()
    if supabase:
        try:
            supabase.table("video_generations").insert({
                "generation_type": "image-to-video",
                "model": request.model.value,
                "prompt": request.prompt,
                "aspect_ratio": request.aspect_ratio,
                "duration": request.duration,
                "resolution": request.resolution,
                "result_video_url": url,
            }).execute()
        except Exception as e:
            print(f"Failed to log image-to-video generation to Supabase: {e}")


def log_motion_transfer_to_supabase(request: CreateMotionTransferRequest, url: str):
    supabase = get_supabase_client()
    if supabase:
        try:
            supabase.table("video_generations").insert({
                "generation_type": "motion-transfer",
                "model": request.model.value,
                "prompt": request.prompt,
                "resolution": request.resolution,
                "result_video_url": url,
            }).execute()
        except Exception as e:
            print(f"Failed to log motion-transfer generation to Supabase: {e}")


@router.post("/generate", response_model=CreateVideoResponse)
def generate_video(request: CreateVideoRequest, background_tasks: BackgroundTasks) -> CreateVideoResponse:
    try:
        url = synthesize_video(request)
        background_tasks.add_task(log_video_to_supabase, request, url)
        return CreateVideoResponse(
            model=request.model,
            video_url=url,
        )
    except WaveSpeedServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")


@router.post("/image-to-video", response_model=CreateImageToVideoResponse)
async def generate_image_to_video(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    model: ImageToVideoModel = Form(...),
    prompt: str = Form(...),
    aspect_ratio: str = Form("16:9"),
    duration: int = Form(5),
    resolution: str | None = Form("720p"),
    generate_audio: bool = Form(False),
    cfg_scale: float | None = Form(None),
    shot_type: str | None = Form(None),
    enable_prompt_expansion: bool | None = Form(None),
    seed: int | None = Form(None),
    last_image: str | None = Form(None),
    multi_prompt: str | None = Form(None),
    element_list: str | None = Form(None),
) -> CreateImageToVideoResponse:
    try:
        image_bytes = await image.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="Image file is empty")

        source_image_url = upload_source_image(
            image_bytes,
            image.filename or "image.png",
            image.content_type or "image/png",
        )

        request = CreateImageToVideoRequest(
            model=model,
            prompt=prompt,
            image_url=source_image_url,
            aspect_ratio=aspect_ratio,
            duration=duration,
            resolution=resolution,
            generate_audio=generate_audio,
            cfg_scale=cfg_scale,
            shot_type=shot_type,
            enable_prompt_expansion=enable_prompt_expansion,
            seed=seed,
            last_image=last_image,
            multi_prompt=[item.strip() for item in multi_prompt.splitlines() if item.strip()] if multi_prompt else None,
            element_list=[{"element_id": item.strip()} for item in element_list.splitlines() if item.strip()] if element_list else None,
        )

        url = synthesize_image_to_video(request)
        background_tasks.add_task(log_image_to_video_to_supabase, request, url)
        return CreateImageToVideoResponse(model=model, video_url=url, image_url=source_image_url)
    except HTTPException:
        raise
    except WaveSpeedServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")


@router.post("/motion-transfer", response_model=CreateMotionTransferResponse)
async def generate_motion_transfer(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    video: UploadFile = File(...),
    model: MotionTransferModel = Form(...),
    prompt: str = Form(""),
    resolution: str | None = Form("480p"),
    seed: int | None = Form(-1),
    character_orientation: str | None = Form("video"),
    keep_original_sound: bool | None = Form(True),
    shot_type: str | None = Form("customize"),
    element_list: str | None = Form(None)
) -> CreateMotionTransferResponse:
    try:
        # Process Image
        image_bytes = await image.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="Image file is empty")

        source_image_url = upload_source_image(
            image_bytes,
            image.filename or "image.png",
            image.content_type or "image/png",
        )

        # Process Video
        video_bytes = await video.read()
        if not video_bytes:
            raise HTTPException(status_code=400, detail="Video file is empty")

        source_video_url = upload_source_video(
            video_bytes,
            video.filename or "video.mp4",
            video.content_type or "video/mp4",
        )

        request = CreateMotionTransferRequest(
            model=model,
            image_url=source_image_url,
            video_url=source_video_url,
            prompt=prompt,
            resolution=resolution,
            seed=seed,
            character_orientation=character_orientation,
            keep_original_sound=keep_original_sound,
            shot_type=shot_type,
            element_list=[{"element_id": item.strip()} for item in element_list.splitlines() if item.strip()] if element_list else None,
        )

        url = synthesize_motion_transfer(request)
        background_tasks.add_task(log_motion_transfer_to_supabase, request, url)
        return CreateMotionTransferResponse(model=model, video_url=url, image_url=source_image_url, source_video_url=source_video_url)
    except HTTPException:
        raise
    except WaveSpeedServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")


@router.post("/upload-input")
def upload_input_video(file: UploadFile = File(...)):
    """
    Endpoint for uploading raw input videos into the `input-videos` Supabase storage bucket.
    This can be used for Video-to-Video generation.
    """
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not configured")

    bucket = "input-videos"
    filename = f"upload_{uuid.uuid4().hex}_{file.filename}"
    
    try:
        content = file.file.read()
        supabase.storage.from_(bucket).upload(
            file=content,
            path=filename,
            file_options={"content-type": file.content_type or "video/mp4"}
        )
        url = supabase.storage.from_(bucket).get_public_url(filename)
        return {"url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload to Supabase: {str(e)}")

def log_lipsync_to_supabase(request: CreateLipsyncRequest, url: str):
    supabase = get_supabase_client()
    if supabase:
        try:
            supabase.table("video_generations").insert({
                "generation_type": "lip-sync",
                "model": request.model.value,
                "prompt": "",
                "resolution": request.resolution,
                "result_video_url": url,
            }).execute()
        except Exception as e:
            print(f"Failed to log lipsync generation to Supabase: {e}")

@router.post("/lipsync", response_model=CreateLipsyncResponse)
async def generate_lipsync(
    background_tasks: BackgroundTasks,
    model: LipsyncModel = Form(...),
    image: UploadFile = File(None),
    video: UploadFile = File(None),
    audio: UploadFile = File(None),
    left_audio: UploadFile = File(None),
    right_audio: UploadFile = File(None),
    order: str | None = Form("meanwhile"),
    resolution: str | None = Form("480p"),
    seed: int | None = Form(-1)
) -> CreateLipsyncResponse:
    try:
        source_image_url = None
        if image is not None:
            image_bytes = await image.read()
            if image_bytes:
                source_image_url = upload_source_image(
                    image_bytes, image.filename or "image.png", image.content_type or "image/png"
                )

        source_video_url = None
        if video is not None:
            video_bytes = await video.read()
            if video_bytes:
                source_video_url = upload_source_video(
                    video_bytes, video.filename or "video.mp4", video.content_type or "video/mp4"
                )

        audio_url = None
        if audio is not None:
            audio_bytes = await audio.read()
            if audio_bytes:
                audio_url = upload_source_audio(
                    audio_bytes, audio.filename or "audio.mp3", audio.content_type or "audio/mp3"
                )

        left_audio_url_str = None
        if left_audio is not None:
            left_audio_bytes = await left_audio.read()
            if left_audio_bytes:
                left_audio_url_str = upload_source_audio(
                    left_audio_bytes, left_audio.filename or "left.mp3", left_audio.content_type or "audio/mp3"
                )
                
        right_audio_url_str = None
        if right_audio is not None:
            right_audio_bytes = await right_audio.read()
            if right_audio_bytes:
                right_audio_url_str = upload_source_audio(
                    right_audio_bytes, right_audio.filename or "right.mp3", right_audio.content_type or "audio/mp3"
                )

        request = CreateLipsyncRequest(
            model=model,
            image_url=source_image_url,
            video_url=source_video_url,
            audio_url=audio_url,
            left_audio_url=left_audio_url_str,
            right_audio_url=right_audio_url_str,
            order=order,
            resolution=resolution,
            seed=seed
        )

        url = synthesize_lipsync(request)
        background_tasks.add_task(log_lipsync_to_supabase, request, url)
        return CreateLipsyncResponse(
            model=model, video_url=url, image_url=source_image_url, 
            source_video_url=source_video_url, audio_url=audio_url
        )
    except HTTPException:
        raise
    except WaveSpeedServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")
