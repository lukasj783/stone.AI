from enum import Enum

from pydantic import BaseModel, Field


class ImageModel(str, Enum):
    nanobanana = "nanobanana"
    nanobanana2 = "nanobanana2"
    seedream45 = "seedream45"
    qwen = "qwen"
    z_image = "z-image"
    flux_klein = "flux-klein"


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


class CreateImageResponse(BaseModel):
    model: str
    images: list[str]

class AssetDeleteRequest(BaseModel):
    id: int
    url: str

class BatchDeleteRequest(BaseModel):
    items: list[AssetDeleteRequest]
