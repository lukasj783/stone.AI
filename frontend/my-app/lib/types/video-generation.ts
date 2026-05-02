export type ImageToVideoModel =
  | 'kwaivgi/kling-v3.0-std/image-to-video'
  | 'google/veo3.1/image-to-video'
  | 'bytedance/seedance-2.0/image-to-video'
  | 'alibaba/wan-2.7/image-to-video';

export interface GenerateImageToVideoPayload {
  model: ImageToVideoModel;
  prompt: string;
  image: File;
  aspect_ratio: string;
  duration: number;
  resolution?: string;
  generate_audio?: boolean;
  cfg_scale?: number;
  shot_type?: string;
  enable_prompt_expansion?: boolean;
  seed?: number;
  last_image?: string;
  multi_prompt?: string[];
  element_list?: string[];
}

export interface ImageToVideoResponse {
  model: ImageToVideoModel;
  video_url: string;
  image_url: string;
}

export interface VideoGenerationHistoryItem {
  id: number;
  generation_type: string | null;
  model: string | null;
  prompt: string | null;
  result_video_url: string | null;
  created_at: string | null;
}

export type LipsyncModel =
  | 'wavespeed-ai/infinitetalk-fast'
  | 'wavespeed-ai/infinitetalk-fast/multi'
  | 'wavespeed-ai/infinitetalk-fast/video-to-video'
  | 'wavespeed-ai/infinitetalk/video-to-video-multi'
  | 'wavespeed-ai/longcat-avatar';

export interface GenerateLipsyncPayload {
  model: LipsyncModel;
  image?: File | null;
  video?: File | null;
  audio?: File | null;
  left_audio?: File | null;
  right_audio?: File | null;
  order?: string;
  resolution?: string;
  seed?: number;
}

export interface LipsyncResponse {
  model: LipsyncModel;
  video_url: string;
  image_url?: string;
  source_video_url?: string;
  audio_url?: string;
}