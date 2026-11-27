export type ImageModel = 'nanobanana' | 'nanobanana2' | 'seedream45' | 'qwen' | 'z-image' | 'flux-klein';
export type VisualStyle = 'Realistic' | 'Anime' | '3D' | 'Pixel' | 'Cartoon';
export interface CreateImageRequest {
  model: ImageModel | string;
  provider?: string;
  prompt: string;
  aspect_ratio: string;
  num_images: number;
  resolution?: string;
  image_search?: boolean;
  google_search?: boolean;
  output_format?: string;
  image_input?: string[];
  image_mapping?: Record<string, string>;
  project_id?: string;
  seed?: number;
  visual_style?: VisualStyle | string;
}

export interface CreateImageResponse {
  model: string;
  images: string[];
  generation_job_id?: string;
}

export interface GenerateScriptEnvironmentRequest {
  project_id: string;
  environment_id: string;
  model: ImageModel | string;
  provider?: string;
  aspect_ratio?: string;
  resolution?: string;
  output_format?: string;
  seed?: number;
  visual_style?: VisualStyle | string;
}

export interface GenerateObjectReferenceRequest {
  project_id: string;
  object_id: string;
  model: ImageModel | string;
  provider?: string;
  aspect_ratio?: string;
  resolution?: string;
  output_format?: string;
  seed?: number;
  visual_style?: VisualStyle | string;
}

export interface GenerateStoryboardRequest {
  project_id: string;
  scene_id: string;
  force_regenerate?: boolean;
  provider?: string;
  model?: string;
}

export interface RegenerateShotFrameRequest {
  project_id: string;
  shot_id: string;
  prompt_override?: string;
  provider?: string;
  model?: string;
}

export interface StoryboardCharacterLabel {
  id?: string | null;
  name: string;
  tags?: string[];
  color?: string | null;
}

export interface StoryboardFrame {
  shot_id: string;
  shot_number: number;
  description: string;
  camera_angle?: string | null;
  camera_motion?: string | null;
  prompt: string;
  image_url?: string | null;
  status: string;
  error?: string | null;
  characters?: StoryboardCharacterLabel[];
}

export interface GenerateStoryboardResponse {
  scene_id: string;
  generation_job_id?: string | null;
  status: string;
  reused: boolean;
  frames: StoryboardFrame[];
}

/** What a character-sheet reference image should lend the character. */
export type CharacterReferenceTag = 'face' | 'outfit' | 'style';

export interface CharacterSheetReference {
  file: File;
  tag: CharacterReferenceTag;
}

/** What an object-sheet reference image should lend the object. */
export type ObjectReferenceTag = 'object' | 'style';

export interface ObjectSheetReference {
  file: File;
  tag: ObjectReferenceTag;
}

export interface GenerateObjectSheetRequest {
  project_id: string;
  object_id: string;
  /** Extra direction on top of the object's profile. */
  prompt?: string;
  /** Up to four images; empty for prompt-only creation. */
  references?: ObjectSheetReference[];
  /** A WaveSpeed storyboard model ID (see listStoryboardModels); the server default when omitted. */
  model?: string;
  visual_style?: string;
}

/** One generated object sheet (four views + a close-up). */
export interface ObjectSheetResponse {
  object_id: string;
  sheet_asset_id: string;
  sheet_url: string;
  generation_job_id: string | null;
  /** True when this sheet is the one storyboards use. */
  approved: boolean;
}

export interface GenerateCharacterSheetRequest {
  project_id: string;
  character_id: string;
  /** Extra direction on top of the script profile. */
  prompt?: string;
  /** Up to four images; empty for prompt-only creation. */
  references?: CharacterSheetReference[];
  /** A WaveSpeed storyboard model ID (see listStoryboardModels); the server default when omitted. */
  model?: string;
  visual_style?: string;
}

/** What the check of a generated sheet found before it was kept. */
export interface CharacterSheetReview {
  ok: boolean;
  /** "vision": checked by the vision model; "layout": counted from the plain background. */
  method: 'vision' | 'layout';
  face_closeup: boolean;
  views: Array<'front' | 'three_quarter' | 'profile' | 'back'>;
  problems: string[];
  face_box: number[] | null;
  text_or_labels: boolean;
}

/** One generated model sheet (face close-up + turnaround). */
export interface CharacterSheetResponse {
  character_id: string;
  sheet_asset_id: string;
  sheet_url: string;
  generation_job_id: string | null;
  /** True when this sheet is the one storyboards use. */
  approved: boolean;
  face_closeup_asset_id: string | null;
  face_closeup_url: string | null;
  review?: CharacterSheetReview | null;
}

/** A sheet drafted on the Character page before its character exists. */
export interface DraftCharacterSheetRequest {
  project_id: string;
  /** Describes the character; optional when reference images are given. */
  prompt?: string;
  references?: CharacterSheetReference[];
  /** A WaveSpeed storyboard model ID (see listStoryboardModels); the server default when omitted. */
  model?: string;
  visual_style?: string;
}

export interface DraftCharacterSheetResponse {
  sheet_asset_id: string;
  sheet_url: string;
  generation_job_id: string | null;
  review?: CharacterSheetReview | null;
}

export interface CreateCharacterFromSheetRequest {
  project_id: string;
  sheet_asset_id: string;
  name: string;
  role?: string;
  description?: string;
}

export interface SetCharacterStyleRequest {
  project_id: string;
  character_id: string;
  visual_style: VisualStyle | string;
  model?: string;
  provider?: string;
}

export interface CharacterStylePropagation {
  status: 'queued' | 'running' | 'complete' | 'error' | 'idle' | string;
  visual_style: string;
  affected_character_views: boolean;
  affected_environment_ids: string[];
  affected_object_ids: string[];
  completed: number;
  total: number;
  errors: string[];
  started_at?: string | null;
  finished_at?: string | null;
}

export interface SetCharacterStyleResponse {
  character_id: string;
  visual_style: string;
  changed: boolean;
  propagation_started: boolean;
  propagation: CharacterStylePropagation;
}

export type InpaintModel = 'wavespeed-ai/flux-fill-dev' | 'google/nano-banana-pro/edit';

export type ReferenceEntityType = 'environment' | 'prop';

/** One image in an environment's or object's reference gallery. */
export interface EntityReference {
  asset_id: string;
  url: string;
  angle: string;
  label: string;
  is_primary: boolean;
}

export interface EntityReferenceAngle {
  angle: string;
  label: string;
}

export interface EntityReferencesResponse {
  references: EntityReference[];
  available_angles: EntityReferenceAngle[];
}

export interface GenerateEntityReferencesResponse {
  references: EntityReference[];
  /** Angle key -> error message for angles that could not be generated. */
  failed: Record<string, string>;
}

/** A WaveSpeed image-edit model that can render storyboard frames. */
export interface StoryboardModelOption {
  id: string;
  label: string;
  family: string;
  /** Reference images beyond this are dropped for this model. */
  max_images: number;
  /** False when the model's parameters were assumed from a sibling model, not confirmed. */
  verified: boolean;
  page_url: string;
  notes: string;
  is_default: boolean;
}
