from enum import Enum
from pydantic import BaseModel, Field


class VideoModel(str, Enum):
    kling_v2_6_std = "kwaivgi/kling-v2.6-std/text-to-video"
    kling_v3_0_pro = "kwaivgi/kling-v3.0-pro/text-to-video"
    veo3 = "google/veo3"
    veo3_1_fast = "google/veo3.1-fast/text-to-video"
    veo3_1_lite = "google/veo3.1-lite/text-to-video"
    wan_2_7 = "alibaba/wan-2.7/text-to-video"


class ImageToVideoModel(str, Enum):
    kling_v3_0_std = "kwaivgi/kling-v3.0-std/image-to-video"
    veo3_1 = "google/veo3.1/image-to-video"
    seedance_2_0 = "bytedance/seedance-2.0/image-to-video"
    wan_2_7 = "alibaba/wan-2.7/image-to-video"


class MotionTransferModel(str, Enum):
    kling_v3_0_std = "kwaivgi/kling-v3.0-std/motion-control"
    wan_2_2_animate = "wavespeed-ai/wan-2.2/animate"
    steady_dancer = "wavespeed-ai/steady-dancer"


class CreateVideoRequest(BaseModel):
    model: VideoModel
    prompt: str = Field(min_length=1)
    aspect_ratio: str = Field(default="16:9")
    duration: int = Field(default=5, ge=1, le=10)
    cfg_scale: float | None = Field(default=0.5)
    resolution: str | None = Field(default="720p")
    generate_audio: bool | None = Field(default=False)
    # Fields that might be needed for other specific models like Kling v3.0 customization
    shot_type: str | None = Field(default=None)
    enable_prompt_expansion: bool | None = Field(default=None)
    seed: int | None = Field(default=None)
    element_list: list | None = Field(default=None)
    multi_prompt: list | None = Field(default=None)


class CreateImageToVideoRequest(BaseModel):
    model: ImageToVideoModel
    prompt: str = Field(min_length=1)
    image_url: str = Field(min_length=1)
    aspect_ratio: str = Field(default="16:9")
    duration: int = Field(default=5, ge=1, le=15)
    cfg_scale: float | None = Field(default=None)
    resolution: str | None = Field(default="720p")
    generate_audio: bool | None = Field(default=False)
    shot_type: str | None = Field(default=None)
    enable_prompt_expansion: bool | None = Field(default=None)
    seed: int | None = Field(default=None)
    last_image: str | None = Field(default=None)
    element_list: list[dict[str, str]] | None = Field(default=None)
    multi_prompt: list[str] | None = Field(default=None)


class CreateVideoResponse(BaseModel):
    model: VideoModel
    video_url: str


class CreateImageToVideoResponse(BaseModel):
    model: ImageToVideoModel
    video_url: str
    image_url: str


class CreateMotionTransferRequest(BaseModel):
    model: MotionTransferModel
    image_url: str = Field(min_length=1)
    video_url: str = Field(min_length=1)
    prompt: str = Field(default="")
    resolution: str | None = Field(default="480p")
    seed: int | None = Field(default=-1)
    character_orientation: str | None = Field(default="video")
    keep_original_sound: bool | None = Field(default=True)
    shot_type: str | None = Field(default="customize")
    element_list: list | None = Field(default=None)


class CreateMotionTransferResponse(BaseModel):
    model: MotionTransferModel
    video_url: str
    image_url: str
    source_video_url: str


class AssetDeleteRequest(BaseModel):
    id: int
    url: str

class BatchDeleteRequest(BaseModel):
    items: list[AssetDeleteRequest]


class LipsyncModel(str, Enum):
    infinitetalk_fast = "wavespeed-ai/infinitetalk-fast"
    infinitetalk_fast_multi = "wavespeed-ai/infinitetalk-fast/multi"
    infinitetalk_video_to_video = "wavespeed-ai/infinitetalk-fast/video-to-video"
    infinitetalk_video_to_video_multi = "wavespeed-ai/infinitetalk/video-to-video-multi"
    longcat_avatar = "wavespeed-ai/longcat-avatar"


class CreateLipsyncRequest(BaseModel):
    model: LipsyncModel
    # Image base models need image_url, video base models need video_url
    image_url: str | None = Field(default=None)
    video_url: str | None = Field(default=None)
    # Single audio models use audio_url, multi use left/right
    audio_url: str | None = Field(default=None)
    left_audio_url: str | None = Field(default=None)
    right_audio_url: str | None = Field(default=None)
    # Extra parameters
    order: str | None = Field(default="meanwhile")
    resolution: str | None = Field(default="480p")
    seed: int | None = Field(default=-1)


class CreateLipsyncResponse(BaseModel):
    model: LipsyncModel
    video_url: str
    # Echo back inputs depending on what was provided
    image_url: str | None
    source_video_url: str | None
    audio_url: str | None
