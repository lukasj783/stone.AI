"""Story narration and character dialogue voiced with ElevenLabs."""

import asyncio
from collections.abc import Callable
from typing import Any, TypeVar

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from core.config import get_settings
from schemas.audio import (
    AudioOverviewResponse,
    CloneVoiceResponse,
    DesignVoicePayload,
    SaveDesignedVoicePayload,
    SavedDesignedVoiceResponse,
    VoiceDesignSuggestionResponse,
    VoicePreviewSchema,
    GenerateSceneAudioPayload,
    SceneAudioResponse,
    UpdateAudioSettingsPayload,
    UpdateCharacterVoicePayload,
    VoiceOptionSchema,
)
from services.elevenlabs_client import ElevenLabsError, list_voices
from services.voice_generation import (
    MAX_CLONE_SAMPLE_BYTES,
    MAX_CLONE_SAMPLES,
    CloneSample,
    clone_and_assign,
    design_voice_previews,
    generate_scene_audio,
    save_design_and_assign,
    suggest_voice_design,
    load_audio_overview,
    load_scene_audio,
    set_character_voice,
    update_audio_settings,
)

router = APIRouter(prefix="/api/story/audio", tags=["audio"])

T = TypeVar("T")


async def _run(action: str, work: Callable[[], T]) -> T:
    """Run blocking Supabase/ElevenLabs work off the event loop with consistent errors."""
    try:
        return await asyncio.to_thread(work)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ElevenLabsError as error:
        status = 400 if error.status_code in (401, 403, 422) else 502
        raise HTTPException(status_code=status, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"{action} failed: {error}") from error


@router.get("/voices", response_model=list[VoiceOptionSchema])
async def get_voices(search: str | None = None) -> list[VoiceOptionSchema]:
    """Voices the ElevenLabs key can use: premade ones plus the account's cloned or designed voices."""
    def work() -> list[VoiceOptionSchema]:
        api_key = get_settings().elevenlabs_api_key
        if not api_key:
            raise ValueError("ElevenLabs is not configured: set ELEVENLABS_API_KEY in backend/.env")
        return [
            VoiceOptionSchema(
                voice_id=voice.voice_id, name=voice.name, category=voice.category,
                description=voice.description, preview_url=voice.preview_url, labels=voice.labels or {},
            )
            for voice in list_voices(api_key=api_key, search=search)
        ]
    return await _run("Loading voices", work)


@router.post("/voices/clone", response_model=CloneVoiceResponse, status_code=201)
async def post_clone_voice(
    project_id: str = Form(..., min_length=1),
    name: str = Form(..., min_length=1, max_length=100),
    # The person whose voice this is agreed to it being cloned and used here.
    consent_confirmed: bool = Form(False),
    description: str | None = Form(None, max_length=500),
    remove_background_noise: bool = Form(False),
    character_id: str | None = Form(None),
    as_narrator: bool = Form(False),
    files: list[UploadFile] = File(...),
) -> Any:
    """Instant Voice Clone from recordings of a consenting speaker, optionally assigned right away."""
    if len(files) > MAX_CLONE_SAMPLES:
        raise HTTPException(status_code=400, detail=f"Use at most {MAX_CLONE_SAMPLES} recordings per voice")
    samples: list[CloneSample] = []
    for upload in files:
        content = await upload.read(MAX_CLONE_SAMPLE_BYTES + 1)
        samples.append(CloneSample(
            filename=upload.filename or "sample", content=content, content_type=upload.content_type or "",
        ))
    return await _run("Voice cloning", lambda: clone_and_assign(
        project_id,
        name=name,
        samples=samples,
        consent_confirmed=consent_confirmed,
        description=description,
        remove_background_noise=remove_background_noise,
        character_id=character_id or None,
        as_narrator=as_narrator,
    ))


@router.get("/voices/design/suggestion", response_model=VoiceDesignSuggestionResponse)
async def get_voice_design_suggestion(project_id: str, target: str) -> Any:
    """A voice description and preview text for ``target`` (a character id or "narrator") from the script."""
    return await _run("Preparing the voice design", lambda: suggest_voice_design(project_id, target))


@router.post("/voices/design", response_model=list[VoicePreviewSchema])
async def post_design_voice(payload: DesignVoicePayload) -> Any:
    """Voice Design: preview voices for a text description. Nothing is saved yet."""
    return await _run("Voice design", lambda: design_voice_previews(payload.description, payload.sample_text))


@router.post("/voices/design/save", response_model=SavedDesignedVoiceResponse, status_code=201)
async def post_save_designed_voice(payload: SaveDesignedVoicePayload) -> Any:
    """Keep one preview as an ElevenLabs voice and give it to a character or the narrator."""
    return await _run("Saving the designed voice", lambda: save_design_and_assign(
        payload.project_id,
        generated_voice_id=payload.generated_voice_id,
        voice_name=payload.voice_name,
        description=payload.description,
        character_id=payload.character_id or None,
        as_narrator=payload.as_narrator,
    ))


@router.get("/overview", response_model=AudioOverviewResponse)
async def get_audio_overview(project_id: str) -> Any:
    """Audio settings, the cast with their voices and line counts, and per-scene progress."""
    return await _run("Loading audio", lambda: load_audio_overview(project_id))


@router.put("/settings", status_code=204)
async def put_audio_settings(payload: UpdateAudioSettingsPayload) -> None:
    changes = {name: getattr(payload, name) for name in payload.model_fields_set if name != "project_id"}
    if "narrator_voice_id" in changes:
        changes.setdefault("narrator_voice_name", payload.narrator_voice_name)
    await _run("Saving audio settings", lambda: update_audio_settings(payload.project_id, changes))


@router.put("/characters/voice", status_code=204)
async def put_character_voice(payload: UpdateCharacterVoicePayload) -> None:
    await _run("Saving the character voice", lambda: set_character_voice(
        payload.project_id, payload.character_id, payload.voice_id, payload.voice_name,
    ))


@router.get("/scene", response_model=SceneAudioResponse)
async def get_scene_audio(project_id: str, scene_id: str) -> Any:
    """The scene's lines as ElevenLabs will speak them (parentheticals as audio tags) and any clips made."""
    return await _run("Loading scene audio", lambda: load_scene_audio(project_id, scene_id))


@router.post("/scene/generate", response_model=SceneAudioResponse)
async def post_generate_scene_audio(payload: GenerateSceneAudioPayload) -> Any:
    """Voice a scene's narration and dialogue, or only ``block_ids``, replacing earlier clips."""
    return await _run("Audio generation", lambda: generate_scene_audio(
        payload.project_id, payload.scene_id, payload.block_ids,
    ))
