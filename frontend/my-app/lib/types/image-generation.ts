export type ImageModel = 'nanobanana' | 'nanobanana2' | 'seedream45' | 'qwen' | 'z-image' | 'flux-klein';
export type CharacterView =
  | 'front'
  | 'left_three_quarter'
  | 'left_profile'
  | 'back'
  | 'right_profile'
  | 'right_three_quarter';

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
}

export interface CharacterKeyframe {
  view: CharacterView;
  image_url: string;
  prompt: string;
  seed?: number;
  model: string;
  status: string;
  asset_id?: string;
}

export interface CreateImageResponse {
  model: string;
  images: string[];
  keyframes?: CharacterKeyframe[];
  generation_job_id?: string;
}

export interface GenerateScriptCharacterRequest {
  project_id: string;
  character_id: string;
  model: ImageModel | string;
  provider?: string;
  aspect_ratio?: string;
  resolution?: string;
  output_format?: string;
  seed?: number;
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
}

export interface GenerateStoryboardResponse {
  scene_id: string;
  generation_job_id?: string | null;
  status: string;
  reused: boolean;
  frames: StoryboardFrame[];
}

export interface FinalizeCharacterRequest {
  project_id: string;
  generation_job_id: string;
  name: string;
  role?: string;
  description?: string;
  primary_view: CharacterView;
}

export interface FinalizeCharacterResponse {
  character_id: string;
  primary_asset_id: string;
}

export type InpaintModel = 'wavespeed-ai/flux-fill-dev' | 'google/nano-banana-pro/edit';
