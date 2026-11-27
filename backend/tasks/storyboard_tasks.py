"""Celery tasks for "Generate All Scenes at Once" (the steps live in services/storyboard_batch_jobs.py).

plan_storyboard_scene runs on the storyboard-plan queue and saves a scene's shot list;
render_storyboard_frame runs on the storyboard-image queue, one task per frame, so the
image worker's concurrency is how many frames are generated at the same time.
"""

from typing import Any, NoReturn

from core.celery_app import celery_app
from services.storyboard_batch import runs_on_celery
from services.storyboard_batch_jobs import (
    PLAN_MAX_RETRIES,
    RENDER_MAX_RETRIES,
    run_plan_step,
    run_render_step,
)


def _celery_retry(task: Any):
    def retry_later(error: BaseException, delay: float) -> NoReturn:
        raise task.retry(exc=error, countdown=delay)
    return retry_later


@celery_app.task(name="tasks.storyboard_tasks.plan_storyboard_scene", bind=True, max_retries=PLAN_MAX_RETRIES)
def plan_storyboard_scene(self: Any, job_id: str) -> None:
    if not runs_on_celery(job_id):
        return  # the batch moved to the in-backend fallback while this task waited in Redis
    run_plan_step(
        job_id,
        self.request.retries,
        lambda plan_job_id, shot_id: render_storyboard_frame.delay(plan_job_id, shot_id),
        _celery_retry(self),
    )


@celery_app.task(name="tasks.storyboard_tasks.render_storyboard_frame", bind=True, max_retries=RENDER_MAX_RETRIES)
def render_storyboard_frame(self: Any, job_id: str, shot_id: str) -> None:
    if not runs_on_celery(job_id):
        return  # the batch moved to the in-backend fallback while this task waited in Redis
    run_render_step(job_id, shot_id, self.request.retries, _celery_retry(self))
