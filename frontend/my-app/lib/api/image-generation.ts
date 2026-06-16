import { CreateImageRequest, CreateImageResponse } from '@/lib/types/image-generation';


function getApiBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  return baseUrl.replace(/\/$/, '');
}


export async function batchDeleteImages(items: { id: number; url: string }[]): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/batch-delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    let message = 'Failed to delete items';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') {
        message = errorPayload.detail;
      }
    } catch {
      message = `Failed to delete items with status ${response.status}`;
    }
    throw new Error(message);
  }
}


export async function generateImage(payload: CreateImageRequest): Promise<CreateImageResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = 'Image generation failed';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') {
        message = errorPayload.detail;
      }
    } catch {
      message = `Image generation failed with status ${response.status}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<CreateImageResponse>;
}

export async function generateInpaintImage(payload: FormData): Promise<CreateImageResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/inpaint`, {
    method: 'POST',
    body: payload,
  });

  if (!response.ok) {
    let message = 'Inpaint generation failed';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') {
        message = errorPayload.detail;
      }
    } catch {
      message = `Inpaint generation failed with status ${response.status}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<CreateImageResponse>;
}

export async function generateMultipleAngle(imageFile: File, prompt: string): Promise<{ images: string[] }> {
  const formData = new FormData();
  formData.append('image', imageFile);
  formData.append('prompt', prompt);

  const response = await fetch(`${getApiBaseUrl()}/api/image/multiple-angle`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    let message = 'Multiple angle generation failed';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') {
        message = errorPayload.detail;
      }
    } catch {
      message = `Multiple angle generation failed with status ${response.status}`;
    }
    throw new Error(message);
  }

  return response.json();
}
