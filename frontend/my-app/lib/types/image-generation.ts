export type ImageModel = 'nanobanana' | 'nanobanana2' | 'seedream45' | 'qwen' | 'z-image' | 'flux-klein';

export interface CreateImageRequest {
  model: ImageModel;
  prompt: string;
  aspect_ratio: string;
  num_images: number;
  resolution?: string;
  image_search?: boolean;
  google_search?: boolean;
  output_format?: string;
}

export interface CreateImageResponse {
  model: ImageModel;
  images: string[];
}
