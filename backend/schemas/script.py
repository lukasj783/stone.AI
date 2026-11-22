from typing import Any, Literal

from pydantic import BaseModel, Field


class CharacterSchema(BaseModel):
    name: str
    role: str | None = None
    archetype: str | None = None
    personality: str | None = None
    tags: list[str] = Field(default_factory=list)


# Keep in sync with EDITABLE_CHARACTER_FIELDS in services/character_views.py.
ProfileField = Literal[
    "role", "age", "gender", "race", "appearance", "personality",
    "height", "build", "skin_tone", "face", "eyes", "hair",
    "facial_hair", "distinguishing_marks", "glasses", "demeanor",
]


class PhysicalProfileSchema(BaseModel):
    """Permanent physical identity. Costume and per-shot state (expression, pose) do not belong here."""

    height: str | None = Field(default=None, max_length=300)
    build: str | None = Field(default=None, max_length=300)
    skin_tone: str | None = Field(default=None, max_length=300)
    face: str | None = Field(default=None, max_length=500)
    eyes: str | None = Field(default=None, max_length=300)
    hair: str | None = Field(default=None, max_length=300)
    facial_hair: str | None = Field(default=None, max_length=300)
    distinguishing_marks: str | None = Field(default=None, max_length=500)
    glasses: str | None = Field(default=None, max_length=300)
    demeanor: str | None = Field(default=None, max_length=500)


class ExtractedCharacterSchema(BaseModel):
    name: str
    # Any key from the character_types table (main, supporting, presenter, interviewee...).
    character_type: str = "supporting"
    role: str | None = None
    age: int | None = Field(default=None, ge=0)
    gender: str | None = None
    race: str | None = None
    appearance: str | None = None
    personality: str | None = None
    physical: PhysicalProfileSchema = Field(default_factory=PhysicalProfileSchema)
    tags: list[str] = Field(default_factory=list)
    image_prompt: str = ""


class ExtractScriptCharactersPayload(BaseModel):
    project_id: str = Field(min_length=1)


class ExtractScriptCharactersResponse(BaseModel):
    count: int


class UpdateCharacterProfilePayload(PhysicalProfileSchema):
    project_id: str = Field(min_length=1)
    character_id: str = Field(min_length=1)
    role: str | None = Field(default=None, max_length=500)
    age: int | None = Field(default=None, ge=0)
    gender: str | None = Field(default=None, max_length=120)
    race: str | None = Field(default=None, max_length=120)
    appearance: str | None = Field(default=None, max_length=2_000)
    personality: str | None = Field(default=None, max_length=2_000)
    clear_fields: list[ProfileField] = Field(default_factory=list)


class CharacterProfileResponse(PhysicalProfileSchema):
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
    ranking: "ObjectRankingSchema | None" = None


class ObjectRankingSchema(BaseModel):
    """How much an object matters, from scene appearances and character interactions."""
    rank: int
    tier: str
    score: int
    scene_score: int
    interaction_score: int
    scene_count: int
    interaction_count: int
    mention_count: int
    dialogue_mentions: int
    interacting_characters: list[str] = Field(default_factory=list)


ObjectProfileResponse.model_rebuild()


class CharacterRankingSchema(BaseModel):
    """How central a character is, from the scenes they appear in and the lines they speak."""
    character_id: str
    rank: int
    tier: str
    score: int
    scene_score: int
    dialogue_score: int
    scene_count: int
    dialogue_lines: int
    scene_partners: list[str] = Field(default_factory=list)
    mentioned_by_others: int


class EnvironmentRankingSchema(BaseModel):
    """How much a location matters, from the scenes set there and the characters who appear there."""
    environment_id: str
    rank: int
    tier: str
    score: int
    scene_score: int
    character_score: int
    scene_count: int
    character_count: int
    characters: list[str] = Field(default_factory=list)
    line_count: int


class MovieBasics(BaseModel):
    """Basics from the idea form. endingType only matters for narrative (film) projects."""

    projectType: Literal["Feature Film", "Short", "Series"] | str = "Feature Film"
    duration: str = "120 min"
    genres: list[str] = Field(default_factory=list)
    endingType: Literal["Bittersweet", "Positive", "Cliffhanger", "Ambiguous"] | str = "Bittersweet"
    # Scene pacing chosen on the idea form: "action" | "comedy" | "drama" ("" = type default).
    pacing: str = ""


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
    """Brief used by non-narrative video types (music video, documentary,
    advertisement, explainer, educational) to drive script generation."""

    concept: str = ""
    keyMoments: list[str] = Field(default_factory=list)
    targetAudience: str = ""
    references: str = ""
    duration: str = ""
    visualStyle: str = ""


class GenerateScriptPayload(BaseModel):
    project_id: str
    # Narrative projects (feature/short film) send a generated outline; every other
    # project type sends a creative brief instead.
    outline: str = ""
    # Informational only: the project's stored project_type decides the script
    # format, unit types and block types.
    video_type: str | None = None
    brief: CreativeBrief | None = None
    basics: MovieBasics | None = None
    characters: list[CharacterSchema] = Field(default_factory=list)


class ScriptBlockSchema(BaseModel):
    # Any key from script_blocks types allowed for the project's type: screenplay
    # blocks (action, dialogue...), documentary (narration, interview, b_roll...),
    # advertisement (visual, product_shot, voice_over...), educational (quiz...)...
    # The database rejects types the project type does not allow.
    block_type: str
    content: str
    character_name: str | None = None
    parenthetical: str | None = None
    dialogue_mode: str | None = None
    # Type-specific data, e.g. an interview's timestamp or a quiz's options.
    metadata: dict[str, Any] = Field(default_factory=dict)


class ScriptSceneSchema(BaseModel):
    """One script unit that holds content: a film scene, a documentary or ad scene,
    an educational section or a music video segment.

    slugline_raw is the screenplay scene heading ("INT. KITCHEN - NIGHT"); units in
    other formats have no slugline, so it carries their title instead.
    """

    slugline_raw: str = ""
    unit_type: str = "scene"
    title: str | None = None
    parent_title: str | None = None
    summary: str | None = None
    location_type: str | None = None
    location: str | None = None
    time_of_day: str | None = None
    duration_seconds: float | None = None
    blocks: list[ScriptBlockSchema] = Field(default_factory=list)


class GenerateScriptResponse(BaseModel):
    project_type: str | None = None
    script_format: str | None = None
    scenes: list[ScriptSceneSchema]
    target_seconds: int | None = None
    planned_seconds: int | None = None
