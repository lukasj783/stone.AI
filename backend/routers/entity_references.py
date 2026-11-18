"""Reference galleries for environments and objects: list, upload, generate angles, delete."""

import asyncio
import os

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from services.entity_references import (
    delete_entity_reference,
    entity_kind,
    generate_entity_reference,
    list_entity_references,
    load_entity,
    set_entity_primary_reference,
    upload_entity_reference,
)
from services.replicate_service import ReplicateConfigurationError
from services.wavespeed_service import WaveSpeedServiceError

router = APIRouter(prefix="/api/image/entity-references", tags=["entity-references"])

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


class EntityReference(BaseModel):
    asset_id: str
    url: str
    angle: str
    label: str
    is_primary: bool


class EntityAngle(BaseModel):
    angle: str
    label: str


class EntityReferencesResponse(BaseModel):
    references: list[EntityReference]
    available_angles: list[EntityAngle]


class GenerateEntityReferencesRequest(BaseModel):
    project_id: str = Field(min_length=1)
    entity_type: str = Field(pattern="^(environment|prop|object)$")
    entity_id: str = Field(min_length=1)
    angles: list[str] = Field(min_length=1, max_length=8)
    model: str = "nanobanana"
    provider: str = "replicate"
    visual_style: str | None = Field(default=None, max_length=40)


class GenerateEntityReferencesResponse(BaseModel):
    references: list[EntityReference]
    failed: dict[str, str] = Field(default_factory=dict)


class EntityReferenceAction(BaseModel):
    project_id: str = Field(min_length=1)
    entity_type: str = Field(pattern="^(environment|prop|object)$")
    entity_id: str = Field(min_length=1)
    asset_id: str = Field(min_length=1)


def _references_response(entity_type: str, project_id: str, entity_id: str) -> EntityReferencesResponse:
    kind = entity_kind(entity_type)
    entity = load_entity(kind, project_id, entity_id)
    return EntityReferencesResponse(
        references=[EntityReference(**reference) for reference in list_entity_references(kind, project_id, entity)],
        available_angles=[EntityAngle(angle=angle, label=label) for angle, (label, _) in kind.angles.items()],
    )


@router.get("/{entity_type}/{entity_id}", response_model=EntityReferencesResponse)
async def list_references(entity_type: str, entity_id: str, project_id: str) -> EntityReferencesResponse:
    try:
        return await asyncio.to_thread(_references_response, entity_type, project_id, entity_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/upload", response_model=EntityReference)
async def upload_reference(
    image: UploadFile = File(...),
    project_id: str = Form(...),
    entity_type: str = Form(...),
    entity_id: str = Form(...),
    angle: str | None = Form(None),
) -> EntityReference:
    content = await image.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image is larger than 20 MB")
    try:
        reference = await asyncio.to_thread(
            upload_entity_reference, entity_type, project_id, entity_id, content, image.content_type or "", angle,
        )
        return EntityReference(**reference)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Reference upload failed: {error}") from error


@router.post("/generate", response_model=GenerateEntityReferencesResponse)
async def generate_references(payload: GenerateEntityReferencesRequest) -> GenerateEntityReferencesResponse:
    """Generate the requested angles from the main image; angles that fail are reported, not fatal."""
    try:
        kind = entity_kind(payload.entity_type)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    unknown = [angle for angle in payload.angles if angle not in kind.angles]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown {kind.noun} angles: {', '.join(unknown)}")

    semaphore = asyncio.Semaphore(max(1, int(os.getenv("ENTITY_REFERENCE_CONCURRENCY", "3"))))

    async def generate(angle: str) -> dict:
        async with semaphore:
            return await asyncio.to_thread(
                generate_entity_reference, payload.entity_type, payload.project_id, payload.entity_id,
                angle, payload.model, payload.provider, payload.visual_style,
            )

    angles = list(dict.fromkeys(payload.angles))
    results = await asyncio.gather(*(generate(angle) for angle in angles), return_exceptions=True)
    references: list[EntityReference] = []
    failed: dict[str, str] = {}
    for angle, result in zip(angles, results):
        if isinstance(result, BaseException):
            failed[angle] = str(result)
        else:
            references.append(EntityReference(**result))
    if not references:
        first_error = next(iter(failed.values()), "No reference was generated")
        status = 400 if any(isinstance(result, ValueError) for result in results) else 500
        if any(isinstance(result, (ReplicateConfigurationError, WaveSpeedServiceError)) for result in results):
            status = 500
        raise HTTPException(status_code=status, detail=first_error)
    return GenerateEntityReferencesResponse(references=references, failed=failed)


@router.post("/delete", status_code=204)
async def delete_reference(payload: EntityReferenceAction) -> None:
    try:
        await asyncio.to_thread(
            delete_entity_reference, payload.entity_type, payload.project_id, payload.entity_id, payload.asset_id,
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/primary", status_code=204)
async def set_primary_reference(payload: EntityReferenceAction) -> None:
    try:
        await asyncio.to_thread(
            set_entity_primary_reference, payload.entity_type, payload.project_id, payload.entity_id, payload.asset_id,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
