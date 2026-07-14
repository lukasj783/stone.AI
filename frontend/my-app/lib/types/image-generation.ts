export type ImageModel = 'nanobanana' | 'nanobanana2' | 'seedream45' | 'qwen' | 'z-image' | 'flux-klein';

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
}

export interface CreateImageResponse {
  model: string;
  images: string[];
}

export type InpaintModel = 'wavespeed-ai/flux-fill-dev' | 'google/nano-banana-pro/edit';
