from pydantic import BaseModel, Field


class VoiceOptionSchema(BaseModel):
    voice_id: str
    name: str
    category: str | None = None
    description: str | None = None
    preview_url: str | None = None
    labels: dict[str, str] = Field(default_factory=dict)


class CloneVoiceResponse(BaseModel):
    voice_id: str
    name: str
    # The speaker must pass ElevenLabs' voice captcha (My Voices -> verify) before use.
    requires_verification: bool = False
    # The character id, "narrator", or null when the voice was only added to the account.
    assigned_to: str | None = None


class VoiceDesignSuggestionResponse(BaseModel):
    """Voice Design prefilled from the script for a character or the narrator."""

    target: str
    voice_name: str
    description: str
    # The speaker's own lines (100-1000 characters), or "" to let ElevenLabs write one.
    sample_text: str = ""


class DesignVoicePayload(BaseModel):
    project_id: str = Field(min_length=1)
    description: str = Field(min_length=1, max_length=1000)
    sample_text: str | None = Field(default=None, max_length=1000)


class VoicePreviewSchema(BaseModel):
    generated_voice_id: str
    audio_base64: str
    media_type: str = "audio/mpeg"
    duration_seconds: float | None = None


class SaveDesignedVoicePayload(BaseModel):
    project_id: str = Field(min_length=1)
    generated_voice_id: str = Field(min_length=1, max_length=200)
    voice_name: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=1000)
    character_id: str | None = None
    as_narrator: bool = False


class SavedDesignedVoiceResponse(BaseModel):
    voice_id: str
    name: str
    assigned_to: str | None = None


class AudioCastMemberSchema(BaseModel):
    character_id: str
    name: str
    character_type: str = ""
    voice_id: str | None = None
    voice_name: str | None = None
    voice_is_clone: bool = False
    voice_is_designed: bool = False
    voice_requires_verification: bool = False
    # How the script says they sound (tone, accent...), to help pick a voice.
    voice_profile: dict[str, str] = Field(default_factory=dict)
    line_count: int = 0


class AudioSceneSummarySchema(BaseModel):
    id: str
    title: str
    sort_order: int = 0
    line_count: int = 0
    generated_count: int = 0


class AudioOverviewResponse(BaseModel):
    configured: bool
    model: str
    language_code: str | None = None
    narrate_action: bool = False
    narrator_voice_id: str | None = None
    narrator_voice_name: str | None = None
    narrator_line_count: int = 0
    cast: list[AudioCastMemberSchema] = Field(default_factory=list)
    # Dialogue speakers in the script with no matching character row.
    unmatched_speakers: list[str] = Field(default_factory=list)
    scenes: list[AudioSceneSummarySchema] = Field(default_factory=list)


class UpdateCharacterVoicePayload(BaseModel):
    project_id: str = Field(min_length=1)
    character_id: str = Field(min_length=1)
    # null removes the character's voice.
    voice_id: str | None = Field(default=None, max_length=120)
    voice_name: str | None = Field(default=None, max_length=200)


class UpdateAudioSettingsPayload(BaseModel):
    """Only the fields sent are changed."""

    project_id: str = Field(min_length=1)
    narrator_voice_id: str | None = Field(default=None, max_length=120)
    narrator_voice_name: str | None = Field(default=None, max_length=200)
    # ISO 639 code forced on ElevenLabs ("sw" = Swahili); null lets the model detect it.
    language_code: str | None = Field(default=None, max_length=3)
    # Read screenplay action lines with the narrator voice (audiobook-style narration).
    narrate_action: bool | None = None


class AudioLineSchema(BaseModel):
    block_id: str
    scene_id: str
    sort_order: int
    block_type: str
    kind: str  # dialogue | narration | action
    speaker: str
    character_id: str | None = None
    voice_id: str | None = None
    voice_name: str | None = None
    source_text: str
    parentheticals: list[str] = Field(default_factory=list)
    # Exactly what ElevenLabs receives, audio tags included.
    text: str
    tags: list[str] = Field(default_factory=list)
    # Parenthetical directions that are not about the voice ("to Amina", "V.O.").
    dropped_directions: list[str] = Field(default_factory=list)
    voice_line_id: str | None = None
    audio_url: str | None = None
    duration_seconds: float | None = None
    generated_text: str | None = None
    # The clip exists but the line or its voice changed since.
    is_stale: bool = False
    error: str | None = None


class SceneAudioResponse(BaseModel):
    scene_id: str
    model: str
    language_code: str | None = None
    narrate_action: bool = False
    lines: list[AudioLineSchema] = Field(default_factory=list)
    missing_voices: list[str] = Field(default_factory=list)
    failed: int = 0


class GenerateSceneAudioPayload(BaseModel):
    project_id: str = Field(min_length=1)
    scene_id: str = Field(min_length=1)
    # Only these lines (e.g. one regenerated line); null voices the whole scene.
    block_ids: list[str] | None = Field(default=None, max_length=500)
