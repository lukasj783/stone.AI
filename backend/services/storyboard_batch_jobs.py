"""The two steps of a storyboard batch, shared by both ways of running a batch.

Celery tasks (tasks/storyboard_tasks.py) and the in-backend fallback runner
(services/storyboard_local_runner.py) call these. Each runner passes how to queue the next
step and how to try again later, so the planning and rendering rules live in one place.
"""

import logging
from collections.abc import Callable
from typing import Any

from core.supabase_client import require_supabase_client
from core.supabase_records import as_record, as_records
from services import storyboard_batch as batches
from services.storyboard_generation import (
    STORYBOARD_MODEL,
    STORYBOARD_PROVIDER,
    PreparedSceneStoryboard,
    mark_shot_failed,
    prepare_scene_storyboard,
    refresh_scene_job,
    render_storyboard_shot,
)

logger = logging.getLogger(__name__)

PLAN_MAX_RETRIES = 4
RENDER_MAX_RETRIES = 8

QueueRender = Callable[[str, str], None]
# Called with the error and a delay in seconds when a step should run again later.
RetryLater = Callable[[BaseException, float], None]


def _job_provider_and_model(job: dict[str, Any]) -> tuple[str, str]:
    settings = as_record(job.get("settings")) or {}
    provider = settings.get("provider")
    model = job.get("model")
    return (
        provider if isinstance(provider, str) and provider else STORYBOARD_PROVIDER,
        model if isinstance(model, str) and model else STORYBOARD_MODEL,
    )


def _settle(job_id: str, scene_id: str, batch_id: str | None) -> None:
    refresh_scene_job(job_id, scene_id)
    if batch_id:
        batches.batch_status(batch_id)


def run_plan_step(job_id: str, attempt: int, queue_render: QueueRender, retry_later: RetryLater) -> None:
    """Plan one scene of a batch and queue a render for every frame that still needs an image."""
    job = batches.load_job(job_id)
    if job is None or job.get("status") in batches.TERMINAL_JOB_STATUSES:
        return
    project_id, scene_id = str(job["project_id"]), str(job["scene_id"])
    raw_batch_id = job.get("storyboard_batch_id")
    batch_id = raw_batch_id if isinstance(raw_batch_id, str) else None
    provider, model = _job_provider_and_model(job)
    batches.set_job_planning(job_id)
    try:
        prepared = prepare_scene_storyboard(
            project_id,
            scene_id,
            force_regenerate=True,
            provider=provider,
            model=model,
            job_id=job_id,
            storyboard_batch_id=batch_id,
            reuse_matching_shots=True,
        )
    except Exception as error:  # noqa: BLE001 - every failure is stored on the scene job
        if batches.is_retryable(error) and attempt < PLAN_MAX_RETRIES:
            retry_later(error, batches.retry_delay_seconds(attempt))
            return
        logger.warning("Storyboard planning failed for scene %s: %s", scene_id, error)
        batches.set_job_failed(job_id, batches.describe_failure(error))
        if batch_id:
            batches.batch_status(batch_id)
        return

    if not isinstance(prepared, PreparedSceneStoryboard) or not prepared.pending_shots:
        _settle(job_id, scene_id, batch_id)
        return
    for shot in prepared.pending_shots:
        queue_render(job_id, str(shot["id"]))


def run_render_step(job_id: str, shot_id: str, attempt: int, retry_later: RetryLater) -> None:
    """Render one frame of a batch; busy-provider errors are retried later, others mark the frame failed."""
    job = batches.load_job(job_id)
    if job is None or job.get("status") == "cancelled":
        return
    supabase = require_supabase_client()
    shots = as_records(supabase.table("shots").select(
        "id, project_id, scene_id, shot_number, prompt, status, sort_order, metadata"
    ).eq("id", shot_id).limit(1).execute().data)
    if not shots:
        return
    shot = shots[0]
    project_id, scene_id = str(shot["project_id"]), str(shot["scene_id"])
    raw_batch_id = job.get("storyboard_batch_id")
    batch_id = raw_batch_id if isinstance(raw_batch_id, str) else None
    if shot.get("status") == "complete":
        # Already rendered (a repeated step): don't pay for the frame twice.
        _settle(job_id, scene_id, batch_id)
        return

    provider, model = _job_provider_and_model(job)
    try:
        render_storyboard_shot(project_id, scene_id, job_id, shot, provider=provider, model=model)
    except Exception as error:  # noqa: BLE001 - every failure is stored on the shot
        if batches.is_retryable(error) and attempt < RENDER_MAX_RETRIES:
            retry_later(error, batches.retry_delay_seconds(attempt))
            return
        message = batches.describe_failure(error)
        logger.warning("Storyboard frame %s failed: %s", shot_id, message)
        mark_shot_failed(shot_id)
        metadata = as_record(shot.get("metadata")) or {}
        supabase.table("shots").update({"metadata": {**metadata, "last_error": message}}).eq("id", shot_id).execute()
        if batch_id and batches.stops_batch(error):
            # Out of credit or a rejected key: every other frame would fail the same way.
            batches.fail_batch(batch_id, message)
            return
    _settle(job_id, scene_id, batch_id)
