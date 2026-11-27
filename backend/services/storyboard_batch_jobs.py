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


def _retried(error: BaseException, attempt: int, max_retries: int, retry_later: RetryLater) -> bool:
    """Schedule the step again when ``error`` is a passing outage (busy provider, lost connection)."""
    if batches.is_retryable(error) and attempt < max_retries:
        retry_later(error, batches.retry_delay_seconds(attempt))
        return True
    return False


def run_plan_step(job_id: str, attempt: int, queue_render: QueueRender, retry_later: RetryLater) -> None:
    """Plan one scene of a batch and queue a render for every frame that still needs an image.

    Losing the connection to the database is retried like a busy provider, so a short internet
    drop delays the scene instead of leaving it stuck.
    """
    try:
        job = batches.load_job(job_id)
        if job is None or job.get("status") in batches.TERMINAL_JOB_STATUSES:
            return
        batches.set_job_planning(job_id)
    except Exception as error:
        if _retried(error, attempt, PLAN_MAX_RETRIES, retry_later):
            return
        raise
    project_id, scene_id = str(job["project_id"]), str(job["scene_id"])
    raw_batch_id = job.get("storyboard_batch_id")
    batch_id = raw_batch_id if isinstance(raw_batch_id, str) else None
    provider, model = _job_provider_and_model(job)
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
        if _retried(error, attempt, PLAN_MAX_RETRIES, retry_later):
            return
        logger.warning("Storyboard planning failed for scene %s: %s", scene_id, error)
        batches.set_job_failed(job_id, batches.describe_failure(error))
        if batch_id:
            batches.batch_status(batch_id)
        return

    if not isinstance(prepared, PreparedSceneStoryboard) or not prepared.pending_shots:
        try:
            _settle(job_id, scene_id, batch_id)
        except Exception as error:
            if _retried(error, attempt, PLAN_MAX_RETRIES, retry_later):
                return
            raise
        return
    for shot in prepared.pending_shots:
        queue_render(job_id, str(shot["id"]))


def _load_render_work(job_id: str, shot_id: str) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """The scene job and shot a render step works on, or None when there is nothing to do."""
    job = batches.load_job(job_id)
    if job is None or job.get("status") == "cancelled":
        return None
    shots = as_records(require_supabase_client().table("shots").select(
        "id, project_id, scene_id, shot_number, prompt, status, sort_order, metadata"
    ).eq("id", shot_id).limit(1).execute().data)
    return (job, shots[0]) if shots else None


def run_render_step(job_id: str, shot_id: str, attempt: int, retry_later: RetryLater) -> None:
    """Render one frame of a batch; busy-provider errors are retried later, others mark the frame failed.

    Losing the connection to the database before or after the frame is retried too, so a short
    internet drop delays the frame instead of leaving it stuck "in progress".
    """
    try:
        work = _load_render_work(job_id, shot_id)
    except Exception as error:
        if _retried(error, attempt, RENDER_MAX_RETRIES, retry_later):
            return
        raise
    if work is None:
        return
    job, shot = work
    project_id, scene_id = str(shot["project_id"]), str(shot["scene_id"])
    raw_batch_id = job.get("storyboard_batch_id")
    batch_id = raw_batch_id if isinstance(raw_batch_id, str) else None

    if shot.get("status") != "complete":
        # A complete shot means a repeated step: don't pay for the frame twice, just settle.
        provider, model = _job_provider_and_model(job)
        try:
            render_storyboard_shot(project_id, scene_id, job_id, shot, provider=provider, model=model)
        except Exception as error:  # noqa: BLE001 - every failure is stored on the shot
            if _retried(error, attempt, RENDER_MAX_RETRIES, retry_later):
                return
            message = batches.describe_failure(error)
            logger.warning("Storyboard frame %s failed: %s", shot_id, message)
            mark_shot_failed(shot_id)
            metadata = as_record(shot.get("metadata")) or {}
            require_supabase_client().table("shots").update(
                {"metadata": {**metadata, "last_error": message}}
            ).eq("id", shot_id).execute()
            if batch_id and batches.stops_batch(error):
                # Out of credit or a rejected key: every other frame would fail the same way.
                batches.fail_batch(batch_id, message)
                return
            _settle(job_id, scene_id, batch_id)
            return

    try:
        _settle(job_id, scene_id, batch_id)
    except Exception as error:
        # The frame is saved; running the step again only settles the scene.
        if _retried(error, attempt, RENDER_MAX_RETRIES, retry_later):
            return
        raise
