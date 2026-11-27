import { readApiError } from './errors';
import {
  CharacterSheetResponse,
  CreateCharacterFromSheetRequest,
  DraftCharacterSheetRequest,
  DraftCharacterSheetResponse,
  GenerateCharacterSheetRequest,
  GenerateObjectSheetRequest,
  ObjectSheetResponse,
  CreateImageRequest,
  CreateImageResponse,
  GenerateScriptEnvironmentRequest,
  GenerateObjectReferenceRequest,
  GenerateStoryboardRequest,
  GenerateStoryboardResponse,
  RegenerateShotFrameRequest,
  SetCharacterStyleRequest,
  SetCharacterStyleResponse,
  StoryboardFrame,
  EntityReference,
  EntityReferencesResponse,
  GenerateEntityReferencesResponse,
  ReferenceEntityType,
  StoryboardModelOption,
} from '@/lib/types/image-generation';


function getApiBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  return baseUrl.replace(/\/$/, '');
}


export async function batchDeleteImages(items: { id: number; url: string }[]): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/batch-delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) return readApiError(response, 'Failed to delete items');
}


export async function generateImage(payload: CreateImageRequest): Promise<CreateImageResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) return readApiError(response, 'Image generation failed');

  return response.json() as Promise<CreateImageResponse>;
}

export async function generateSceneStoryboard(
  payload: GenerateStoryboardRequest,
): Promise<GenerateStoryboardResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/storyboard`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) return readApiError(response, 'Storyboard generation failed');

  return response.json() as Promise<GenerateStoryboardResponse>;
}

export async function regenerateShotFrame(
  payload: RegenerateShotFrameRequest,
): Promise<StoryboardFrame> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/storyboard/regenerate-shot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) return readApiError(response, 'Shot frame regeneration failed');

  return response.json() as Promise<StoryboardFrame>;
}

export async function generateInpaintImage(payload: FormData): Promise<CreateImageResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/inpaint`, {
    method: 'POST',
    body: payload,
  });

  if (!response.ok) return readApiError(response, 'Inpaint generation failed');

  return response.json() as Promise<CreateImageResponse>;
}

export async function saveCharacterVisualStyle(
  payload: SetCharacterStyleRequest,
): Promise<SetCharacterStyleResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/character-style`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) return readApiError(response, 'Character style update failed');

  return response.json() as Promise<SetCharacterStyleResponse>;
}

/**
 * Generate one model sheet (face close-up + turnaround) for a script character, from its
 * profile plus an optional prompt, and optionally up to four tagged reference images.
 * The first sheet a character gets is approved automatically; later ones are candidates.
 */
export async function generateCharacterSheet(payload: GenerateCharacterSheetRequest): Promise<CharacterSheetResponse> {
  const body = sheetFormData({
    project_id: payload.project_id,
    character_id: payload.character_id,
    prompt: payload.prompt ?? '',
    model: payload.model,
    visual_style: payload.visual_style,
  }, payload.references);
  const response = await fetch(`${getApiBaseUrl()}/api/image/character-sheet/generate`, { method: 'POST', body });
  if (!response.ok) return readApiError(response, 'Character sheet generation failed');
  return response.json() as Promise<CharacterSheetResponse>;
}

/** Use this sheet for the character in storyboards; its face panel becomes the face close-up. */
export async function approveCharacterSheet(projectId: string, characterId: string, assetId: string): Promise<CharacterSheetResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/character-sheet/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, character_id: characterId, asset_id: assetId }),
  });
  if (!response.ok) return readApiError(response, 'Character sheet approval failed');
  return response.json() as Promise<CharacterSheetResponse>;
}

/**
 * Generate one object sheet (front, back, side, three-quarter + a label close-up) from the
 * object's profile plus an optional prompt and up to four reference images tagged object or style.
 * The first sheet an object gets is approved automatically; later ones are candidates.
 */
export async function generateObjectSheet(payload: GenerateObjectSheetRequest): Promise<ObjectSheetResponse> {
  const body = sheetFormData({
    project_id: payload.project_id,
    object_id: payload.object_id,
    prompt: payload.prompt ?? '',
    model: payload.model,
    visual_style: payload.visual_style,
  }, payload.references);
  const response = await fetch(`${getApiBaseUrl()}/api/image/object-sheet/generate`, { method: 'POST', body });
  if (!response.ok) return readApiError(response, 'Object sheet generation failed');
  return response.json() as Promise<ObjectSheetResponse>;
}

/** Use this sheet for the object in storyboards (the gallery's main image is unchanged). */
export async function approveObjectSheet(projectId: string, objectId: string, assetId: string): Promise<ObjectSheetResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/object-sheet/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, object_id: objectId, asset_id: assetId }),
  });
  if (!response.ok) return readApiError(response, 'Object sheet approval failed');
  return response.json() as Promise<ObjectSheetResponse>;
}

function sheetFormData(fields: Record<string, string | undefined>, references: { file: File; tag: string }[] = []): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) formData.append(key, value);
  for (const reference of references) {
    formData.append('images', reference.file);
    formData.append('image_tags', reference.tag);
  }
  return formData;
}

/** Character page: generate a sheet before the character exists. Save it with createCharacterFromSheet. */
export async function draftCharacterSheet(payload: DraftCharacterSheetRequest): Promise<DraftCharacterSheetResponse> {
  const body = sheetFormData({
    project_id: payload.project_id,
    prompt: payload.prompt ?? '',
    model: payload.model,
    visual_style: payload.visual_style,
  }, payload.references);
  const response = await fetch(`${getApiBaseUrl()}/api/image/character-sheet/draft`, { method: 'POST', body });
  if (!response.ok) return readApiError(response, 'Character sheet generation failed');
  return response.json() as Promise<DraftCharacterSheetResponse>;
}

/** Create the character from a drafted sheet; the sheet becomes its storyboard reference. */
export async function createCharacterFromSheet(payload: CreateCharacterFromSheetRequest): Promise<CharacterSheetResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/character-sheet/create-character`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) return readApiError(response, 'Character save failed');
  return response.json() as Promise<CharacterSheetResponse>;
}

export async function generateScriptEnvironmentImage(
  payload: GenerateScriptEnvironmentRequest,
): Promise<CreateImageResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/environment-generate-from-script`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) return readApiError(response, 'Script environment generation failed');

  return response.json() as Promise<CreateImageResponse>;
}

export async function generateObjectReferenceImage(payload: GenerateObjectReferenceRequest): Promise<CreateImageResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/object-generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok) return readApiError(response, 'Object reference generation failed');
  return response.json() as Promise<CreateImageResponse>;
}

export async function generateMultipleAngle(imageFile: File, prompt: string): Promise<{ images: string[] }> {
  const formData = new FormData();
  formData.append('image', imageFile);
  formData.append('prompt', prompt);

  const response = await fetch(`${getApiBaseUrl()}/api/image/multiple-angle`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) return readApiError(response, 'Multiple angle generation failed');

  return response.json();
}

export async function generateEnvironmentImageFromUpload(
  imageFile: File,
  guidancePrompt: string,
  model: string,
  provider: 'replicate' | 'wavespeed',
  projectId: string,
  environmentId: string,
  visualStyle?: string,
): Promise<CreateImageResponse> {
  const formData = new FormData();
  formData.append('image', imageFile);
  formData.append('guidance_prompt', guidancePrompt);
  formData.append('model', model);
  formData.append('provider', provider);
  formData.append('aspect_ratio', '16:9');
  formData.append('resolution', '1K');
  formData.append('project_id', projectId);
  formData.append('environment_id', environmentId);
  if (visualStyle) {
    formData.append('visual_style', visualStyle);
  }

  const response = await fetch(`${getApiBaseUrl()}/api/image/environment-generate-from-upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) return readApiError(response, 'Environment generation from upload failed');

  return response.json() as Promise<CreateImageResponse>;
}

async function entityReferenceRequest<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/entity-references${path}`, init);
  if (!response.ok) return readApiError(response, fallback);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** List an environment's or object's reference images and the angles that can be generated. */
export function listEntityReferences(projectId: string, entityType: ReferenceEntityType, entityId: string): Promise<EntityReferencesResponse> {
  return entityReferenceRequest(`/${entityType}/${entityId}?project_id=${encodeURIComponent(projectId)}`, { method: 'GET' }, 'Failed to load reference images');
}

/** Add the user's own image to the gallery, optionally tagged with an angle. */
export function uploadEntityReference(projectId: string, entityType: ReferenceEntityType, entityId: string, image: File, angle?: string): Promise<EntityReference> {
  const form = new FormData();
  form.append('image', image);
  form.append('project_id', projectId);
  form.append('entity_type', entityType);
  form.append('entity_id', entityId);
  if (angle) form.append('angle', angle);
  return entityReferenceRequest('/upload', { method: 'POST', body: form }, 'Reference upload failed');
}

/** Generate new angles from the main image so they show the same place or object. */
export function generateEntityReferences(projectId: string, entityType: ReferenceEntityType, entityId: string, angles: string[]): Promise<GenerateEntityReferencesResponse> {
  return entityReferenceRequest('/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, entity_type: entityType, entity_id: entityId, angles, model: 'nanobanana', provider: 'wavespeed' }),
  }, 'Reference generation failed');
}

export function deleteEntityReference(projectId: string, entityType: ReferenceEntityType, entityId: string, assetId: string): Promise<void> {
  return entityReferenceRequest('/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, entity_type: entityType, entity_id: entityId, asset_id: assetId }),
  }, 'Failed to remove reference');
}

export function setEntityPrimaryReference(projectId: string, entityType: ReferenceEntityType, entityId: string, assetId: string): Promise<void> {
  return entityReferenceRequest('/primary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, entity_type: entityType, entity_id: entityId, asset_id: assetId }),
  }, 'Failed to set main image');
}

/** WaveSpeed edit models available for storyboard frames, default first. */
export async function listStoryboardModels(): Promise<StoryboardModelOption[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/storyboard/models`);
  if (!response.ok) return readApiError(response, 'Failed to load storyboard models');
  return response.json() as Promise<StoryboardModelOption[]>;
}
