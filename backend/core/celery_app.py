from celery import Celery

from core.config import get_settings


settings = get_settings()
celery_app = Celery("qwen_imae", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_default_queue="shot-video",
    include=["tasks.shot_video_tasks", "tasks.storyboard_tasks"],
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    task_track_started=True,
    # Frames take a minute or more each: a worker thread takes one task at a time, so queued
    # frames go to whichever thread frees up first instead of waiting behind a busy one.
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    task_routes={
        "tasks.shot_video_tasks.*": {"queue": "shot-video"},
        "tasks.storyboard_tasks.plan_storyboard_scene": {"queue": "storyboard-plan"},
        "tasks.storyboard_tasks.render_storyboard_frame": {"queue": "storyboard-image"},
    },
)