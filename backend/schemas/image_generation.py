from enum import Enum

from pydantic import BaseModel, Field


class ImageModel(str, Enum):
    nanobanana = "nanobanana"
    nanobanana2 = "nanobanana2"
    seedream45 = "seedream45"
    qwen = "qwen"
    z_image = "z-image"
    flux_klein = "flux-klein"


class CharacterView(str, Enum):
    front = "front"
    left_three_quarter = "left_three_quarter"
    left_profile = "left_profile"
    back = "back"
    right_profile = "right_profile"
    right_three_quarter = "right_three_quarter"


class CreateImageRequest(BaseModel):
    model: str
    provider: str = Field(default="replicate")
    prompt: str = Field(min_length=1)
    aspect_ratio: str = Field(default="4:3")
    num_images: int = Field(default=1, ge=1, le=8)
    resolution: str | None = Field(default="1k")
    image_search: bool = Field(default=True)
    google_search: bool = Field(default=True)
    output_format: str = Field(default="jpg")
    image_input: list[str] | None = Field(default=None)  # URLs of input images
    image_mapping: dict[str, str] | None = Field(default=None)  # Tag names (e.g., "[image1]") to image URLs
    project_id: str | None = Field(default=None)
    seed: int | None = Field(default=None)
    visual_style: str | None = Field(default=None, max_length=40)


class CharacterKeyframe(BaseModel):
    view: CharacterView
    image_url: str
    prompt: str
    seed: int | None = None
    model: str
    status: str = "complete"
    asset_id: str | None = None


class RegenerateCharacterKeyframeRequest(BaseModel):
    project_id: str = Field(min_length=1)
    correction: str = Field(default="", max_length=2_000)


class GenerateScriptCharacterRequest(BaseModel):
    project_id: str = Field(min_length=1)
    character_id: str = Field(min_length=1)
    model: str
    provider: str = Field(default="replicate")
    aspect_ratio: str = Field(default="2:3")
    resolution: str | None = Field(default="1k")
    output_format: str = Field(default="jpg")
    seed: int | None = None
    visual_style: str | None = Field(default=None, max_length=40)


class GenerateScriptEnvironmentRequest(BaseModel):
    project_id: str = Field(min_length=1)
    environment_id: str = Field(min_length=1)
    model: str
    provider: str = Field(default="replicate")
    aspect_ratio: str = Field(default="16:9")
    resolution: str | None = Field(default="1k")
    output_format: str = Field(default="jpg")
    seed: int | None = None
    visual_style: str | None = Field(default=None, max_length=40)


class GenerateObjectReferenceRequest(BaseModel):
    project_id: str = Field(min_length=1)
    object_id: str = Field(min_length=1)
    model: str
    provider: str = Field(default="replicate")
    aspect_ratio: str = Field(default="1:1")
    resolution: str | None = Field(default="1k")
    output_format: str = Field(default="jpg")
    seed: int | None = None
    visual_style: str | None = Field(default=None, max_length=40)


class CreateImageResponse(BaseModel):
    model: str
    images: list[str]
    keyframes: list[CharacterKeyframe] | None = None
    generation_job_id: str | None = None


class GenerateStoryboardRequest(BaseModel):
    project_id: str = Field(min_length=1)
    scene_id: str = Field(min_length=1)
    force_regenerate: bool = Field(default=False)
    provider: str = Field(default="wavespeed")
    model: str = Field(default="google/nano-banana-2/edit")


class RegenerateShotFrameRequest(BaseModel):
    project_id: str = Field(min_length=1)
    shot_id: str = Field(min_length=1)
    prompt_override: str | None = Field(default=None)
    provider: str = Field(default="wavespeed")
    model: str = Field(default="google/nano-banana-2/edit")


class StoryboardModelOption(BaseModel):
    """A WaveSpeed edit model the user can pick for storyboard frames."""
    id: str
    label: str
    family: str
    max_images: int
    verified: bool
    page_url: str
    notes: str
    is_default: bool


class StoryboardCharacter(BaseModel):
    """A character detected in a frame, with the tags and font color used to label it."""

    id: str | None = None
    name: str
    tags: list[str] = Field(default_factory=list)
    color: str | None = None


class StoryboardFrame(BaseModel):
    shot_id: str
    shot_number: int
    description: str
    camera_angle: str | None = None
    camera_motion: str | None = None
    prompt: str
    image_url: str | None = None
    status: str
    error: str | None = None
    characters: list[StoryboardCharacter] = Field(default_factory=list)


class GenerateStoryboardResponse(BaseModel):
    scene_id: str
    generation_job_id: str | None = None
    status: str
    reused: bool = False
    # "llm" when a language model planned the shot list, "deterministic" for one shot per line.
    shot_planner: str | None = None
    frames: list[StoryboardFrame]


class FinalizeCharacterRequest(BaseModel):
    project_id: str = Field(min_length=1)
    generation_job_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    role: str | None = None
    description: str | None = None
    primary_view: CharacterView = CharacterView.front


class FinalizeCharacterResponse(BaseModel):
    character_id: str
    primary_asset_id: str


class CreateCharacterSheetRequest(BaseModel):
    project_id: str = Field(min_length=1)
    character_id: str = Field(min_length=1)
    model: str = Field(default="nanobanana")
    provider: str = Field(default="replicate")
    regenerate_face: bool = False


class CharacterSheetResponse(BaseModel):
    character_id: str
    sheet_asset_id: str
    sheet_url: str
    face_closeup_asset_id: str | None = None
    face_closeup_url: str
    width: int
    height: int
    palette: list[str] = Field(default_factory=list)
    missing_views: list[str] = Field(default_factory=list)


class SetCharacterStyleRequest(BaseModel):
    project_id: str = Field(min_length=1)
    character_id: str = Field(min_length=1)
    visual_style: str = Field(min_length=1, max_length=40)
    model: str = Field(default="nanobanana")
    provider: str = Field(default="replicate")


class CharacterStylePropagation(BaseModel):
    status: str
    visual_style: str
    affected_character_views: bool = False
    affected_environment_ids: list[str] = Field(default_factory=list)
    affected_object_ids: list[str] = Field(default_factory=list)
    completed: int = 0
    total: int = 0
    errors: list[str] = Field(default_factory=list)
    started_at: str | None = None
    finished_at: str | None = None


class SetCharacterStyleResponse(BaseModel):
    character_id: str
    visual_style: str
    changed: bool
    propagation_started: bool
    propagation: CharacterStylePropagation


class AssetDeleteRequest(BaseModel):
    id: int
    url: str

class BatchDeleteRequest(BaseModel):
    items: list[AssetDeleteRequest]
