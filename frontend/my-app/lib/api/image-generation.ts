import {
  CharacterKeyframe,
  CharacterSheetResponse,
  CharacterView,
  CreateCharacterSheetRequest,
  CreateImageRequest,
  CreateImageResponse,
  FinalizeCharacterRequest,
  FinalizeCharacterResponse,
  GenerateScriptCharacterRequest,
  GenerateScriptEnvironmentRequest,
  GenerateObjectReferenceRequest,
  GenerateStoryboardRequest,
  GenerateStoryboardResponse,
  RegenerateShotFrameRequest,
  SetCharacterStyleRequest,
  SetCharacterStyleResponse,
  StoryboardFrame,
} from '@/lib/types/image-generation';


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

export async function generateSceneStoryboard(
  payload: GenerateStoryboardRequest,
): Promise<GenerateStoryboardResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/storyboard`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = 'Storyboard generation failed';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') {
        message = errorPayload.detail;
      }
    } catch {
      message = `Storyboard generation failed with status ${response.status}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<GenerateStoryboardResponse>;
}

export async function regenerateShotFrame(
  payload: RegenerateShotFrameRequest,
): Promise<StoryboardFrame> {
  const response = await fetch(`${getApiBaseUrl()}/api/story/storyboard/regenerate-shot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = 'Shot frame regeneration failed';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') {
        message = errorPayload.detail;
      }
    } catch {
      message = `Shot frame regeneration failed with status ${response.status}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<StoryboardFrame>;
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

export async function generateCharacterImages(payload: CreateImageRequest): Promise<CreateImageResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/character-generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = 'Character generation failed';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') {
        message = errorPayload.detail;
      }
    } catch {
      message = `Character generation failed with status ${response.status}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<CreateImageResponse>;
}

export async function saveCharacterVisualStyle(
  payload: SetCharacterStyleRequest,
): Promise<SetCharacterStyleResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/character-style`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = 'Character style update failed';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') {
        message = errorPayload.detail;
      }
    } catch {
      message = `Character style update failed with status ${response.status}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<SetCharacterStyleResponse>;
}

export async function generateScriptCharacterImages(
  payload: GenerateScriptCharacterRequest,
): Promise<CreateImageResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/character-generate-from-script`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = 'Script character generation failed';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') {
        message = errorPayload.detail;
      }
    } catch {
      message = `Script character generation failed with status ${response.status}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<CreateImageResponse>;
}

/** Compose one sheet image (face close-up, turnaround, palette, profile) for a character. */
export async function createCharacterSheet(payload: CreateCharacterSheetRequest): Promise<CharacterSheetResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/character-sheet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = `Character sheet creation failed with status ${response.status}`;
    try {
      const errorPayload = await response.json();
      if (typeof errorPayload?.detail === 'string') message = errorPayload.detail;
    } catch {
      // Keep the status-based message.
    }
    throw new Error(message);
  }

  return response.json() as Promise<CharacterSheetResponse>;
}

export async function generateScriptEnvironmentImage(
  payload: GenerateScriptEnvironmentRequest,
): Promise<CreateImageResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/environment-generate-from-script`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = 'Script environment generation failed';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') {
        message = errorPayload.detail;
      }
    } catch {
      message = `Script environment generation failed with status ${response.status}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<CreateImageResponse>;
}

export async function generateObjectReferenceImage(payload: GenerateObjectReferenceRequest): Promise<CreateImageResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/object-generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let message = 'Object reference generation failed';
    try {
      const errorPayload = await response.json();
      if (typeof errorPayload?.detail === 'string') message = errorPayload.detail;
    } catch { message = `Object reference generation failed with status ${response.status}`; }
    throw new Error(message);
  }
  return response.json() as Promise<CreateImageResponse>;
}

export async function regenerateCharacterKeyframe(
  generationJobId: string,
  view: CharacterView,
  projectId: string,
  correction = ''
): Promise<CharacterKeyframe> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/image/character-keyframes/${generationJobId}/${view}/regenerate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ project_id: projectId, correction }),
    }
  );

  if (!response.ok) {
    let message = 'Character keyframe regeneration failed';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') {
        message = errorPayload.detail;
      }
    } catch {
      message = `Character keyframe regeneration failed with status ${response.status}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<CharacterKeyframe>;
}

export async function finalizeCharacter(payload: FinalizeCharacterRequest): Promise<FinalizeCharacterResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/image/character-finalize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = 'Character save failed';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') {
        message = errorPayload.detail;
      }
    } catch {
      message = `Character save failed with status ${response.status}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<FinalizeCharacterResponse>;
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

export async function generateImageFromUpload(
  imageFile: File,
  guidancePrompt: string,
  model: string,
  provider: 'replicate' | 'wavespeed',
  projectId: string,
  characterId?: string,
  visualStyle?: string,
): Promise<CreateImageResponse> {
  const formData = new FormData();
  formData.append('image', imageFile);
  formData.append('guidance_prompt', guidancePrompt);
  formData.append('model', model);
  formData.append('provider', provider);
  formData.append('aspect_ratio', '1:1');
  formData.append('resolution', '1K'); // Capital K required by model
  formData.append('project_id', projectId);
  if (characterId) {
    formData.append('character_id', characterId);
  }
  if (visualStyle) {
    formData.append('visual_style', visualStyle);
  }

  const response = await fetch(`${getApiBaseUrl()}/api/image/generate-from-upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    let message = 'Image generation from upload failed';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') {
        message = errorPayload.detail;
      }
    } catch {
      message = `Image generation from upload failed with status ${response.status}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<CreateImageResponse>;
}

export async function generateEnvironmentImageFromUpload(
  imageFile: File,
  guidancePrompt: string,
  model: string,
  provider: 'replicate' | 'wavespeed',
  projectId: string,
  environmentId: string,
  visualStyle?: string,
): Promise<CreateImageResponse> {
  const formData = new FormData();
  formData.append('image', imageFile);
  formData.append('guidance_prompt', guidancePrompt);
  formData.append('model', model);
  formData.append('provider', provider);
  formData.append('aspect_ratio', '16:9');
  formData.append('resolution', '1K');
  formData.append('project_id', projectId);
  formData.append('environment_id', environmentId);
  if (visualStyle) {
    formData.append('visual_style', visualStyle);
  }

  const response = await fetch(`${getApiBaseUrl()}/api/image/environment-generate-from-upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    let message = 'Environment generation from upload failed';
    try {
      const errorPayload = await response.json();
      if (errorPayload?.detail && typeof errorPayload.detail === 'string') {
        message = errorPayload.detail;
      }
    } catch {
      message = `Environment generation from upload failed with status ${response.status}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<CreateImageResponse>;
}
