function getApiBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  return baseUrl.replace(/\/$/, '');
}

export async function extractScriptCharacters(projectId: string): Promise<number> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/extract-characters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId }),
  });

  if (!response.ok) {
    let message = 'Failed to extract characters from the current script';
    try {
      const errorPayload = await response.json();
      if (typeof errorPayload?.detail === 'string') message = errorPayload.detail;
    } catch {
      message = `Character extraction failed with status ${response.status}`;
    }
    throw new Error(message);
  }

  const result = await response.json() as { count: number };
  return result.count;
}

export async function extractScriptEnvironments(projectId: string): Promise<number> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/extract-environments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId }),
  });

  if (!response.ok) {
    let message = 'Failed to extract environments from the current script';
    try {
      const errorPayload = await response.json();
      if (typeof errorPayload?.detail === 'string') message = errorPayload.detail;
    } catch {
      message = `Environment extraction failed with status ${response.status}`;
    }
    throw new Error(message);
  }

  const result = await response.json() as { count: number };
  return result.count;
}

export interface StudioObject {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  sources: string[];
  manual_override_fields: string[];
  source_scene_ids: string[];
  source_sluglines: string[];
  primary_image_url: string | null;
}

export interface ObjectProfileUpdate {
  name?: string;
  description?: string | null;
  tags?: string[];
}

export async function extractScriptObjects(projectId: string): Promise<number> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/extract-objects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: projectId }),
  });
  if (!response.ok) return readApiError(response, 'Failed to extract objects from the current script');
  return (await response.json() as { count: number }).count;
}

export async function listObjects(projectId: string): Promise<StudioObject[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/objects?project_id=${encodeURIComponent(projectId)}`);
  if (!response.ok) return readApiError(response, 'Failed to load objects');
  return response.json() as Promise<StudioObject[]>;
}

export async function createObject(projectId: string, payload: Required<Pick<StudioObject, 'name'>> & ObjectProfileUpdate): Promise<StudioObject> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/objects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: projectId, ...payload }),
  });
  if (!response.ok) return readApiError(response, 'Failed to create object');
  return response.json() as Promise<StudioObject>;
}

export async function updateObject(projectId: string, objectId: string, payload: ObjectProfileUpdate): Promise<StudioObject> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/objects/${objectId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: projectId, ...payload }),
  });
  if (!response.ok) return readApiError(response, 'Failed to save object');
  return response.json() as Promise<StudioObject>;
}

export async function deleteObject(projectId: string, objectId: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/objects/${objectId}?project_id=${encodeURIComponent(projectId)}`, { method: 'DELETE' });
  if (!response.ok) return readApiError(response, 'Failed to delete object');
}

export interface CharacterProfileUpdate {
  role?: string | null;
  age?: number | null;
  gender?: string | null;
  race?: string | null;
  appearance?: string | null;
  personality?: string | null;
  clear_fields?: Array<'role' | 'age' | 'gender' | 'race' | 'appearance' | 'personality'>;
}

export interface CharacterProfile {
  id: string;
  name: string;
  role: string | null;
  age: number | null;
  gender: string | null;
  race: string | null;
  appearance: string | null;
  personality: string | null;
  manual_override_fields: string[];
}

export interface CharacterScriptSyncPreview {
  character_id: string;
  scene_id: string;
  scene_slugline: string | null;
  content: string;
  action: 'insert' | 'replace';
}

async function readApiError(response: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const payload = await response.json();
    if (typeof payload?.detail === 'string') message = payload.detail;
  } catch {
    message = `${fallback} (${response.status})`;
  }
  throw new Error(message);
}

export async function updateCharacterProfile(projectId: string, characterId: string, update: CharacterProfileUpdate): Promise<CharacterProfile> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/characters/profile`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: projectId, character_id: characterId, ...update }),
  });
  if (!response.ok) return readApiError(response, 'Failed to save character profile');
  return response.json() as Promise<CharacterProfile>;
}

export async function previewCharacterScriptSync(projectId: string, characterId: string): Promise<CharacterScriptSyncPreview> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/characters/script-sync/preview`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: projectId, character_id: characterId }),
  });
  if (!response.ok) return readApiError(response, 'Failed to preview script update');
  return response.json() as Promise<CharacterScriptSyncPreview>;
}

export async function confirmCharacterScriptSync(projectId: string, preview: CharacterScriptSyncPreview): Promise<CharacterScriptSyncPreview & { script_block_id: string }> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/characters/script-sync/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: projectId, character_id: preview.character_id, content: preview.content }),
  });
  if (!response.ok) return readApiError(response, 'Failed to update script');
  return response.json() as Promise<CharacterScriptSyncPreview & { script_block_id: string }>;
}