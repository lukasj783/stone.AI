/** ElevenLabs narration and character dialogue (backend: /api/story/audio). */

function getApiBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  return baseUrl.replace(/\/$/, '');
}

async function request<T>(path: string, init: RequestInit | undefined, fallbackMessage: string): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/audio${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let message = `${fallbackMessage} (status ${response.status})`;
    try {
      const payload = await response.json();
      if (typeof payload?.detail === 'string') message = payload.detail;
    } catch {
      // keep the fallback message
    }
    throw new Error(message);
  }
  return response.status === 204 ? (undefined as T) : (await response.json() as T);
}

export interface VoiceOption {
  voice_id: string;
  name: string;
  category: string | null;
  description: string | null;
  preview_url: string | null;
  labels: Record<string, string>;
}

export interface AudioCastMember {
  character_id: string;
  name: string;
  character_type: string;
  voice_id: string | null;
  voice_name: string | null;
  voice_is_clone: boolean;
  /** Made with Voice Design (from a text description). */
  voice_is_designed: boolean;
  /** The speaker still has to pass ElevenLabs' voice captcha for this clone. */
  voice_requires_verification: boolean;
  /** How the script says they sound (tone, accent, pace...). */
  voice_profile: Record<string, string>;
  line_count: number;
}

export interface AudioSceneSummary {
  id: string;
  title: string;
  sort_order: number;
  line_count: number;
  generated_count: number;
}

export interface AudioOverview {
  /** False until ELEVENLABS_API_KEY is set on the backend. */
  configured: boolean;
  model: string;
  language_code: string | null;
  narrate_action: boolean;
  narrator_voice_id: string | null;
  narrator_voice_name: string | null;
  narrator_line_count: number;
  cast: AudioCastMember[];
  unmatched_speakers: string[];
  scenes: AudioSceneSummary[];
}

export type AudioLineKind = 'dialogue' | 'narration' | 'action';

export interface AudioLine {
  block_id: string;
  scene_id: string;
  sort_order: number;
  block_type: string;
  kind: AudioLineKind;
  speaker: string;
  character_id: string | null;
  voice_id: string | null;
  voice_name: string | null;
  source_text: string;
  parentheticals: string[];
  /** Exactly what ElevenLabs receives, audio tags included. */
  text: string;
  tags: string[];
  /** Parenthetical directions that are not about the voice ("to Amina", "V.O."). */
  dropped_directions: string[];
  voice_line_id: string | null;
  audio_url: string | null;
  duration_seconds: number | null;
  generated_text: string | null;
  /** A clip exists but the line or its voice changed since. */
  is_stale: boolean;
  error: string | null;
}

export interface SceneAudio {
  scene_id: string;
  model: string;
  language_code: string | null;
  narrate_action: boolean;
  lines: AudioLine[];
  missing_voices: string[];
  failed: number;
}

export interface AudioSettingsUpdate {
  narrator_voice_id?: string | null;
  narrator_voice_name?: string | null;
  language_code?: string | null;
  narrate_action?: boolean;
}

export interface CloneVoiceRequest {
  name: string;
  files: File[];
  /** The speaker agreed to their voice being cloned and used in this project. */
  consentConfirmed: boolean;
  description?: string;
  removeBackgroundNoise?: boolean;
  /** A character id, 'narrator', or null to only add the voice to the account. */
  assignTo: string | 'narrator' | null;
}

export interface ClonedVoice {
  voice_id: string;
  name: string;
  /** The speaker must verify on elevenlabs.io (My Voices) before the clone can speak. */
  requires_verification: boolean;
  assigned_to: string | null;
}

export async function cloneVoice(projectId: string, clone: CloneVoiceRequest): Promise<ClonedVoice> {
  const form = new FormData();
  form.append('project_id', projectId);
  form.append('name', clone.name);
  form.append('consent_confirmed', String(clone.consentConfirmed));
  form.append('remove_background_noise', String(Boolean(clone.removeBackgroundNoise)));
  if (clone.description?.trim()) form.append('description', clone.description.trim());
  if (clone.assignTo === 'narrator') form.append('as_narrator', 'true');
  else if (clone.assignTo) form.append('character_id', clone.assignTo);
  clone.files.forEach((file) => form.append('files', file, file.name));

  // No Content-Type header: the browser sets the multipart boundary itself.
  const response = await fetch(`${getApiBaseUrl()}/api/story/audio/voices/clone`, { method: 'POST', body: form });
  if (!response.ok) {
    let message = `Voice cloning failed (status ${response.status})`;
    try {
      const payload = await response.json();
      if (typeof payload?.detail === 'string') message = payload.detail;
    } catch {
      // keep the fallback message
    }
    throw new Error(message);
  }
  return await response.json() as ClonedVoice;
}

export interface VoiceDesignSuggestion {
  target: string;
  voice_name: string;
  description: string;
  /** The speaker's own lines (100-1000 characters), or '' to let ElevenLabs write one. */
  sample_text: string;
}

export interface VoicePreview {
  generated_voice_id: string;
  /** Base64 audio; play it as a data: URL. */
  audio_base64: string;
  media_type: string;
  duration_seconds: number | null;
}

export interface SavedDesignedVoice {
  voice_id: string;
  name: string;
  assigned_to: string | null;
}

/** Prefill Voice Design from the script; `target` is a character id or 'narrator'. */
export function getVoiceDesignSuggestion(projectId: string, target: string): Promise<VoiceDesignSuggestion> {
  return request<VoiceDesignSuggestion>(
    `/voices/design/suggestion?project_id=${encodeURIComponent(projectId)}&target=${encodeURIComponent(target)}`,
    undefined,
    'Failed to prepare the voice design',
  );
}

/** Voice Design: preview voices for a description. Nothing is saved until one is kept. */
export function designVoice(projectId: string, description: string, sampleText: string): Promise<VoicePreview[]> {
  return request<VoicePreview[]>('/voices/design', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, description, sample_text: sampleText.trim() || null }),
  }, 'Voice design failed');
}

export function saveDesignedVoice(projectId: string, save: {
  generatedVoiceId: string;
  voiceName: string;
  description: string;
  /** A character id, 'narrator', or null to only add the voice to the account. */
  assignTo: string | 'narrator' | null;
}): Promise<SavedDesignedVoice> {
  return request<SavedDesignedVoice>('/voices/design/save', {
    method: 'POST',
    body: JSON.stringify({
      project_id: projectId,
      generated_voice_id: save.generatedVoiceId,
      voice_name: save.voiceName,
      description: save.description,
      character_id: save.assignTo && save.assignTo !== 'narrator' ? save.assignTo : null,
      as_narrator: save.assignTo === 'narrator',
    }),
  }, 'Saving the designed voice failed');
}

export function listVoices(search?: string): Promise<VoiceOption[]> {
  const query = search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
  return request<VoiceOption[]>(`/voices${query}`, undefined, 'Failed to load ElevenLabs voices');
}

export function getAudioOverview(projectId: string): Promise<AudioOverview> {
  return request<AudioOverview>(`/overview?project_id=${encodeURIComponent(projectId)}`, undefined, 'Failed to load the audio cast');
}

export function updateAudioSettings(projectId: string, update: AudioSettingsUpdate): Promise<void> {
  return request<void>('/settings', { method: 'PUT', body: JSON.stringify({ project_id: projectId, ...update }) }, 'Failed to save audio settings');
}

export function setCharacterVoice(projectId: string, characterId: string, voice: VoiceOption | null): Promise<void> {
  return request<void>('/characters/voice', {
    method: 'PUT',
    body: JSON.stringify({ project_id: projectId, character_id: characterId, voice_id: voice?.voice_id ?? null, voice_name: voice?.name ?? null }),
  }, 'Failed to save the character voice');
}

export function getSceneAudio(projectId: string, sceneId: string): Promise<SceneAudio> {
  return request<SceneAudio>(
    `/scene?project_id=${encodeURIComponent(projectId)}&scene_id=${encodeURIComponent(sceneId)}`,
    undefined,
    'Failed to load the scene lines',
  );
}

/** Voice the whole scene, or only `blockIds` (e.g. one line to regenerate). */
export function generateSceneAudio(projectId: string, sceneId: string, blockIds?: string[]): Promise<SceneAudio> {
  return request<SceneAudio>('/scene/generate', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, scene_id: sceneId, block_ids: blockIds ?? null }),
  }, 'Audio generation failed');
}
