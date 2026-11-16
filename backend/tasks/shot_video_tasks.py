from datetime import UTC, datetime, timedelta
from typing import Any

from core.celery_app import celery_app
from core.config import get_settings
from core.supabase_client import require_supabase_client
from core.supabase_records import as_record, as_records
from services.wavespeed_service import (
    WaveSpeedServiceError,
    get_seedance_shot_video_result,
    store_seedance_shot_video,
    submit_seedance_shot_video,
)


TERMINAL_STATUSES = {"complete", "failed", "cancelled"}


def _update_batch(batch_id: str) -> None:
    supabase = require_supabase_client()
    rows = supabase.table("generation_jobs").select("status").eq("batch_id", batch_id).execute().data
    statuses: list[str] = []
    for record in as_records(rows):
        job_status = record.get("status")
        if isinstance(job_status, str):
            statuses.append(job_status)
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
    supabase = require_supabase_client()
    supabase.table("generation_jobs").update({"status": "failed", "error_message": message}).eq("id", job_id).execute()
    _update_batch(batch_id)


@celery_app.task(name="tasks.shot_video_tasks.submit_shot_video", bind=True, max_retries=3)
def submit_shot_video(self: Any, job_id: str) -> None:
    supabase = require_supabase_client()
    job_result = supabase.table("generation_jobs").select("*").eq("id", job_id).single().execute()
    job = as_record(job_result.data)
    if job is None:
        return
    job_status = job.get("status")
    if isinstance(job_status, str) and job_status in TERMINAL_STATUSES:
        return
    batch_id = job.get("batch_id")
    if not isinstance(batch_id, str) or not batch_id:
        supabase.table("generation_jobs").update({
            "status": "failed", "error_message": "Shot video job is missing its batch",
        }).eq("id", job_id).execute()
        return
    settings: dict[str, Any] = as_record(job.get("settings")) or {}
    if job.get("provider_prediction_id"):
        poll_shot_video.apply_async(args=[job_id], countdown=get_settings().shot_video_poll_seconds)
        return
    image_url = settings.get("storyboard_image_url")
    if not isinstance(image_url, str) or not image_url:
        _mark_failed(job_id, batch_id, "Storyboard image URL is missing")
        return
    duration = settings.get("duration")
    resolution = settings.get("resolution")
    aspect_ratio = settings.get("aspect_ratio")
    generate_audio = settings.get("generate_audio")
    if (
        not isinstance(duration, (int, float))
        or not isinstance(resolution, str)
        or not isinstance(aspect_ratio, str)
        or not isinstance(generate_audio, bool)
    ):
        _mark_failed(job_id, batch_id, "Shot video settings are incomplete")
        return
    prompt = job.get("prompt")
    if not isinstance(prompt, str) or not prompt:
        prompt = "Cinematic motion matching the storyboard frame."
    try:
        prediction_id, result_url = submit_seedance_shot_video(
            image_url=image_url,
            prompt=prompt,
            duration=int(duration),
            resolution=resolution,
            aspect_ratio=aspect_ratio,
            generate_audio=generate_audio,
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
    supabase = require_supabase_client()
    job = as_record(supabase.table("generation_jobs").select("*").eq("id", job_id).single().execute().data)
    if job is None:
        return
    job_status = job.get("status")
    if isinstance(job_status, str) and job_status in TERMINAL_STATUSES:
        return
    raw_batch_id = job.get("batch_id")
    batch_id = raw_batch_id if isinstance(raw_batch_id, str) else ""
    result_url = job.get("provider_result_url")
    if not batch_id or not isinstance(result_url, str) or not result_url:
        _mark_failed(job_id, batch_id, "Shot video prediction was not submitted")
        return
    try:
        result = get_seedance_shot_video_result(result_url)
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
    project_id = job.get("project_id")
    shot_id = job.get("shot_id")
    if not isinstance(project_id, str) or not isinstance(shot_id, str) or not project_id or not shot_id:
        _mark_failed(job_id, batch_id, "Shot video job is missing its project or shot reference")
        return
    settings = as_record(job.get("settings")) or {}
    provider_prediction_id = job.get("provider_prediction_id")
    existing = as_records(
        supabase.table("generation_outputs").select("asset_id").eq("generation_job_id", job_id).execute().data
    )
    if not existing:
        try:
            video_url, storage_path = store_seedance_shot_video(output_url, project_id, shot_id, batch_id)
            inserted = as_records(supabase.table("assets").insert({
                "project_id": project_id, "type": "video", "source": "generation",
                "name": f"Shot video {shot_id}", "url": video_url,
                "storage_path": storage_path, "mime_type": "video/mp4",
                "duration_seconds": settings.get("duration"),
                "metadata": {"batch_id": batch_id, "generation_job_id": job_id, "provider_prediction_id": provider_prediction_id},
            }).execute().data)
            if not inserted:
                raise RuntimeError("Failed to store generated shot video asset")
            asset_id = inserted[0].get("id")
            if not isinstance(asset_id, str):
                raise RuntimeError("Stored shot video asset is missing its id")
            supabase.table("generation_outputs").insert({"generation_job_id": job_id, "asset_id": asset_id, "selected": True}).execute()
            supabase.table("asset_links").insert({
                "project_id": project_id, "asset_id": asset_id, "target_type": "shot",
                "target_id": shot_id, "role": "video", "metadata": {"batch_id": batch_id, "generation_job_id": job_id},
            }).execute()
        except Exception as error:
            _mark_failed(job_id, batch_id, f"Failed to persist generated video: {error}")
            return
    supabase.table("generation_jobs").update({"status": "complete", "error_message": None, "completed_at": datetime.now(UTC).isoformat()}).eq("id", job_id).execute()
    _update_batch(batch_id)