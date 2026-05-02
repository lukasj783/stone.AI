import uuid
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
    BatchDeleteRequest
)
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
