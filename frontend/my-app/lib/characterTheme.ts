/**
 * Stable, per-character accent colors and tag helpers.
 *
 * A character is identified by its id (falling back to its name), so the same color
 * follows it through the script editor, characters table, and storyboard workspace.
 * A `font_color` (or `accent_color` / `color`) value stored in `characters.metadata`
 * wins over the palette, letting a project override any assignment.
 */

export interface CharacterThemeSource {
  id?: string | null;
  name?: string | null;
  tags?: string[] | null;
  color?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CharacterTheme {
  /** Solid accent color, safe for text, borders, and dots. */
  accent: string;
  /** Translucent accent used for chip and badge backgrounds. */
  soft: string;
  /** Translucent accent used for chip borders. */
  border: string;
}

const ACCENTS = [
  '#f472b6',
  '#38bdf8',
  '#fbbf24',
  '#34d399',
  '#a78bfa',
  '#fb7185',
  '#22d3ee',
  '#fb923c',
  '#a3e635',
  '#e879f9',
  '#60a5fa',
  '#f87171',
] as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function hashKey(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2_147_483_647;
  }
  return hash;
}

export function characterAccent(source: CharacterThemeSource): string {
  const direct = source.color;
  if (typeof direct === 'string' && HEX_COLOR.test(direct.trim())) return direct.trim().toLowerCase();
  const metadata = source.metadata ?? {};
  for (const key of ['font_color', 'accent_color', 'color']) {
    const value = metadata[key];
    if (typeof value === 'string' && HEX_COLOR.test(value.trim())) return value.trim().toLowerCase();
  }
  const key = (source.id || source.name || 'character').trim().toLowerCase();
  return ACCENTS[hashKey(key) % ACCENTS.length];
}

export function characterTheme(source: CharacterThemeSource): CharacterTheme {
  const accent = characterAccent(source);
  return { accent, soft: `${accent}1f`, border: `${accent}66` };
}

export function characterTags(source: CharacterThemeSource): string[] {
  const tags = source.tags ?? [];
  return tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
}

/** Match a screenplay speaker label to a character by name or tag (case-insensitive). */
export function characterMatchesLabel(source: CharacterThemeSource, label: string | null | undefined): boolean {
  const target = (label ?? '').trim().toLowerCase();
  if (!target) return false;
  const labels = [source.name, ...characterTags(source)]
    .map((value) => (value ?? '').trim().toLowerCase())
    .filter((value) => value.length > 0);
  return labels.includes(target);
}
