// Video type catalogue for the AI Movie Studio.
//
// Every studio project starts by picking ONE video type. The type decides the
// production pipeline:
//   • Narrative types (Feature Film, Short Film) → Idea → Outline → Script
//   • Non-narrative types (Music Video, Documentary, Advertisement)
//     → Brief → Script (no movie outline / three-act structure)

export type StudioVideoTypeId =
  | 'feature_film'
  | 'short_film'
  | 'music_video'
  | 'documentary'
  | 'advertisement';

export type StudioVideoIcon =
  | 'film'
  | 'clapperboard'
  | 'music'
  | 'bookopen'
  | 'megaphone';

export interface StudioVideoTypeConfig {
  id: StudioVideoTypeId;
  label: string;
  /** Short Swahili description shown on the selector card. */
  description: string;
  /** Example genres / sub-categories shown on the selector card. */
  examples: string[];
  /** Typical runtime, e.g. "Dakika 3–20". */
  duration: string;
  /** Runtime seeded into a new idea/brief form. */
  defaultDuration: string;
  /** Genres seeded into a new idea/brief form. */
  defaultGenres: string[];
  /**
   * Sub-format choices shown on narrative idea forms. Non-narrative types leave
   * this empty and display their video-type label instead of a format select.
   */
  formatOptions: string[];
  icon: StudioVideoIcon;
  /** Tailwind gradient used for the card accent. */
  gradient: string;
  /**
   * Narrative video types must go through the Outline stage before a script
   * can be generated. Non-narrative types generate a script straight from
   * their brief.
   */
  requiresOutline: boolean;
  /** Label of the primary call-to-action on the idea/brief workspace. */
  primaryAction: string;
}

export const DEFAULT_STUDIO_VIDEO_TYPE: StudioVideoTypeId = 'feature_film';

export const STUDIO_VIDEO_TYPES: StudioVideoTypeConfig[] = [
  {
    id: 'feature_film',
    label: 'Feature Film',
    description: 'Filamu kamili yenye story ndefu na matawi ya hadithi.',
    examples: ['Action', 'Drama', 'Comedy'],
    duration: 'Dakika 90–120',
    defaultDuration: '120 min',
    defaultGenres: ['Drama', 'Action', 'Thriller'],
    formatOptions: ['Feature Film', 'Series'],
    icon: 'film',
    gradient: 'from-violet-900/40 via-purple-950/30 to-fuchsia-950/20',
    requiresOutline: true,
    primaryAction: 'Generate Outline',
  },
  {
    id: 'short_film',
    label: 'Short Film',
    description: 'Filamu fupi yenye story kamili.',
    examples: ['Action', 'Drama', 'Comedy'],
    duration: 'Dakika 3–20',
    defaultDuration: '15 min',
    defaultGenres: ['Drama', 'Comedy'],
    formatOptions: ['Short Film'],
    icon: 'clapperboard',
    gradient: 'from-sky-900/40 via-blue-950/30 to-indigo-950/20',
    requiresOutline: true,
    primaryAction: 'Generate Outline',
  },
  {
    id: 'music_video',
    label: 'Music Video',
    description: 'Video inayoambatana na wimbo.',
    examples: ['Bongo Flava', 'Gospel'],
    duration: 'Dakika 3–5',
    defaultDuration: '3 min',
    defaultGenres: ['Bongo Flava', 'Gospel'],
    formatOptions: [],
    icon: 'music',
    gradient: 'from-pink-900/40 via-rose-950/30 to-fuchsia-950/20',
    requiresOutline: false,
    primaryAction: 'Generate Script',
  },
  {
    id: 'documentary',
    label: 'Documentary',
    description: 'Video inayochunguza au kuelezea jambo halisi.',
    examples: ['Wildlife', 'History'],
    duration: 'Dakika 10–60',
    defaultDuration: '30 min',
    defaultGenres: ['Wildlife', 'History'],
    formatOptions: [],
    icon: 'bookopen',
    gradient: 'from-emerald-900/40 via-teal-950/30 to-green-950/20',
    requiresOutline: false,
    primaryAction: 'Generate Script',
  },
  {
    id: 'advertisement',
    label: 'Advertisement',
    description: 'Video ya kutangaza bidhaa au huduma.',
    examples: ['Product commercial'],
    duration: 'Sekunde 15–60',
    defaultDuration: '30 sec',
    defaultGenres: ['Product commercial'],
    formatOptions: [],
    icon: 'megaphone',
    gradient: 'from-amber-900/40 via-orange-950/30 to-yellow-950/20',
    requiresOutline: false,
    primaryAction: 'Generate Script',
  },
];

const VIDEO_TYPE_IDS = new Set<string>(STUDIO_VIDEO_TYPES.map((type) => type.id));

/** Legacy project-type labels stored by older idea documents. */
const LEGACY_ALIASES: Record<string, StudioVideoTypeId> = {
  featurefilm: 'feature_film',
  feature_film: 'feature_film',
  movie: 'feature_film',
  short: 'short_film',
  shortfilm: 'short_film',
  short_film: 'short_film',
  series: 'feature_film',
  musicvideo: 'music_video',
  music_video: 'music_video',
  documentary: 'documentary',
  advertisement: 'advertisement',
  ad: 'advertisement',
  commercial: 'advertisement',
};

/** Returns the config for a video type id (falls back to Feature Film). */
export function getVideoTypeConfig(videoType?: string | null): StudioVideoTypeConfig {
  const config = STUDIO_VIDEO_TYPES.find((type) => type.id === videoType);
  return config ?? STUDIO_VIDEO_TYPES[0];
}

/** Type guard for arbitrary strings coming from Supabase JSON columns. */
export function isStudioVideoType(value: unknown): value is StudioVideoTypeId {
  return typeof value === 'string' && VIDEO_TYPE_IDS.has(value);
}

/**
 * Resolves a video type from a project's `settings` JSON column, meta payload
 * or a legacy project-type label. Always returns a valid id.
 */
export function resolveVideoType(
  source?: string | Record<string, unknown> | null,
): StudioVideoTypeId {
  if (!source) return DEFAULT_STUDIO_VIDEO_TYPE;

  if (typeof source === 'string') {
    const normalized = source.trim().toLowerCase().replace(/\s+/g, '');
    if (isStudioVideoType(source)) return source;
    return LEGACY_ALIASES[normalized] ?? DEFAULT_STUDIO_VIDEO_TYPE;
  }

  const fromSettings = source.videoType ?? source.video_type;
  if (isStudioVideoType(fromSettings)) return fromSettings;

  const fromProjectType =
    typeof source.projectType === 'string' ? source.projectType : undefined;
  if (fromProjectType) return resolveVideoType(fromProjectType);

  return DEFAULT_STUDIO_VIDEO_TYPE;
}

/** True when the video type must pass through the Outline stage. */
export function videoTypeRequiresOutline(videoType?: string | null): boolean {
  return getVideoTypeConfig(resolveVideoType(videoType)).requiresOutline;
}

/** True for Feature Film / Short Film (narrative movie projects). */
export function isNarrativeVideoType(videoType?: string | null): boolean {
  return videoTypeRequiresOutline(videoType);
}

/** Persisted shape written into `projects.settings` for studio projects. */
export interface StudioProjectSettings extends Record<string, unknown> {
  app: 'studio';
  videoType: StudioVideoTypeId;
}
