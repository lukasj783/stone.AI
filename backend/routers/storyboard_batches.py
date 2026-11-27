"""Endpoints for "Generate All Scenes at Once" (see services/storyboard_batch.py).

Work goes to the Celery workers when Redis and the storyboard workers are running, and
otherwise runs on worker threads inside this backend (services/storyboard_local_runner.py).
"""

import asyncio
import logging
import threading
from collections.abc import Sequence
from typing import Any

from fastapi import APIRouter, HTTPException

from schemas.storyboard_batch import (
    StartStoryboardBatchRequest,
    StoryboardBatchPreflight,
    StoryboardBatchProjectRequest,
    StoryboardBatchResponse,
)
from services import storyboard_batch as batches
from services.storyboard_local_runner import local_runner
from services.storyboard_models import storyboard_model

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/story/storyboard-batches", tags=["story"])

INTERRUPTED_MESSAGE = (
    "Stopped because the backend restarted or lost its internet connection before every frame "
    "finished. Retry to continue; finished frames are kept."
)


MIGRATION_MISSING_MESSAGE = (
    "The database isn't set up for generating all scenes yet. Run "
    "supabase/migrations/20261126090000_storyboard_batches.sql in the Supabase SQL editor, then try again."
)


def _migration_missing(error: Exception) -> bool:
    text = str(error)
    return ("storyboard_batches" in text or "storyboard_batch_id" in text) and (
        "does not exist" in text or "Could not find" in text or "PGRST205" in text or "42P01" in text or "42703" in text
    )


def _http_error(error: Exception, action: str) -> HTTPException:
    if _migration_missing(error):
        return HTTPException(status_code=503, detail=MIGRATION_MISSING_MESSAGE)
    if isinstance(error, batches.StoryboardQueueUnavailable):
        return HTTPException(status_code=503, detail=str(error))
    if isinstance(error, batches.StoryboardBatchError):
        status = 409 if "already being generated" in str(error) or "still running" in str(error) else 400
        return HTTPException(status_code=status, detail=str(error))
    return HTTPException(status_code=500, detail=f"{action} failed: {error}")


def _dispatch(runner: str, batch_id: str, plan_job_ids: Sequence[str], renders: Sequence[tuple[str, str]] = ()) -> None:
    if runner == batches.RUNNER_LOCAL:
        local_runner.track(batch_id, [*plan_job_ids, *(job_id for job_id, _ in renders)])
        for job_id in plan_job_ids:
            local_runner.plan(job_id)
        for job_id, shot_id in renders:
            local_runner.render(job_id, shot_id)
        return
    from tasks.storyboard_tasks import plan_storyboard_scene, render_storyboard_frame

    try:
        for job_id in plan_job_ids:
            plan_storyboard_scene.delay(job_id)
        for job_id, shot_id in renders:
            render_storyboard_frame.delay(job_id, shot_id)
    except Exception as error:
        batches.fail_batch(batch_id, "Could not queue the scenes. Check that Redis is running, then try again.")
        raise batches.StoryboardQueueUnavailable(str(error)) from error


_hand_off_lock = threading.Lock()


def _hand_off_to_fallback(batch_id: str, project_id: str) -> None:
    """Finish a Celery batch on this backend's worker threads after Redis or the workers went away.

    Only unfinished work moves: scenes still to plan and frames without an image. Tasks left in
    Redis skip the batch once it is marked local, so no frame is drawn twice.
    """
    with _hand_off_lock:
        if batches.batch_runner(batch_id) != batches.RUNNER_CELERY:
            return  # another request already handed it off
        replan, rerender = batches.unfinished_work(batch_id, project_id)
        batches.set_batch_runner(batch_id, batches.RUNNER_LOCAL)
        logger.warning(
            "Celery is unavailable: storyboard batch %s continues on the fallback (%d scenes to plan, %d frames to draw)",
            batch_id, len(replan), len(rerender),
        )
        _dispatch(batches.RUNNER_LOCAL, batch_id, replan, rerender)


def _status(batch_id: str, project_id: str) -> dict[str, Any]:
    """Batch progress; a fallback batch with no work left in this backend is marked stopped.

    That happens after a restart, or when every remaining step died (for example the internet
    dropped and even saving the failure didn't get through), so the page doesn't load forever.
    """
    status = batches.batch_status(batch_id, project_id)
    if (
        status["runner"] == batches.RUNNER_CELERY
        and status["status"] in batches.ACTIVE_BATCH_STATUSES
        and batches.fallback_enabled()
        and batches.celery_lost(batch_id)
    ):
        _hand_off_to_fallback(batch_id, project_id)
        return batches.batch_status(batch_id, project_id)
    if (
        status["runner"] == batches.RUNNER_LOCAL
        and status["status"] in batches.ACTIVE_BATCH_STATUSES
        and not local_runner.is_live(batch_id)
    ):
        batches.cancel_batch(batch_id, INTERRUPTED_MESSAGE)
        status = batches.batch_status(batch_id, project_id)
    return status


@router.get("/preflight", response_model=StoryboardBatchPreflight)
async def preflight(project_id: str) -> StoryboardBatchPreflight:
    """Scenes that would be generated, scenes skipped as finished, an image estimate and consistency warnings."""
    try:
        plan = await asyncio.to_thread(batches.batch_preflight, project_id)
        return StoryboardBatchPreflight(**{key: value for key, value in plan.items() if key != "scene_ids"})
    except Exception as error:
        raise _http_error(error, "Checking the scenes") from error


def _start(payload: StartStoryboardBatchRequest) -> StoryboardBatchResponse:
    if payload.provider == "wavespeed":
        storyboard_model(payload.model)  # raises ValueError for an unknown model
    existing = batches.active_batch_id(payload.project_id)
    if existing:
        _status(existing, payload.project_id)  # clears a batch left behind by a restart
    runner = batches.runner_for_new_work()
    batch_id, job_ids = batches.create_batch(payload.project_id, payload.model, payload.provider, runner)
    _dispatch(runner, batch_id, job_ids)
    return StoryboardBatchResponse(**_status(batch_id, payload.project_id))


@router.post("", response_model=StoryboardBatchResponse, status_code=202)
async def start_batch(payload: StartStoryboardBatchRequest) -> StoryboardBatchResponse:
    """Generate every scene that doesn't have a finished storyboard yet."""
    try:
        return await asyncio.to_thread(_start, payload)
    except batches.StoryboardBatchError as error:
        raise _http_error(error, "Starting the batch") from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise _http_error(error, "Starting the batch") from error


def _active(project_id: str) -> StoryboardBatchResponse | None:
    batch_id = batches.active_batch_id(project_id)
    return StoryboardBatchResponse(**_status(batch_id, project_id)) if batch_id else None


@router.get("/active", response_model=StoryboardBatchResponse | None)
async def active_batch(project_id: str) -> StoryboardBatchResponse | None:
    """The project's running batch, so a reloaded page picks its progress back up."""
    try:
        return await asyncio.to_thread(_active, project_id)
    except Exception as error:
        raise _http_error(error, "Loading the batch") from error


@router.get("/{batch_id}", response_model=StoryboardBatchResponse)
async def get_batch(batch_id: str, project_id: str) -> StoryboardBatchResponse:
    try:
        return StoryboardBatchResponse(**await asyncio.to_thread(_status, batch_id, project_id))
    except batches.StoryboardBatchError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise _http_error(error, "Loading the batch") from error


def _retry(batch_id: str, project_id: str) -> StoryboardBatchResponse:
    _status(batch_id, project_id)
    replan, rerender = batches.failed_work(batch_id, project_id)
    runner = batches.runner_for_new_work()
    batches.reopen_for_retry(batch_id, replan, rerender)
    batches.set_batch_runner(batch_id, runner)
    _dispatch(runner, batch_id, replan, rerender)
    return StoryboardBatchResponse(**_status(batch_id, project_id))


@router.post("/{batch_id}/retry-failed", response_model=StoryboardBatchResponse, status_code=202)
async def retry_failed(batch_id: str, payload: StoryboardBatchProjectRequest) -> StoryboardBatchResponse:
    """Run again only the scenes and frames that failed or were stopped; finished frames are kept."""
    try:
        return await asyncio.to_thread(_retry, batch_id, payload.project_id)
    except Exception as error:
        raise _http_error(error, "Retrying the batch") from error


def _cancel(batch_id: str, project_id: str) -> StoryboardBatchResponse:
    status = _status(batch_id, project_id)
    if status["status"] in batches.ACTIVE_BATCH_STATUSES:
        batches.cancel_batch(batch_id, "Stopped before every scene finished.")
    return StoryboardBatchResponse(**_status(batch_id, project_id))


@router.post("/{batch_id}/cancel", response_model=StoryboardBatchResponse)
async def cancel(batch_id: str, payload: StoryboardBatchProjectRequest) -> StoryboardBatchResponse:
    """Stop a batch. Frames already being drawn finish and are kept; queued ones are skipped."""
    try:
        return await asyncio.to_thread(_cancel, batch_id, payload.project_id)
    except Exception as error:
        raise _http_error(error, "Stopping the batch") from error
