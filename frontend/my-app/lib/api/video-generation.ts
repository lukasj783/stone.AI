import { GenerateImageToVideoPayload, ImageToVideoResponse, GenerateLipsyncPayload, LipsyncResponse } from '@/lib/types/video-generation';

function getApiBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  return baseUrl.replace(/\/$/, '');
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