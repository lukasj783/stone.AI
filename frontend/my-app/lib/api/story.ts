import { readApiError } from './errors';

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

  if (!response.ok) return readApiError(response, 'Failed to extract characters from the current script');

  const result = await response.json() as { count: number };
  return result.count;
}

export async function extractScriptEnvironments(projectId: string): Promise<number> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/extract-environments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId }),
  });

  if (!response.ok) return readApiError(response, 'Failed to extract environments from the current script');

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
  /** Size, shape, colours...: every field is present, null when not filled in. */
  profile: Record<ObjectProfileField, string | null>;
  /** The approved object sheet storyboard frames use; null until one is approved. */
  sheet: { asset_id: string; url: string } | null;
  /** Every generated object sheet, newest first. */
  sheet_versions: { asset_id: string; url: string; approved: boolean }[];
  /** Importance from the current script; null for objects the script never mentions. */
  ranking: ObjectRanking | null;
}

/** Keep in sync with OBJECT_PROFILE_FIELDS in backend/services/entity_profiles.py. */
export const OBJECT_PROFILE_FIELDS = ['size', 'shape', 'colors', 'material', 'branding', 'details'] as const;
export type ObjectProfileField = typeof OBJECT_PROFILE_FIELDS[number];

/** Keep in sync with ENVIRONMENT_PROFILE_FIELDS in backend/services/entity_profiles.py. */
export const ENVIRONMENT_PROFILE_FIELDS = ['look', 'lighting', 'fixed_features'] as const;
export type EnvironmentProfileField = typeof ENVIRONMENT_PROFILE_FIELDS[number];

/** A script location with its editable profile and the gallery's main image. */
export interface StudioEnvironment {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  primary_image_url: string | null;
  profile: Record<EnvironmentProfileField, string | null>;
  /** 'description', 'tags' and profile keys the user set by hand. */
  manual_override_fields: string[];
  location_types: string[];
  time_of_day_values: string[];
  source_scene_ids: string[];
  source_sluglines: string[];
  scene_count: number;
  /** Joined client-side from rankEnvironments; null when the script never sets a scene there. */
  ranking: EnvironmentRanking | null;
}

export interface EnvironmentProfileUpdate {
  description?: string | null;
  tags?: string[];
  /** Only the keys sent change; null or '' clears the field and its Manual mark. */
  profile?: Partial<Record<EnvironmentProfileField, string | null>>;
}

/** Script environments by name, without rankings (see rankEnvironments). */
export async function listEnvironments(projectId: string): Promise<StudioEnvironment[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/environments?project_id=${encodeURIComponent(projectId)}`);
  if (!response.ok) return readApiError(response, 'Failed to load environments');
  const rows = await response.json() as Omit<StudioEnvironment, 'ranking'>[];
  return rows.map((row) => ({ ...row, ranking: null }));
}

export async function updateEnvironment(projectId: string, environmentId: string, payload: EnvironmentProfileUpdate): Promise<StudioEnvironment> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/environments/${environmentId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: projectId, ...payload }),
  });
  if (!response.ok) return readApiError(response, 'Failed to save environment');
  return { ...await response.json() as Omit<StudioEnvironment, 'ranking'>, ranking: null };
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
  /** Only the keys sent change; null or '' clears the field and its Manual mark. */
  profile?: Partial<Record<ObjectProfileField, string | null>>;
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

export async function createObject(projectId: string, payload: Required<Pick<StudioObject, 'name'>> & Omit<ObjectProfileUpdate, 'profile'>): Promise<StudioObject> {
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

/** How a character sounds, stored in characters.voice. Keep in sync with VOICE_FIELDS in the backend. */
export const VOICE_FIELDS = ['tone', 'accent', 'pace', 'pitch', 'delivery'] as const;
export type VoiceField = typeof VOICE_FIELDS[number];

/**
 * Keys a profile reset can clear: profile fields, plus "character_type", "on_camera",
 * "voice.<field>" and "type_details.<field>".
 */
export type ProfileOverrideKey = ProfileField | 'character_type' | 'on_camera' | `voice.${VoiceField}` | `type_details.${string}`;

export type CharacterProfileUpdate = {
  role?: string | null;
  age?: number | null;
  gender?: string | null;
  race?: string | null;
  appearance?: string | null;
  personality?: string | null;
  /** A character_types key the project type offers. */
  character_type?: string;
  /** Overrides the type's presence; null returns to it. */
  on_camera?: boolean | null;
  /** An empty value removes the manual value for that field. */
  voice?: Partial<Record<VoiceField, string | null>>;
  type_details?: Record<string, string | null>;
  clear_fields?: ProfileOverrideKey[];
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
  character_type: string;
  on_camera: boolean;
  voice: Partial<Record<VoiceField, string>>;
  type_details: Record<string, string>;
  manual_override_fields: string[];
} & Record<PhysicalField, string | null>;

export interface CharacterScriptSyncPreview {
  character_id: string;
  scene_id: string;
  scene_slugline: string | null;
  content: string;
  action: 'insert' | 'replace';
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