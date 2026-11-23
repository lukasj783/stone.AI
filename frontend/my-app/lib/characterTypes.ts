import { supabase } from '@/lib/supabaseClient';

/** One type-specific profile field, e.g. a spokesperson's brand. */
export interface CharacterDetailField {
  key: string;
  label: string;
  hint: string;
}

/** A row of character_types: how characters of this type exist in the production. */
export interface CharacterTypeInfo {
  key: string;
  label: string;
  description: string;
  /** voice_only characters are heard, never drawn: no character sheet, never in a frame. */
  presence: 'on_camera' | 'voice_only';
  /** Talks straight to the lens (presenter, host, spokesperson). */
  addressesCamera: boolean;
  detailFields: CharacterDetailField[];
}

export type CharacterTypeMap = Map<string, CharacterTypeInfo>;

const toTypeInfo = (row: Record<string, unknown>): CharacterTypeInfo => ({
  key: String(row.key),
  label: String(row.label ?? row.key),
  description: typeof row.description === 'string' ? row.description : '',
  presence: row.presence === 'voice_only' ? 'voice_only' : 'on_camera',
  addressesCamera: row.addresses_camera === true,
  detailFields: (Array.isArray(row.detail_fields) ? row.detail_fields : []).flatMap((field): CharacterDetailField[] => {
    if (!field || typeof field !== 'object' || typeof (field as { key?: unknown }).key !== 'string') return [];
    const { key, label, hint } = field as { key: string; label?: unknown; hint?: unknown };
    return [{ key, label: typeof label === 'string' ? label : key, hint: typeof hint === 'string' ? hint : '' }];
  }),
});

/** Every character type, plus the keys the project's type offers (all of them when it lists none). */
export async function loadCharacterTypes(projectId: string): Promise<{ types: CharacterTypeMap; offered: string[] }> {
  const [{ data: typeRows, error: typesError }, { data: project, error: projectError }] = await Promise.all([
    supabase.from('character_types').select('*').order('sort_order'),
    supabase.from('projects').select('project_type').eq('id', projectId).maybeSingle(),
  ]);
  if (typesError) throw typesError;
  if (projectError) throw projectError;
  const types: CharacterTypeMap = new Map((typeRows ?? []).map((row) => {
    const info = toTypeInfo(row as Record<string, unknown>);
    return [info.key, info];
  }));
  let offered = [...types.keys()];
  const projectType = (project as { project_type?: string } | null)?.project_type;
  if (projectType) {
    const { data: links, error: linksError } = await supabase.from('project_type_character_types')
      .select('character_type').eq('project_type', projectType).order('sort_order');
    if (linksError) throw linksError;
    const listed = (links ?? []).map((link) => link.character_type as string).filter((key) => types.has(key));
    if (listed.length) offered = listed;
  }
  return { types, offered };
}

interface CharacterPresenceRow {
  character_type?: string | null;
  on_camera?: boolean | null;
  metadata?: Record<string, unknown> | null;
}

/** The character's type with any manual choice applied. */
export function effectiveCharacterType(row: CharacterPresenceRow): string {
  const overrides = (row.metadata?.manual_overrides ?? {}) as Record<string, unknown>;
  return typeof overrides.character_type === 'string' && overrides.character_type
    ? overrides.character_type : row.character_type || 'supporting';
}

/** Whether the character is ever seen. A manual or script on_camera wins; otherwise the type decides. */
export function isCharacterOnCamera(row: CharacterPresenceRow, types: CharacterTypeMap): boolean {
  const overrides = (row.metadata?.manual_overrides ?? {}) as Record<string, unknown>;
  if (typeof overrides.on_camera === 'boolean') return overrides.on_camera;
  if (typeof row.on_camera === 'boolean') return row.on_camera;
  return types.get(effectiveCharacterType(row))?.presence !== 'voice_only';
}
