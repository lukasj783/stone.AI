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


class GenerateScriptEnvironmentRequest(BaseModel):
    project_id: str = Field(min_length=1)
    environment_id: str = Field(min_length=1)
    model: str
    provider: str = Field(default="replicate")
    aspect_ratio: str = Field(default="16:9")
    resolution: str | None = Field(default="1k")
    output_format: str = Field(default="jpg")
    seed: int | None = None


class GenerateObjectReferenceRequest(BaseModel):
    project_id: str = Field(min_length=1)
    object_id: str = Field(min_length=1)
    model: str
    provider: str = Field(default="replicate")
    aspect_ratio: str = Field(default="1:1")
    resolution: str | None = Field(default="1k")
    output_format: str = Field(default="jpg")
    seed: int | None = None


class CreateImageResponse(BaseModel):
    model: str
    images: list[str]
    keyframes: list[CharacterKeyframe] | None = None
    generation_job_id: str | None = None


class GenerateStoryboardRequest(BaseModel):
    project_id: str = Field(min_length=1)
    scene_id: str = Field(min_length=1)
    force_regenerate: bool = Field(default=False)
    provider: str = Field(default="replicate")
    model: str = Field(default="nanobanana")


class RegenerateShotFrameRequest(BaseModel):
    project_id: str = Field(min_length=1)
    shot_id: str = Field(min_length=1)
    prompt_override: str | None = Field(default=None)
    provider: str = Field(default="replicate")
    model: str = Field(default="nanobanana")


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


class GenerateStoryboardResponse(BaseModel):
    scene_id: str
    generation_job_id: str | None = None
    status: str
    reused: bool = False
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

class AssetDeleteRequest(BaseModel):
    id: int
    url: str

class BatchDeleteRequest(BaseModel):
    items: list[AssetDeleteRequest]
