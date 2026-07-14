from typing import Literal

from pydantic import BaseModel, Field


class CharacterSchema(BaseModel):
    name: str
    role: str | None = None
    archetype: str | None = None
    personality: str | None = None
    tags: list[str] = Field(default_factory=list)


class MovieBasics(BaseModel):
    projectType: Literal["Feature Film", "Short", "Series"] | str = "Feature Film"
    duration: str = "120 min"
    genres: list[str] = Field(default_factory=list)
    themeTone: list[str] = Field(default_factory=list)
    endingType: Literal["Bittersweet", "Positive", "Cliffhanger", "Ambiguous"] | str = "Bittersweet"
    visualStyle: str = "Realistic Cinematic"


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


class GenerateScriptPayload(BaseModel):
    project_id: str
    outline: str
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
