import { readApiError } from './errors';

/** What "Generate All Scenes at Once" would do now, shown before it starts. */
export interface StoryboardBatchPreflight {
  project_id: string;
  total_scenes: number;
  scenes_to_generate: number;
  scenes_skipped: number;
  estimated_images: number;
  characters_without_references: string[];
}

export type StoryboardBatchSceneStatus = 'queued' | 'planning' | 'rendering' | 'complete' | 'failed' | 'cancelled';

export interface StoryboardBatchScene {
  scene_id: string;
  generation_job_id: string;
  status: StoryboardBatchSceneStatus;
  total_shots: number;
  completed_shots: number;
  failed_shots: number;
  error_message: string | null;
}

export interface StoryboardBatch {
  batch_id: string;
  project_id: string;
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  model: string | null;
  error_message: string | null;
  total_scenes: number;
  completed_scenes: number;
  failed_scenes: number;
  total_shots: number;
  completed_shots: number;
  failed_shots: number;
  /** Estimated at start; total_shots only counts scenes whose shot lists are planned so far. */
  estimated_images: number;
  /** "celery" (Redis workers) or "local" (worker threads inside the backend, the fallback). */
  runner: 'celery' | 'local';
  created_at: string | null;
  completed_at: string | null;
  scenes: StoryboardBatchScene[];
}

export const isStoryboardBatchActive = (batch: StoryboardBatch | null): boolean =>
  Boolean(batch && (batch.status === 'queued' || batch.status === 'running'));

function batchesUrl(path = ''): string {
  const baseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
  return `${baseUrl}/api/story/storyboard-batches${path}`;
}

async function postJson<T>(url: string, body: unknown, fallback: string): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) return readApiError(response, fallback);
  return response.json() as Promise<T>;
}

export async function getStoryboardBatchPreflight(projectId: string): Promise<StoryboardBatchPreflight> {
  const response = await fetch(batchesUrl(`/preflight?project_id=${encodeURIComponent(projectId)}`));
  if (!response.ok) return readApiError(response, 'Failed to check the scenes');
  return response.json() as Promise<StoryboardBatchPreflight>;
}

export function startStoryboardBatch(projectId: string, model: string): Promise<StoryboardBatch> {
  return postJson(batchesUrl(), { project_id: projectId, model, provider: 'wavespeed' }, 'Failed to start generating all scenes');
}

export async function getActiveStoryboardBatch(projectId: string): Promise<StoryboardBatch | null> {
  const response = await fetch(batchesUrl(`/active?project_id=${encodeURIComponent(projectId)}`));
  if (!response.ok) return readApiError(response, 'Failed to load the running batch');
  return response.json() as Promise<StoryboardBatch | null>;
}

export async function getStoryboardBatch(projectId: string, batchId: string): Promise<StoryboardBatch> {
  const response = await fetch(batchesUrl(`/${encodeURIComponent(batchId)}?project_id=${encodeURIComponent(projectId)}`));
  if (!response.ok) return readApiError(response, 'Failed to load batch progress');
  return response.json() as Promise<StoryboardBatch>;
}

export function retryFailedStoryboardBatch(projectId: string, batchId: string): Promise<StoryboardBatch> {
  return postJson(batchesUrl(`/${encodeURIComponent(batchId)}/retry-failed`), { project_id: projectId }, 'Failed to retry the failed scenes');
}

export function cancelStoryboardBatch(projectId: string, batchId: string): Promise<StoryboardBatch> {
  return postJson(batchesUrl(`/${encodeURIComponent(batchId)}/cancel`), { project_id: projectId }, 'Failed to stop the batch');
}
