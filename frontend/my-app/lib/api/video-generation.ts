import { GenerateImageToVideoPayload, ImageToVideoResponse, GenerateLipsyncPayload, LipsyncResponse } from '@/lib/types/video-generation';

function getApiBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  return baseUrl.replace(/\/$/, '');
}

export type SeedanceResolution = '480p' | '720p' | '1080p' | '4k';
export type SeedanceAspectRatio = '16:9' | '9:16' | '4:3' | '3:4' | '1:1' | '21:9';

export interface StartShotVideoBatchPayload {
  project_id: string;
  duration: number;
  /** Use each shot's planned clip length; `duration` is the fallback. */
  use_shot_durations?: boolean;
  resolution: SeedanceResolution;
  aspect_ratio: SeedanceAspectRatio;
  generate_audio: boolean;
}

export interface ShotVideoBatchJob {
  generation_job_id: string;
  shot_id: string;
  shot_number: number | null;
  status: string;
  error_message: string | null;
  video_url: string | null;
}

export interface ShotVideoBatchResponse {
  batch_id: string;
  project_id: string;
  status: string;
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  settings: Record<string, unknown>;
  jobs: ShotVideoBatchJob[];
}

export interface ShotListItem {
  shot_id: string;
  scene_id: string;
  scene_slugline: string | null;
  scene_sort_order: number;
  shot_number: number | null;
  sort_order: number;
  description: string | null;
  camera_angle: string | null;
  camera_motion: string | null;
  storyboard_url: string | null;
  video_asset_id: string | null;
  video_url: string | null;
  duration_seconds: number | null;
  /** Clip length planned from the scene's runtime budget. */
  planned_seconds: number | null;
  generation_job_id: string | null;
  batch_id: string | null;
  status: string;
  error_message: string | null;
}

export interface ShotListResponse {
  project_id: string;
  shots: ShotListItem[];
  /** Runtime chosen on the idea form, in seconds. */
  target_seconds: number | null;
  /** Sum of the shots' planned clip lengths. */
  planned_seconds: number | null;
  /** Sum of the rendered clip lengths. */
  rendered_seconds: number | null;
}

export interface AddShotVideoToTimelineResponse {
  timeline_item_id: string;
  track_id: string;
  start_time: number;
  created: boolean;
}

async function readShotVideoBatchResponse(response: Response): Promise<ShotVideoBatchResponse> {
  if (response.ok) {
    return response.json() as Promise<ShotVideoBatchResponse>;
  }
  let message = 'Shot video batch request failed';
  try {
    const errorPayload = await response.json();
    if (errorPayload?.detail && typeof errorPayload.detail === 'string') {
      message = errorPayload.detail;
    }
  } catch {
    message = `Shot video batch request failed with status ${response.status}`;
  }
  throw new Error(message);
}

export async function startShotVideoBatch(
  payload: StartShotVideoBatchPayload,
): Promise<ShotVideoBatchResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/video/shot-batches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readShotVideoBatchResponse(response);
}

export async function getShotVideoBatch(
  projectId: string,
  batchId: string,
): Promise<ShotVideoBatchResponse> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/video/shot-batches/${batchId}?project_id=${encodeURIComponent(projectId)}`,
  );
  return readShotVideoBatchResponse(response);
}

export async function retryFailedShotVideos(
  projectId: string,
  batchId: string,
): Promise<ShotVideoBatchResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/video/shot-batches/${batchId}/retry-failed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId }),
  });
  return readShotVideoBatchResponse(response);
}

export async function getShotList(projectId: string): Promise<ShotListResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/video/shot-list?project_id=${encodeURIComponent(projectId)}`);
  if (!response.ok) {
    let message = 'Failed to load Shot List';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') message = errorPayload.detail;
    } catch {
      message = `Failed to load Shot List with status ${response.status}`;
    }
    throw new Error(message);
  }
  return response.json() as Promise<ShotListResponse>;
}

export async function addShotVideoToTimeline(
  projectId: string,
  shotId: string,
  assetId: string,
): Promise<AddShotVideoToTimelineResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/video/shot-list/add-to-timeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, shot_id: shotId, asset_id: assetId }),
  });
  if (!response.ok) {
    let message = 'Failed to add video to timeline';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') message = errorPayload.detail;
    } catch {
      message = `Failed to add video to timeline with status ${response.status}`;
    }
    throw new Error(message);
  }
  return response.json() as Promise<AddShotVideoToTimelineResponse>;
}

export async function batchDeleteVideos(items: { id: number; url: string }[]): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/video/batch-delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    let message = 'Failed to delete videos';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') {
        message = errorPayload.detail;
      }
    } catch {
      message = `Failed to delete videos with status ${response.status}`;
    }
    throw new Error(message);
  }
}

export async function generateLipsync(payload: GenerateLipsyncPayload): Promise<LipsyncResponse> {
  const formData = new FormData();
  formData.append('model', payload.model);
  
  if (payload.image) formData.append('image', payload.image);
  if (payload.video) formData.append('video', payload.video);
  if (payload.audio) formData.append('audio', payload.audio);
  if (payload.left_audio) formData.append('left_audio', payload.left_audio);
  if (payload.right_audio) formData.append('right_audio', payload.right_audio);
  if (payload.order) formData.append('order', payload.order);
  if (payload.resolution) formData.append('resolution', payload.resolution);
  if (typeof payload.seed === 'number') formData.append('seed', String(payload.seed));

  const response = await fetch(`${getApiBaseUrl()}/video/lipsync`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    let message = 'Lipsync generation failed';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') {
        message = errorPayload.detail;
      }
    } catch {
      message = `Lipsync generation failed with status ${response.status}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<LipsyncResponse>;
}

export async function generateImageToVideo(payload: GenerateImageToVideoPayload): Promise<ImageToVideoResponse> {
  const formData = new FormData();
  formData.append('model', payload.model);
  formData.append('prompt', payload.prompt);
  formData.append('image', payload.image);
  formData.append('aspect_ratio', payload.aspect_ratio);
  formData.append('duration', String(payload.duration));

  if (payload.resolution) {
    formData.append('resolution', payload.resolution);
  }

  if (typeof payload.generate_audio === 'boolean') {
    formData.append('generate_audio', String(payload.generate_audio));
  }

  if (typeof payload.cfg_scale === 'number') {
    formData.append('cfg_scale', String(payload.cfg_scale));
  }

  if (payload.shot_type) {
    formData.append('shot_type', payload.shot_type);
  }

  if (typeof payload.enable_prompt_expansion === 'boolean') {
    formData.append('enable_prompt_expansion', String(payload.enable_prompt_expansion));
  }

  if (typeof payload.seed === 'number' && Number.isFinite(payload.seed)) {
    formData.append('seed', String(payload.seed));
  }

  if (payload.last_image) {
    formData.append('last_image', payload.last_image);
  }

  if (payload.multi_prompt && payload.multi_prompt.length > 0) {
    formData.append('multi_prompt', payload.multi_prompt.join('\n'));
  }

  if (payload.element_list && payload.element_list.length > 0) {
    formData.append('element_list', payload.element_list.join('\n'));
  }

  const response = await fetch(`${getApiBaseUrl()}/video/image-to-video`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    let message = 'Image to video generation failed';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') {
        message = errorPayload.detail;
      }
    } catch {
      message = `Image to video generation failed with status ${response.status}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<ImageToVideoResponse>;
}