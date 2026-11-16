from typing import Literal

from pydantic import BaseModel, Field


class CharacterSchema(BaseModel):
    name: str
    role: str | None = None
    archetype: str | None = None
    personality: str | None = None
    tags: list[str] = Field(default_factory=list)


class ExtractedCharacterSchema(BaseModel):
    name: str
    character_type: Literal["main", "supporting"] = "supporting"
    role: str | None = None
    age: int | None = Field(default=None, ge=0)
    gender: str | None = None
    race: str | None = None
    appearance: str | None = None
    personality: str | None = None
    tags: list[str] = Field(default_factory=list)
    image_prompt: str = ""


class ExtractScriptCharactersPayload(BaseModel):
    project_id: str = Field(min_length=1)


class ExtractScriptCharactersResponse(BaseModel):
    count: int


class UpdateCharacterProfilePayload(BaseModel):
    project_id: str = Field(min_length=1)
    character_id: str = Field(min_length=1)
    role: str | None = Field(default=None, max_length=500)
    age: int | None = Field(default=None, ge=0)
    gender: str | None = Field(default=None, max_length=120)
    race: str | None = Field(default=None, max_length=120)
    appearance: str | None = Field(default=None, max_length=2_000)
    personality: str | None = Field(default=None, max_length=2_000)
    clear_fields: list[Literal["role", "age", "gender", "race", "appearance", "personality"]] = Field(default_factory=list)


class CharacterProfileResponse(BaseModel):
    id: str
    name: str
    role: str | None = None
    age: int | None = None
    gender: str | None = None
    race: str | None = None
    appearance: str | None = None
    personality: str | None = None
    manual_override_fields: list[str] = Field(default_factory=list)


class PreviewCharacterScriptSyncPayload(BaseModel):
    project_id: str = Field(min_length=1)
    character_id: str = Field(min_length=1)


class CharacterScriptSyncPreviewResponse(BaseModel):
    character_id: str
    scene_id: str
    scene_slugline: str | None = None
    content: str
    action: Literal["insert", "replace"]


class ConfirmCharacterScriptSyncPayload(PreviewCharacterScriptSyncPayload):
    content: str = Field(min_length=1, max_length=4_000)


class ConfirmCharacterScriptSyncResponse(CharacterScriptSyncPreviewResponse):
    script_block_id: str


class ExtractScriptEnvironmentsPayload(BaseModel):
    project_id: str = Field(min_length=1)


class ExtractScriptEnvironmentsResponse(BaseModel):
    count: int


class ExtractedObjectSchema(BaseModel):
    name: str = Field(min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=2_000)
    tags: list[str] = Field(default_factory=list)
    image_prompt: str = ""
    source_scene_indexes: list[int] = Field(default_factory=list)


class ExtractScriptObjectsPayload(BaseModel):
    project_id: str = Field(min_length=1)


class ExtractScriptObjectsResponse(BaseModel):
    count: int


class CreateObjectPayload(BaseModel):
    project_id: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=2_000)
    tags: list[str] = Field(default_factory=list)


class UpdateObjectPayload(BaseModel):
    project_id: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=2_000)
    tags: list[str] | None = None


class ObjectProfileResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    manual_override_fields: list[str] = Field(default_factory=list)
    source_scene_ids: list[str] = Field(default_factory=list)
    source_sluglines: list[str] = Field(default_factory=list)
    primary_image_url: str | None = None


class MovieBasics(BaseModel):
    projectType: Literal["Feature Film", "Short", "Series"] | str = "Feature Film"
    duration: str = "120 min"
    genres: list[str] = Field(default_factory=list)
    endingType: Literal["Bittersweet", "Positive", "Cliffhanger", "Ambiguous"] | str = "Bittersweet"


class MovieStory(BaseModel):
    logline: str = ""
    premise: str = ""


class MovieIdeaPayload(BaseModel):
    project_id: str
    basics: MovieBasics
    story: MovieStory
    characters: list[CharacterSchema] = Field(default_factory=list)


class GenerateOutlineResponse(BaseModel):
    outline: str


class CreativeBrief(BaseModel):
    """Brief used by non-narrative video types to drive script generation."""

    concept: str = ""
    keyMoments: list[str] = Field(default_factory=list)
    targetAudience: str = ""
    references: str = ""
    duration: str = ""


class GenerateScriptPayload(BaseModel):
    project_id: str
    # Narrative projects send a generated outline; non-narrative video types
    # (music video, documentary, advertisement) send a creative brief instead.
    outline: str = ""
    video_type: str | None = None
    brief: CreativeBrief | None = None
    basics: MovieBasics | None = None
    characters: list[CharacterSchema] = Field(default_factory=list)


class ScriptBlockSchema(BaseModel):
    block_type: Literal["scene_heading", "action", "character", "parenthetical", "dialogue", "transition"]
    content: str
    character_name: str | None = None
    parenthetical: str | None = None
    dialogue_mode: str | None = None


class ScriptSceneSchema(BaseModel):
    slugline_raw: str
    location_type: str | None = None
    location: str | None = None
    time_of_day: str | None = None
    blocks: list[ScriptBlockSchema]


class GenerateScriptResponse(BaseModel):
    scenes: list[ScriptSceneSchema]
