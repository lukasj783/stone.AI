// Runtime parsing shared by the idea form and production views.
// Mirrors backend/services/duration_budget.py so both sides read "30 min",
// "1 hr", "1h 30m", "90 sec", "1:30:00" or "Dakika 3–5" the same way.

const UNIT_SECONDS: Record<string, number> = {
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, saa: 3600, masaa: 3600,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60, dakika: 60,
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1, sekunde: 1,
};

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const RANGE = new RegExp(`${NUMBER}\\s*(?:-|–|—|to)\\s*${NUMBER}`);
const AMOUNT = new RegExp(`${NUMBER}\\s*([a-z]+)?`, 'g');
const CLOCK = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/;

/** Drift from the target that counts as on target (matches the backend). */
export const RUNTIME_TOLERANCE = 0.05;

const toNumber = (text: string): number => Number(text.replace(',', '.'));

/** Whole seconds for a runtime string, or null when it cannot be read. A bare number is minutes. */
export function parseDurationSeconds(value: string | null | undefined): number | null {
  const text = (value ?? '').toLowerCase().split(/\s+/).filter(Boolean).join(' ');
  if (!text) return null;

  const clock = CLOCK.exec(text);
  if (clock) {
    const [, a, b, c] = clock;
    const seconds = c ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);
    return seconds || null;
  }

  const words = text.match(/[a-z]+/g) ?? [];
  const unitWords = words.filter((word) => word in UNIT_SECONDS);
  const range = RANGE.exec(text);
  if (range && unitWords.length <= 1) {
    const scale = unitWords.length ? UNIT_SECONDS[unitWords[0]] : 60;
    const seconds = Math.round(((toNumber(range[1]) + toNumber(range[2])) / 2) * scale);
    return seconds || null;
  }

  const firstWord = words[0];
  const leadingUnit = firstWord && text.startsWith(firstWord) ? UNIT_SECONDS[firstWord] : undefined;
  let total = 0;
  let found = false;
  for (const match of text.matchAll(AMOUNT)) {
    const scale = (match[2] && UNIT_SECONDS[match[2]]) || leadingUnit || 60;
    total += toNumber(match[1]) * scale;
    found = true;
  }
  return found && total > 0 ? Math.round(total) : null;
}

/** "45 s", "3 min", "1 h 30 min". */
export function formatSeconds(value: number): string {
  const seconds = Math.round(value);
  if (seconds < 60) return `${seconds} s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} h`);
  if (minutes) parts.push(`${minutes} min`);
  if (secs && !hours) parts.push(`${secs} s`);
  return parts.join(' ');
}

/** Signed drift of `actual` from `target` as a fraction, e.g. -0.04 is 4% short. */
export function runtimeDrift(target: number | null, actual: number | null): number | null {
  if (!target || actual == null) return null;
  return (actual - target) / target;
}

// ---------------------------------------------------------------------------
// Pacing (mirrors PACING_FACTORS / target_unit_count in duration_budget.py)
// ---------------------------------------------------------------------------

export type Pacing = 'action' | 'comedy' | 'drama';

export const PACING_OPTIONS: { id: Pacing; label: string; hint: string }[] = [
  { id: 'action', label: 'Action', hint: 'Many short scenes, fast cutting' },
  { id: 'comedy', label: 'Comedy', hint: 'Brisk scenes built around a gag' },
  { id: 'drama', label: 'Drama', hint: 'Fewer, longer scenes that breathe' },
];

const PACING_SCENE_FACTOR: Record<Pacing, number> = { action: 0.6, comedy: 0.8, drama: 1.25 };

const AVERAGE_SCENE_SECONDS: Record<string, number> = {
  feature_film: 120,
  short_film: 75,
  music_video: 20,
  documentary: 90,
  advertisement: 6,
  explainer: 20,
  educational: 90,
};

export function isPacing(value: unknown): value is Pacing {
  return value === 'action' || value === 'comedy' || value === 'drama';
}

/** Best guess from free-text genres, used until the user picks a pacing. */
export function pacingFromGenres(genres: string[]): Pacing {
  const text = genres.join(' ').toLowerCase();
  if (/\b(action|thriller|adventure|heist|war|chase|martial)/.test(text)) return 'action';
  if (/\b(comed|funny|sitcom|parody|satire)/.test(text)) return 'comedy';
  return 'drama';
}

/** About how many scenes a runtime holds at this pacing. */
export function estimateSceneCount(targetSeconds: number, videoType: string, pacing: Pacing): number {
  const average = (AVERAGE_SCENE_SECONDS[videoType] ?? 60) * PACING_SCENE_FACTOR[pacing];
  const low = Math.max(1, Math.floor(targetSeconds / (average * 1.6)));
  const high = Math.max(low, Math.ceil(targetSeconds / (average * 0.6)));
  return Math.min(high, Math.max(low, Math.round(targetSeconds / average)));
}
