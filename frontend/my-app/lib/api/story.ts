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
  /** Importance from the current script; null for objects the script never mentions. */
  ranking: ObjectRanking | null;
}

export type ObjectTier = 'major' | 'medium' | 'minor';

/** How central a character is: scenes they appear in and lines they speak. */
export interface CharacterRanking {
  character_id: string;
  rank: number;
  tier: ObjectTier;
  /** scene_score + dialogue_score, 0-4. */
  score: number;
  scene_score: number;
  dialogue_score: number;
  scene_count: number;
  dialogue_lines: number;
  /** Other characters met on screen; breaks ties. */
  scene_partners: string[];
  mentioned_by_others: number;
}

/** Characters ranked from the current script, most important first. */
export async function rankCharacters(projectId: string): Promise<CharacterRanking[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/characters/ranking?project_id=${encodeURIComponent(projectId)}`);
  if (!response.ok) return readApiError(response, 'Failed to rank characters');
  return response.json() as Promise<CharacterRanking[]>;
}

/** How much a location matters: scenes set there and characters who appear there. */
export interface EnvironmentRanking {
  environment_id: string;
  rank: number;
  tier: ObjectTier;
  /** scene_score + character_score, 0-4. */
  score: number;
  scene_score: number;
  character_score: number;
  scene_count: number;
  character_count: number;
  characters: string[];
  /** Script lines in the scenes set there; breaks ties. */
  line_count: number;
}

/** Environments ranked from the current script, most important first. */
export async function rankEnvironments(projectId: string): Promise<EnvironmentRanking[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/environments/ranking?project_id=${encodeURIComponent(projectId)}`);
  if (!response.ok) return readApiError(response, 'Failed to rank environments');
  return response.json() as Promise<EnvironmentRanking[]>;
}

/** How much an object matters: scenes it appears in and how often characters handle it. */
export interface ObjectRanking {
  rank: number;
  tier: ObjectTier;
  /** scene_score + interaction_score, 0-4. */
  score: number;
  scene_score: number;
  interaction_score: number;
  scene_count: number;
  interaction_count: number;
  mention_count: number;
  dialogue_mentions: number;
  interacting_characters: string[];
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

/** Permanent physical identity, stored in characters.physical. Keep in sync with PHYSICAL_FIELDS in the backend. */
export const PHYSICAL_FIELDS = [
  'height', 'build', 'skin_tone', 'face', 'eyes', 'hair', 'facial_hair', 'distinguishing_marks', 'glasses', 'demeanor',
] as const;
export type PhysicalField = typeof PHYSICAL_FIELDS[number];
export type CoreProfileField = 'role' | 'age' | 'gender' | 'race' | 'appearance' | 'personality';
export type ProfileField = CoreProfileField | PhysicalField;

export type CharacterProfileUpdate = {
  role?: string | null;
  age?: number | null;
  gender?: string | null;
  race?: string | null;
  appearance?: string | null;
  personality?: string | null;
  clear_fields?: ProfileField[];
} & Partial<Record<PhysicalField, string | null>>;

export type CharacterProfile = {
  id: string;
  name: string;
  role: string | null;
  age: number | null;
  gender: string | null;
  race: string | null;
  appearance: string | null;
  personality: string | null;
  manual_override_fields: string[];
} & Record<PhysicalField, string | null>;

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