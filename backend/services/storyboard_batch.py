"""Generate All Scenes at Once: project-wide storyboard batches run by Celery workers.

A batch has one storyboard job per scene that still needs frames (scenes whose shots all
have images are skipped). Each scene job plans its shots on the ``storyboard-plan`` queue,
then every frame renders as its own task on the ``storyboard-image`` queue, so the number of
image workers sets how many images run at the same time across the whole project.

Character consistency does not depend on the order scenes run in: every frame is drawn from
the characters', environment's and props' saved reference images, chosen and stored on the
shot when it is planned, together with the project's visual style.
"""

import random
import threading
import time
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import Any

import redis

from core.config import get_settings
from core.provider_errors import classify_provider_error, describe_error
from core.supabase_client import require_supabase_client
from core.supabase_records import as_record, as_records
from services.storyboard_generation import _match_characters, scene_job_outcome

ACTIVE_BATCH_STATUSES = ("queued", "running")
TERMINAL_JOB_STATUSES = {"complete", "failed", "cancelled"}
# Worth trying again after a pause: the provider is busy, down or slow.
RETRYABLE_FAILURE_CODES = {"provider_rate_limited", "provider_unavailable", "provider_timeout"}
# No later frame can succeed until someone fixes the account, so the batch stops.
BATCH_STOPPING_FAILURE_CODES = {"provider_out_of_credit", "provider_auth_failed"}
# Used to estimate images for scenes that have no shots yet, when no scene has been storyboarded.
DEFAULT_SHOTS_PER_SCENE = 4
PAGE = 1000


class StoryboardBatchError(ValueError):
    """A batch request that cannot be done as asked (shown to people as a 400/409)."""


class StoryboardQueueUnavailable(RuntimeError):
    """The Celery broker (Redis) cannot be reached, so nothing can be queued."""


# --- Pure rules (unit tested) ------------------------------------------------------------


def scenes_needing_storyboard(
    scene_ids: Sequence[str],
    shot_ids_by_scene: dict[str, list[str]],
    imaged_shot_ids: set[str],
) -> tuple[list[str], list[str]]:
    """Split scenes into (to generate, skipped). A scene is skipped when it has shots and every one has an image."""
    include: list[str] = []
    skipped: list[str] = []
    for scene_id in scene_ids:
        shot_ids = shot_ids_by_scene.get(scene_id, [])
        if shot_ids and all(shot_id in imaged_shot_ids for shot_id in shot_ids):
            skipped.append(scene_id)
        else:
            include.append(scene_id)
    return include, skipped


def estimate_images(
    included_scene_ids: Sequence[str],
    shot_ids_by_scene: dict[str, list[str]],
    imaged_shot_ids: set[str],
) -> int:
    """About how many frames a batch will render: missing frames of planned scenes, plus an
    average-sized shot list for scenes not planned yet."""
    planned_sizes = [len(ids) for ids in shot_ids_by_scene.values() if ids]
    per_new_scene = round(sum(planned_sizes) / len(planned_sizes)) if planned_sizes else DEFAULT_SHOTS_PER_SCENE
    total = 0
    for scene_id in included_scene_ids:
        shot_ids = shot_ids_by_scene.get(scene_id, [])
        missing = [shot_id for shot_id in shot_ids if shot_id not in imaged_shot_ids]
        total += len(missing) if missing else max(1, per_new_scene)
    return total


def scene_state(job_status: str, phase: str | None) -> str:
    """What a scene in a batch is doing: queued, planning, rendering, complete, failed or cancelled."""
    if job_status == "running":
        return "rendering" if phase == "rendering" else "planning"
    return job_status if job_status in TERMINAL_JOB_STATUSES else "queued"


def batch_outcome(scene_states: Sequence[str]) -> str:
    """Batch status from its scenes: running until every scene ends, then complete (failed if none succeeded)."""
    if not scene_states:
        return "complete"
    if any(state not in TERMINAL_JOB_STATUSES for state in scene_states):
        return "queued" if all(state == "queued" for state in scene_states) else "running"
    if all(state in {"failed", "cancelled"} for state in scene_states):
        return "failed"
    return "complete"


def retry_delay_seconds(attempt: int, *, base: float = 8.0, cap: float = 120.0) -> float:
    """Exponential back-off with jitter for retrying a busy provider, so retries spread out."""
    delay = min(cap, base * (2 ** max(0, attempt)))
    return delay * random.uniform(0.75, 1.25)


def failure_code(error: BaseException) -> str | None:
    failure = classify_provider_error(error)
    return failure.code if failure else None


def is_retryable(error: BaseException) -> bool:
    return failure_code(error) in RETRYABLE_FAILURE_CODES


def stops_batch(error: BaseException) -> bool:
    return failure_code(error) in BATCH_STOPPING_FAILURE_CODES


# --- Database helpers ----------------------------------------------------------------------


def _fetch_all(query: Callable[[int, int], Any]) -> list[dict[str, Any]]:
    """Every row of a query, 1000 at a time (PostgREST caps a single response)."""
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        page = as_records(query(start, start + PAGE - 1).execute().data)
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        start += PAGE


def _leaf_scenes(project_id: str) -> list[dict[str, Any]]:
    supabase = require_supabase_client()
    return _fetch_all(lambda start, end: supabase.table("scenes").select("id, slugline_raw, title").eq(
        "project_id", project_id
    ).eq("is_leaf", True).order("sort_order").range(start, end))


def _project_shots(project_id: str) -> list[dict[str, Any]]:
    supabase = require_supabase_client()
    return _fetch_all(lambda start, end: supabase.table("shots").select("id, scene_id, status").eq(
        "project_id", project_id
    ).order("sort_order").range(start, end))


def _imaged_shot_ids(project_id: str) -> set[str]:
    supabase = require_supabase_client()
    links = _fetch_all(lambda start, end: supabase.table("asset_links").select("target_id").eq(
        "project_id", project_id
    ).eq("target_type", "shot").eq("role", "storyboard").range(start, end))
    return {str(link["target_id"]) for link in links}


def _shot_ids_by_scene(shots: Sequence[dict[str, Any]]) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for shot in shots:
        grouped.setdefault(str(shot["scene_id"]), []).append(str(shot["id"]))
    return grouped


def characters_without_references(project_id: str, scene_ids: Sequence[str]) -> list[str]:
    """On-camera characters that appear in these scenes but have no reference image yet.

    Their frames would be drawn from text alone, which is where a character's look drifts
    between scenes, so people are warned before a batch starts.
    """
    if not scene_ids:
        return []
    supabase = require_supabase_client()
    characters = as_records(supabase.table("characters").select(
        "id, name, tags, primary_asset_id, on_camera"
    ).eq("project_id", project_id).execute().data)
    missing = [
        character for character in characters
        if not character.get("primary_asset_id") and character.get("on_camera") is not False and character.get("name")
    ]
    if not missing:
        return []
    wanted = set(scene_ids)
    blocks = _fetch_all(lambda start, end: supabase.table("script_blocks").select(
        "scene_id, character_id, character_name, content"
    ).eq("project_id", project_id).range(start, end))
    ids_in_scenes = {str(block["character_id"]) for block in blocks if block.get("character_id") and block.get("scene_id") in wanted}
    text = "\n".join(
        f"{block.get('character_name') or ''} {block.get('content') or ''}"
        for block in blocks if block.get("scene_id") in wanted
    )
    named = {str(character["id"]) for character in _match_characters(text, missing)}
    return sorted(
        {str(character["name"]) for character in missing if str(character["id"]) in ids_in_scenes | named},
        key=str.casefold,
    )


RUNNER_CELERY = "celery"
RUNNER_LOCAL = "local"
CELERY_STORYBOARD_QUEUES = {"storyboard-plan", "storyboard-image"}
RUNNER_CHECK_SECONDS = 30.0
_runner_cache: tuple[float, str] | None = None


def _redis_reachable() -> bool:
    try:
        redis.Redis.from_url(get_settings().redis_url, socket_connect_timeout=1, socket_timeout=2).ping()
        return True
    except redis.RedisError:
        return False


def _celery_storyboard_workers_running() -> bool:
    """True when workers are listening on both storyboard queues (else queued work would just wait)."""
    from core.celery_app import celery_app

    try:
        replies = celery_app.control.inspect(timeout=1.0).active_queues() or {}
    except Exception:  # noqa: BLE001 - any broker problem means Celery can't be used now
        return False
    listening = {queue.get("name") for queues in replies.values() for queue in queues or []}
    return CELERY_STORYBOARD_QUEUES <= listening


def choose_runner() -> str:
    """Celery when Redis and the storyboard workers are running, otherwise the in-backend fallback.

    The answer is remembered for a short while so repeated clicks don't wait on the checks.
    """
    global _runner_cache
    now = time.monotonic()
    if _runner_cache and now - _runner_cache[0] < RUNNER_CHECK_SECONDS:
        return _runner_cache[1]
    runner = RUNNER_CELERY if _redis_reachable() and _celery_storyboard_workers_running() else RUNNER_LOCAL
    _runner_cache = (now, runner)
    return runner


CELERY_REQUIRED_MESSAGE = (
    "Redis or the storyboard workers aren't running, and STORYBOARD_FALLBACK is off, so scenes can "
    "only be generated through Celery. Start Redis and the storyboard workers, then try again."
)


def fallback_enabled() -> bool:
    """Whether a batch may run inside the backend when Celery can't be used (STORYBOARD_FALLBACK)."""
    return get_settings().storyboard_fallback


def runner_for_new_work() -> str:
    """The runner for a new batch or a retry: Celery when it runs, else the fallback if allowed."""
    runner = choose_runner()
    if runner == RUNNER_LOCAL and not fallback_enabled():
        raise StoryboardQueueUnavailable(CELERY_REQUIRED_MESSAGE)
    return runner


CELERY_LOSS_GRACE_SECONDS = 60.0


class CeleryLossWatch:
    """Celery counts as gone for a batch only once it has stayed unavailable for the grace period.

    A worker that is briefly slow to answer must not hand its batch to the fallback, or frames
    would be drawn (and paid for) twice.
    """

    def __init__(self, grace_seconds: float = CELERY_LOSS_GRACE_SECONDS) -> None:
        self._grace = grace_seconds
        self._missing_since: dict[str, float] = {}
        self._lock = threading.Lock()

    def lost(self, batch_id: str, *, available: bool, now: float) -> bool:
        with self._lock:
            if available:
                self._missing_since.pop(batch_id, None)
                return False
            since = self._missing_since.setdefault(batch_id, now)
            return now - since >= self._grace


_celery_loss = CeleryLossWatch()


def celery_lost(batch_id: str) -> bool:
    """True once Redis or the storyboard workers have been unavailable for the grace period."""
    return _celery_loss.lost(batch_id, available=choose_runner() == RUNNER_CELERY, now=time.monotonic())


def split_unfinished_work(
    scenes: Sequence[dict[str, Any]], unfinished_shots: dict[str, list[str]],
) -> tuple[list[str], list[tuple[str, str]]]:
    """(scene jobs to plan, (job, shot) frames to render) for a running batch moving to another runner."""
    replan: list[str] = []
    rerender: list[tuple[str, str]] = []
    for scene in scenes:
        if scene["status"] in {"queued", "planning"}:
            replan.append(scene["generation_job_id"])
        elif scene["status"] == "rendering":
            rerender.extend((scene["generation_job_id"], shot_id) for shot_id in unfinished_shots.get(scene["scene_id"], []))
    return replan, rerender


def unfinished_work(batch_id: str, project_id: str) -> tuple[list[str], list[tuple[str, str]]]:
    """What is still left in a running batch: scenes to plan and frames without an image."""
    status = batch_status(batch_id, project_id)
    rendering = [scene["scene_id"] for scene in status["scenes"] if scene["status"] == "rendering"]
    unfinished_shots: dict[str, list[str]] = {}
    if rendering:
        rows = as_records(require_supabase_client().table("shots").select("id, scene_id").in_(
            "scene_id", rendering
        ).in_("status", ["pending", "in_progress"]).execute().data)
        for row in rows:
            unfinished_shots.setdefault(str(row["scene_id"]), []).append(str(row["id"]))
    return split_unfinished_work(status["scenes"], unfinished_shots)


def batch_runner(batch_id: str) -> str:
    rows = as_records(require_supabase_client().table("storyboard_batches").select("settings").eq(
        "id", batch_id
    ).limit(1).execute().data)
    settings = (as_record(rows[0].get("settings")) if rows else None) or {}
    return str(settings.get("runner") or RUNNER_CELERY)


def runs_on_celery(job_id: str) -> bool:
    """False when the job's batch was handed to the fallback, so leftover Celery tasks skip it."""
    job = load_job(job_id)
    batch_id = job.get("storyboard_batch_id") if job else None
    return not isinstance(batch_id, str) or batch_runner(batch_id) == RUNNER_CELERY


def set_batch_runner(batch_id: str, runner: str) -> None:
    supabase = require_supabase_client()
    rows = as_records(supabase.table("storyboard_batches").select("settings").eq("id", batch_id).limit(1).execute().data)
    settings = (as_record(rows[0].get("settings")) if rows else None) or {}
    supabase.table("storyboard_batches").update({"settings": {**settings, "runner": runner}}).eq("id", batch_id).execute()


# --- Batch operations ----------------------------------------------------------------------


def batch_preflight(project_id: str) -> dict[str, Any]:
    """What 'Generate All Scenes at Once' would do now, shown before anything is spent."""
    scenes = _leaf_scenes(project_id)
    shots = _project_shots(project_id)
    by_scene = _shot_ids_by_scene(shots)
    imaged = _imaged_shot_ids(project_id)
    include, skipped = scenes_needing_storyboard([str(scene["id"]) for scene in scenes], by_scene, imaged)
    return {
        "project_id": project_id,
        "total_scenes": len(scenes),
        "scene_ids": include,
        "scenes_to_generate": len(include),
        "scenes_skipped": len(skipped),
        "estimated_images": estimate_images(include, by_scene, imaged),
        "characters_without_references": characters_without_references(project_id, include),
    }


def active_batch_id(project_id: str) -> str | None:
    rows = as_records(require_supabase_client().table("storyboard_batches").select("id").eq(
        "project_id", project_id
    ).in_("status", list(ACTIVE_BATCH_STATUSES)).order("created_at", desc=True).limit(1).execute().data)
    return str(rows[0]["id"]) if rows else None


def create_batch(project_id: str, model: str, provider: str, runner: str = RUNNER_CELERY) -> tuple[str, list[str]]:
    """Create the batch and one queued job per scene that needs frames. Returns (batch id, job ids)."""
    if active_batch_id(project_id):
        raise StoryboardBatchError("Scenes are already being generated for this project. Wait for that run to finish or stop it first.")
    plan = batch_preflight(project_id)
    if not plan["scene_ids"]:
        raise StoryboardBatchError("Every scene already has a finished storyboard.")
    supabase = require_supabase_client()
    batch_rows = as_records(supabase.table("storyboard_batches").insert({
        "project_id": project_id,
        "model": model,
        "settings": {
            "provider": provider,
            "runner": runner,
            "skipped_scenes": plan["scenes_skipped"],
            "estimated_images": plan["estimated_images"],
        },
        "status": "queued",
        "total_scenes": len(plan["scene_ids"]),
    }).execute().data)
    if not batch_rows:
        raise RuntimeError("Failed to create the storyboard batch")
    batch_id = str(batch_rows[0]["id"])
    jobs = as_records(supabase.table("generation_jobs").insert([
        {
            "project_id": project_id,
            "scene_id": scene_id,
            "storyboard_batch_id": batch_id,
            "kind": "storyboard",
            "model": model,
            "settings": {"provider": provider, "phase": "queued"},
            "status": "queued",
        }
        for scene_id in plan["scene_ids"]
    ]).execute().data)
    if len(jobs) != len(plan["scene_ids"]):
        fail_batch(batch_id, "Failed to create the scene jobs for this batch")
        raise RuntimeError("Failed to create the scene jobs for this batch")
    return batch_id, [str(job["id"]) for job in jobs]


def load_job(job_id: str) -> dict[str, Any] | None:
    rows = as_records(require_supabase_client().table("generation_jobs").select(
        "id, project_id, scene_id, storyboard_batch_id, model, settings, status"
    ).eq("id", job_id).limit(1).execute().data)
    return rows[0] if rows else None


def set_job_failed(job_id: str, message: str) -> None:
    require_supabase_client().table("generation_jobs").update({
        "status": "failed", "error_message": message,
    }).eq("id", job_id).neq("status", "cancelled").execute()


def set_job_planning(job_id: str) -> None:
    job = load_job(job_id)
    settings = as_record(job.get("settings")) if job else None
    require_supabase_client().table("generation_jobs").update({
        "status": "running", "error_message": None, "settings": {**(settings or {}), "phase": "planning"},
    }).eq("id", job_id).execute()


def fail_batch(batch_id: str, message: str) -> None:
    """Stop a batch: its unfinished scenes are cancelled and their unfinished shots marked failed."""
    cancel_batch(batch_id, message, status="failed")


def cancel_batch(batch_id: str, message: str | None = None, *, status: str = "cancelled") -> None:
    supabase = require_supabase_client()
    jobs = as_records(supabase.table("generation_jobs").select("id, scene_id, status").eq(
        "storyboard_batch_id", batch_id
    ).execute().data)
    open_jobs = [job for job in jobs if job.get("status") not in TERMINAL_JOB_STATUSES]
    if open_jobs:
        supabase.table("generation_jobs").update({"status": "cancelled", "error_message": message}).in_(
            "id", [job["id"] for job in open_jobs]
        ).execute()
        scene_ids = [job["scene_id"] for job in open_jobs if job.get("scene_id")]
        if scene_ids:
            supabase.table("shots").update({"status": "failed"}).in_("scene_id", scene_ids).in_(
                "status", ["pending", "in_progress"]
            ).execute()
    supabase.table("storyboard_batches").update({
        "status": status, "error_message": message, "completed_at": datetime.now(UTC).isoformat(),
    }).eq("id", batch_id).execute()


def batch_status(batch_id: str, project_id: str | None = None) -> dict[str, Any]:
    """Progress of a batch, worked out from its scene jobs and their shots.

    Scenes whose frames have all finished are marked done here too, so the stored statuses
    settle even if two frames of one scene finished at the same moment.
    """
    supabase = require_supabase_client()
    query = supabase.table("storyboard_batches").select("*").eq("id", batch_id)
    if project_id:
        query = query.eq("project_id", project_id)
    batches = as_records(query.limit(1).execute().data)
    if not batches:
        raise StoryboardBatchError("Storyboard batch was not found in this project")
    batch = batches[0]
    jobs = as_records(supabase.table("generation_jobs").select(
        "id, scene_id, status, settings, error_message"
    ).eq("storyboard_batch_id", batch_id).order("created_at").execute().data)
    shots_by_scene: dict[str, list[str]] = {}
    for shot in _project_shots(str(batch["project_id"])):
        shots_by_scene.setdefault(str(shot["scene_id"]), []).append(str(shot.get("status") or ""))

    scenes: list[dict[str, Any]] = []
    for job in jobs:
        scene_id = str(job.get("scene_id") or "")
        statuses = shots_by_scene.get(scene_id, [])
        job_status = str(job.get("status") or "queued")
        phase = (as_record(job.get("settings")) or {}).get("phase")
        error_message = job.get("error_message")
        if job_status == "running" and phase == "rendering":
            settled, settled_error = scene_job_outcome(statuses)
            if settled != "running":
                update: dict[str, Any] = {"status": settled, "error_message": settled_error}
                if settled == "complete":
                    update["completed_at"] = datetime.now(UTC).isoformat()
                supabase.table("generation_jobs").update(update).eq("id", job["id"]).eq("status", "running").execute()
                job_status, error_message = settled, settled_error
        scenes.append({
            "scene_id": scene_id,
            "generation_job_id": str(job["id"]),
            "status": scene_state(job_status, phase if isinstance(phase, str) else None),
            "total_shots": len(statuses),
            "completed_shots": statuses.count("complete"),
            "failed_shots": statuses.count("failed"),
            "error_message": error_message,
        })

    stored_status = str(batch.get("status") or "queued")
    status = stored_status
    if stored_status in ACTIVE_BATCH_STATUSES:
        status = batch_outcome([scene["status"] for scene in scenes])
        if status != stored_status:
            supabase.table("storyboard_batches").update({
                "status": status,
                "completed_at": datetime.now(UTC).isoformat() if status not in ACTIVE_BATCH_STATUSES else None,
            }).eq("id", batch_id).in_("status", list(ACTIVE_BATCH_STATUSES)).execute()

    return {
        "batch_id": batch_id,
        "project_id": str(batch["project_id"]),
        "status": status,
        "model": batch.get("model"),
        "error_message": batch.get("error_message"),
        "total_scenes": len(scenes),
        "completed_scenes": sum(1 for scene in scenes if scene["status"] == "complete"),
        "failed_scenes": sum(1 for scene in scenes if scene["status"] in {"failed", "cancelled"}),
        "total_shots": sum(scene["total_shots"] for scene in scenes),
        "completed_shots": sum(scene["completed_shots"] for scene in scenes),
        "failed_shots": sum(scene["failed_shots"] for scene in scenes),
        "estimated_images": int((as_record(batch.get("settings")) or {}).get("estimated_images") or 0),
        "runner": str((as_record(batch.get("settings")) or {}).get("runner") or RUNNER_CELERY),
        "created_at": batch.get("created_at"),
        "completed_at": batch.get("completed_at"),
        "scenes": scenes,
    }


def failed_work(batch_id: str, project_id: str) -> tuple[list[str], list[tuple[str, str]]]:
    """What a retry re-queues: (scene jobs to plan again, (job, shot) frames to render again)."""
    status = batch_status(batch_id, project_id)
    if status["status"] in ACTIVE_BATCH_STATUSES:
        raise StoryboardBatchError("This batch is still running. Retry once it has finished.")
    supabase = require_supabase_client()
    replan: list[str] = []
    rerender: list[tuple[str, str]] = []
    for scene in status["scenes"]:
        if scene["status"] not in {"failed", "cancelled"}:
            continue
        if scene["total_shots"] == 0:
            replan.append(scene["generation_job_id"])
            continue
        failed_shots = as_records(supabase.table("shots").select("id").eq("scene_id", scene["scene_id"]).eq(
            "status", "failed"
        ).execute().data)
        if failed_shots:
            rerender.extend((scene["generation_job_id"], str(shot["id"])) for shot in failed_shots)
        else:
            replan.append(scene["generation_job_id"])
    if not replan and not rerender:
        raise StoryboardBatchError("This batch has nothing that failed to retry.")
    return replan, rerender


def reopen_for_retry(batch_id: str, replan_job_ids: Sequence[str], rerender: Sequence[tuple[str, str]]) -> None:
    supabase = require_supabase_client()
    if replan_job_ids:
        supabase.table("generation_jobs").update({
            "status": "queued", "error_message": None, "completed_at": None,
        }).in_("id", list(replan_job_ids)).execute()
    rerender_jobs = sorted({job_id for job_id, _ in rerender})
    if rerender_jobs:
        supabase.table("generation_jobs").update({
            "status": "running", "error_message": None, "completed_at": None,
        }).in_("id", rerender_jobs).execute()
        supabase.table("shots").update({"status": "in_progress"}).in_("id", [shot_id for _, shot_id in rerender]).execute()
    supabase.table("storyboard_batches").update({
        "status": "running", "error_message": None, "completed_at": None,
    }).eq("id", batch_id).execute()


def describe_failure(error: BaseException) -> str:
    return describe_error(error)
