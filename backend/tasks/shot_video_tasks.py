from datetime import UTC, datetime, timedelta
from typing import Any

from core.celery_app import celery_app
from core.config import get_settings
from core.supabase_client import get_supabase_client
from services.wavespeed_service import (
    WaveSpeedServiceError,
    get_seedance_shot_video_result,
    store_seedance_shot_video,
    submit_seedance_shot_video,
)


TERMINAL_STATUSES = {"complete", "failed", "cancelled"}


def _update_batch(batch_id: str) -> None:
    supabase = get_supabase_client()
    if not supabase:
        raise RuntimeError("Supabase client not initialized")
    jobs = supabase.table("generation_jobs").select("status").eq("batch_id", batch_id).execute().data or []
    statuses = [job.get("status") for job in jobs]
    completed = statuses.count("complete")
    failed = statuses.count("failed")
    if statuses and completed + failed == len(statuses):
        status = "complete" if not failed else ("failed" if not completed else "complete")
        completed_at = datetime.now(UTC).isoformat()
    elif any(status == "in_progress" for status in statuses):
        status = "running"
        completed_at = None
    else:
        status = "queued"
        completed_at = None
    supabase.table("video_generation_batches").update({
        "status": status,
        "total_jobs": len(statuses),
        "completed_jobs": completed,
        "failed_jobs": failed,
        "completed_at": completed_at,
        "error_message": "One or more shots failed" if failed else None,
    }).eq("id", batch_id).execute()


def _mark_failed(job_id: str, batch_id: str, message: str) -> None:
    supabase = get_supabase_client()
    if not supabase:
        raise RuntimeError("Supabase client not initialized")
    supabase.table("generation_jobs").update({"status": "failed", "error_message": message}).eq("id", job_id).execute()
    _update_batch(batch_id)


@celery_app.task(name="tasks.shot_video_tasks.submit_shot_video", bind=True, max_retries=3)
def submit_shot_video(self: Any, job_id: str) -> None:
    supabase = get_supabase_client()
    if not supabase:
        raise RuntimeError("Supabase client not initialized")
    job_result = supabase.table("generation_jobs").select("*").eq("id", job_id).single().execute()
    job = job_result.data
    if not job or job.get("status") in TERMINAL_STATUSES:
        return
    batch_id = job.get("batch_id")
    if not batch_id:
        supabase.table("generation_jobs").update({
            "status": "failed", "error_message": "Shot video job is missing its batch",
        }).eq("id", job_id).execute()
        return
    settings = job.get("settings") or {}
    if job.get("provider_prediction_id"):
        poll_shot_video.apply_async(args=[job_id], countdown=get_settings().shot_video_poll_seconds)
        return
    image_url = settings.get("storyboard_image_url")
    if not isinstance(image_url, str) or not image_url:
        _mark_failed(job_id, batch_id, "Storyboard image URL is missing")
        return
    try:
        prediction_id, result_url = submit_seedance_shot_video(
            image_url=image_url,
            prompt=job.get("prompt") or "Cinematic motion matching the storyboard frame.",
            duration=int(settings["duration"]),
            resolution=str(settings["resolution"]),
            aspect_ratio=str(settings["aspect_ratio"]),
            generate_audio=bool(settings["generate_audio"]),
        )
        supabase.table("generation_jobs").update({
            "status": "in_progress",
            "provider_prediction_id": prediction_id,
            "provider_result_url": result_url,
            "attempt_count": int(job.get("attempt_count") or 0) + 1,
            "next_poll_at": (datetime.now(UTC) + timedelta(seconds=get_settings().shot_video_poll_seconds)).isoformat(),
        }).eq("id", job_id).execute()
        _update_batch(batch_id)
        poll_shot_video.apply_async(args=[job_id], countdown=get_settings().shot_video_poll_seconds)
    except WaveSpeedServiceError as error:
        raise self.retry(exc=error, countdown=10)


@celery_app.task(name="tasks.shot_video_tasks.poll_shot_video", bind=True, max_retries=180)
def poll_shot_video(self: Any, job_id: str) -> None:
    supabase = get_supabase_client()
    if not supabase:
        raise RuntimeError("Supabase client not initialized")
    job = supabase.table("generation_jobs").select("*").eq("id", job_id).single().execute().data
    if not job or job.get("status") in TERMINAL_STATUSES:
        return
    batch_id = job.get("batch_id")
    if not batch_id or not job.get("provider_result_url"):
        _mark_failed(job_id, batch_id or "", "Shot video prediction was not submitted")
        return
    try:
        result = get_seedance_shot_video_result(job["provider_result_url"])
    except WaveSpeedServiceError as error:
        raise self.retry(exc=error, countdown=get_settings().shot_video_poll_seconds)

    status = str(result.get("status") or "").lower()
    if status in {"created", "processing"}:
        supabase.table("generation_jobs").update({
            "status": "in_progress",
            "next_poll_at": (datetime.now(UTC) + timedelta(seconds=get_settings().shot_video_poll_seconds)).isoformat(),
        }).eq("id", job_id).execute()
        raise self.retry(countdown=get_settings().shot_video_poll_seconds)
    if status != "completed":
        _mark_failed(job_id, batch_id, str(result.get("error") or f"WaveSpeed prediction {status or 'failed'}"))
        return

    outputs = result.get("outputs")
    output_url = outputs[0] if isinstance(outputs, list) and outputs and isinstance(outputs[0], str) else None
    if not output_url:
        _mark_failed(job_id, batch_id, "WaveSpeed completed without a video output")
        return
    existing = supabase.table("generation_outputs").select("asset_id").eq("generation_job_id", job_id).execute().data or []
    if not existing:
        try:
            video_url, storage_path = store_seedance_shot_video(output_url, job["project_id"], job["shot_id"], batch_id)
            asset = supabase.table("assets").insert({
                "project_id": job["project_id"], "type": "video", "source": "generation",
                "name": f"Shot video {job.get('shot_id')}", "url": video_url,
                "storage_path": storage_path, "mime_type": "video/mp4",
                "duration_seconds": (job.get("settings") or {}).get("duration"),
                "metadata": {"batch_id": batch_id, "generation_job_id": job_id, "provider_prediction_id": job.get("provider_prediction_id")},
            }).execute().data
            if not asset:
                raise RuntimeError("Failed to store generated shot video asset")
            asset_id = asset[0]["id"]
            supabase.table("generation_outputs").insert({"generation_job_id": job_id, "asset_id": asset_id, "selected": True}).execute()
            supabase.table("asset_links").insert({
                "project_id": job["project_id"], "asset_id": asset_id, "target_type": "shot",
                "target_id": job["shot_id"], "role": "video", "metadata": {"batch_id": batch_id, "generation_job_id": job_id},
            }).execute()
        except Exception as error:
            _mark_failed(job_id, batch_id, f"Failed to persist generated video: {error}")
            return
    supabase.table("generation_jobs").update({"status": "complete", "error_message": None, "completed_at": datetime.now(UTC).isoformat()}).eq("id", job_id).execute()
    _update_batch(batch_id)