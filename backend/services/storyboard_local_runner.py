"""Fallback for storyboard batches when Redis or the Celery workers aren't running.

The batch runs on worker threads inside the backend process: STORYBOARD_BATCH_CONCURRENCY
(default 30) frames and STORYBOARD_PLAN_CONCURRENCY (default 10) scene plans at a time, the
same limits the Celery workers use. Progress is saved in the database exactly as with Celery.

What it can't do is survive the backend restarting (including uvicorn --reload after a code
change). A batch this process didn't start is reported as stopped, and starting again carries
on from there: finished frames are kept and skipped. It also assumes one backend process; run
Redis and the workers when the backend runs with several processes.
"""

import logging
import os
import threading
from collections import Counter
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor

from services import storyboard_batch as batches
from services.storyboard_batch_jobs import run_plan_step, run_render_step
from services.storyboard_generation import mark_shot_failed

logger = logging.getLogger(__name__)


def _limit(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


class LocalStoryboardRunner:
    """Runs batch steps on thread pools and knows which batches still have work here.

    A batch is live while one of its steps is queued, running or waiting to be retried. When
    none is left but the database still says the batch is running (a step died, for example
    because the internet dropped and even saving its failure didn't get through), the batch
    endpoint reports it as stopped instead of loading forever.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._plans: ThreadPoolExecutor | None = None
        self._images: ThreadPoolExecutor | None = None
        self._batch_of_job: dict[str, str] = {}
        self._work: Counter[str] = Counter()

    def _pools(self) -> tuple[ThreadPoolExecutor, ThreadPoolExecutor]:
        with self._lock:
            if self._plans is None or self._images is None:
                self._plans = ThreadPoolExecutor(
                    max_workers=_limit("STORYBOARD_PLAN_CONCURRENCY", 10), thread_name_prefix="storyboard-plan",
                )
                self._images = ThreadPoolExecutor(
                    max_workers=_limit("STORYBOARD_BATCH_CONCURRENCY", 30), thread_name_prefix="storyboard-image",
                )
            return self._plans, self._images

    def track(self, batch_id: str, job_ids: Iterable[str]) -> None:
        """Remember that this process runs these scene jobs of the batch."""
        with self._lock:
            for job_id in job_ids:
                self._batch_of_job[job_id] = batch_id

    def is_live(self, batch_id: str) -> bool:
        with self._lock:
            return self._work[batch_id] > 0

    def _begin(self, job_id: str) -> None:
        with self._lock:
            batch_id = self._batch_of_job.get(job_id)
            if batch_id:
                self._work[batch_id] += 1

    def _end(self, job_id: str) -> None:
        with self._lock:
            batch_id = self._batch_of_job.get(job_id)
            if batch_id and self._work[batch_id] > 0:
                self._work[batch_id] -= 1

    def _counted(self, job_id: str, step: Callable[..., None], *args: object) -> None:
        try:
            step(*args)
        finally:
            self._end(job_id)

    def plan(self, job_id: str, attempt: int = 0) -> None:
        self._begin(job_id)
        self._pools()[0].submit(self._counted, job_id, self._run_plan, job_id, attempt)

    def render(self, job_id: str, shot_id: str, attempt: int = 0) -> None:
        self._begin(job_id)
        self._pools()[1].submit(self._counted, job_id, self._run_render, job_id, shot_id, attempt)

    def _later(self, delay: float, action: Callable[..., None], job_id: str, *args: object) -> None:
        """Run ``action(job_id, *args)`` after ``delay`` seconds; the wait counts as live work."""
        self._begin(job_id)
        timer = threading.Timer(delay, self._counted, args=(job_id, action, job_id, *args))
        timer.daemon = True
        timer.start()

    def _run_plan(self, job_id: str, attempt: int) -> None:
        try:
            run_plan_step(
                job_id,
                attempt,
                self.render,
                lambda _error, delay: self._later(delay, self.plan, job_id, attempt + 1),
            )
        except Exception as error:  # noqa: BLE001 - a thread must not die silently
            logger.exception("Storyboard scene planning crashed for job %s", job_id)
            try:
                batches.set_job_failed(job_id, f"Planning stopped unexpectedly: {error}")
            except Exception:  # noqa: BLE001 - the database may be what failed
                logger.exception("Could not mark storyboard job %s failed", job_id)

    def _run_render(self, job_id: str, shot_id: str, attempt: int) -> None:
        try:
            run_render_step(
                job_id,
                shot_id,
                attempt,
                lambda _error, delay: self._later(delay, self.render, job_id, shot_id, attempt + 1),
            )
        except Exception:  # noqa: BLE001 - a thread must not die silently
            logger.exception("Storyboard frame render crashed for shot %s", shot_id)
            try:
                mark_shot_failed(shot_id)
            except Exception:  # noqa: BLE001 - the database may be what failed
                logger.exception("Could not mark storyboard shot %s failed", shot_id)


local_runner = LocalStoryboardRunner()
