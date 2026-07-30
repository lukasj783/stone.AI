from celery import Celery

from core.config import get_settings


settings = get_settings()
celery_app = Celery("qwen_imae", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_default_queue="shot-video",
    include=["tasks.shot_video_tasks"],
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    task_track_started=True,
    broker_connection_retry_on_startup=True,
    task_routes={"tasks.shot_video_tasks.*": {"queue": "shot-video"}},
)