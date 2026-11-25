// Universal Script Engine client.
//
// The backend decides, per project type, which script format, unit types
// (Act, Chapter, Lesson, Scene...) and block types (Action, Narration,
// Interview...) a project may use. The database enforces the same rules, so
// the editor only offers what will save.

import { readApiError } from './api/errors';

export type ScriptRenderer = 'screenplay' | 'two_column' | 'treatment' | 'instructional';
export type BlockLane = 'video' | 'audio' | 'both' | 'structure';

export interface ScriptBlockTypeConfig {
  key: string;
  label: string;
  description: string;
  lane: BlockLane;
  is_visual: boolean;
  speaker_role: 'none' | 'optional' | 'required';
  metadata_schema: { properties?: Record<string, { type?: string }> } | null;
  sort_order: number;
}

export interface ScriptUnitTypeConfig {
  key: string;
  label: string;
  description: string;
  level: number;
  is_leaf: boolean;
}

export interface ScriptFormatConfig {
  key: string;
  label: string;
  renderer: ScriptRenderer;
  description: string;
  is_default: boolean;
}

export interface ProjectTypeScriptConfig {
  key: string;
  label: string;
  description: string;
  is_narrative: boolean;
  requires_outline: boolean;
  default_format: string;
  formats: ScriptFormatConfig[];
  unit_types: ScriptUnitTypeConfig[];
  leaf_unit_type: string;
  block_types: ScriptBlockTypeConfig[];
}

export interface ProjectScriptConfig {
  project_id: string;
  project_type: string;
  script_format: string;
  renderer: ScriptRenderer;
  config: ProjectTypeScriptConfig;
}

function getApiBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  return baseUrl.replace(/\/$/, '');
}

export async function fetchProjectScriptConfig(projectId: string): Promise<ProjectScriptConfig> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/script-engine/projects/${encodeURIComponent(projectId)}/config`,
  );
  if (!response.ok) await readApiError(response, 'Failed to load the script configuration');
  const data = await response.json();
  return data as ProjectScriptConfig;
}

export interface CompiledScriptResponse {
  project_id: string;
  project_type: string;
  format: string;
  renderer: ScriptRenderer;
  title: string;
  text: string;
  document_id?: string;
}

export async function compileProjectScript(projectId: string, save = false): Promise<CompiledScriptResponse> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/script-engine/projects/${encodeURIComponent(projectId)}/compile?save=${save}`,
  );
  if (!response.ok) await readApiError(response, 'Failed to compile the script');
  const data = await response.json();
  return data as CompiledScriptResponse;
}

export function blockConfig(
  config: ProjectTypeScriptConfig | null | undefined,
  blockType: string,
): ScriptBlockTypeConfig | undefined {
  return config?.block_types.find((block) => block.key === blockType);
}

export function leafUnitLabel(config: ProjectTypeScriptConfig | null | undefined): string {
  const leaf = config?.unit_types.find((unit) => unit.is_leaf);
  return leaf?.label ?? 'Scene';
}

export function unitLabel(config: ProjectTypeScriptConfig | null | undefined, unitType?: string | null): string {
  return config?.unit_types.find((unit) => unit.key === unitType)?.label ?? 'Section';
}

/** Metadata keys a block type accepts, from its JSON schema. */
export function metadataKeys(block: ScriptBlockTypeConfig | undefined): string[] {
  return Object.keys(block?.metadata_schema?.properties ?? {});
}

export interface TwoColumnRow<T> {
  video: T[];
  audio: T[];
  span?: T;
}

/**
 * Pair blocks into AV rows, mirroring the backend compiler: a visual block starts
 * a new row once the current row already shows a visual; audio and overlays
 * (lower thirds, on-screen text) join the current row; structural blocks span.
 */
export function buildTwoColumnRows<T extends { block_type: string }>(
  blocks: T[],
  config: ProjectTypeScriptConfig | null | undefined,
): TwoColumnRow<T>[] {
  const rows: TwoColumnRow<T>[] = [];
  let current: TwoColumnRow<T> | null = null;
  const isVisual = (block: T) => blockConfig(config, block.block_type)?.is_visual ?? true;

  for (const block of blocks) {
    const cfg = blockConfig(config, block.block_type);
    const lane: BlockLane = cfg?.lane ?? 'video';
    if (lane === 'structure') {
      rows.push({ video: [], audio: [], span: block });
      current = null;
      continue;
    }
    if ((lane === 'video' || lane === 'both') && isVisual(block)) {
      if (!current || current.video.some(isVisual) || lane === 'both') {
        current = { video: [], audio: [] };
        rows.push(current);
      }
      current.video.push(block);
      if (lane === 'both') current = null;
      continue;
    }
    if (!current) {
      current = { video: [], audio: [] };
      rows.push(current);
    }
    if (lane === 'video') current.video.push(block);
    else current.audio.push(block);
  }
  return rows;
}

const DEFAULT_BLOCK_CONTENT: Record<string, string> = {
  scene_heading: 'INT. NEW LOCATION - DAY',
  action: 'Describe what is happening on screen...',
  dialogue: 'Insert dialogue text...',
  parenthetical: '(whispering)',
  transition: 'CUT TO:',
  narration: 'Narration text...',
  voice_over: 'Voice-over line...',
  interview: 'Interview answer...',
  b_roll: 'Describe the supporting footage...',
  archival: 'Describe the archive footage or photo...',
  graphic: 'Describe the graphic or animation...',
  lower_third: 'Name, title',
  on_screen_text: 'Text shown on screen',
  visual: 'Describe what is seen...',
  product_shot: 'Describe the product shot...',
  demonstration: 'Describe the demonstration...',
  call_to_action: 'Visit us today.',
  disclaimer: 'Terms and conditions apply.',
  instruction: 'Explain the step...',
  key_point: 'Key point',
  quiz: 'Question?',
  lyric: 'Lyric line',
  performance: 'Describe the performance shot...',
  narrative_visual: 'Describe the story visual...',
  music: 'Music cue',
  sfx: 'Sound effect',
  natural_sound: 'Ambient sound',
};

export function defaultBlockContent(block: ScriptBlockTypeConfig | undefined, blockType: string): string {
  return DEFAULT_BLOCK_CONTENT[blockType] ?? `New ${block?.label.toLowerCase() ?? 'line'}...`;
}

/** Default speaker label when a spoken block needs one and none can be inherited. */
export function defaultSpeaker(blockType: string): string {
  if (blockType === 'interview') return 'INTERVIEWEE';
  if (blockType === 'narration') return 'NARRATOR';
  if (blockType === 'instruction') return 'INSTRUCTOR';
  return 'SPEAKER';
}
