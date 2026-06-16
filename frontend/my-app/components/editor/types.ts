export interface UploadedAsset {
  id: string;
  name: string;
  url: string;
  type: 'video' | 'image' | 'audio' | 'text';
  size: number;
  duration?: number;
  uploadedAt: number;
  textContent?: string;
}

export type AssetTab = 'video' | 'image' | 'music' | 'voice' | 'text';
