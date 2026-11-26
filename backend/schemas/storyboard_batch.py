from pydantic import BaseModel, Field

from services.storyboard_models import DEFAULT_STORYBOARD_MODEL


class StoryboardBatchPreflight(BaseModel):
    """What 'Generate All Scenes at Once' would do, shown before it starts."""

    project_id: str
    total_scenes: int
    scenes_to_generate: int
    scenes_skipped: int
    estimated_images: int
    characters_without_references: list[str] = Field(default_factory=list)


class StartStoryboardBatchRequest(BaseModel):
    project_id: str = Field(min_length=1)
    provider: str = Field(default="wavespeed")
    model: str = Field(default=DEFAULT_STORYBOARD_MODEL)


class StoryboardBatchProjectRequest(BaseModel):
    project_id: str = Field(min_length=1)


class StoryboardBatchScene(BaseModel):
    scene_id: str
    generation_job_id: str
    # queued | planning | rendering | complete | failed | cancelled
    status: str
    total_shots: int
    completed_shots: int
    failed_shots: int
    error_message: str | None = None


class StoryboardBatchResponse(BaseModel):
    batch_id: str
    project_id: str
    status: str
    model: str | None = None
    error_message: str | None = None
    total_scenes: int
    completed_scenes: int
    failed_scenes: int
    total_shots: int
    completed_shots: int
    failed_shots: int
    # Estimated at start; total_shots only counts scenes whose shot lists are planned so far.
    estimated_images: int = 0
    # "celery" (Redis workers) or "local" (worker threads inside the backend, the fallback).
    runner: str = "celery"
    created_at: str | None = None
    completed_at: str | None = None
    scenes: list[StoryboardBatchScene] = Field(default_factory=list)
