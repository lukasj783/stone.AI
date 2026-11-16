import type { VisualStyle } from '@/lib/types/image-generation';

export interface VisualStyleOption {
  label: VisualStyle;
  description: string;
  emoji: string;
}

export const VISUAL_STYLES: VisualStyleOption[] = [
  { label: 'Realistic', description: 'Photorealistic live action', emoji: '🎬' },
  { label: 'Anime', description: 'Cel-shaded Japanese animation', emoji: '🌸' },
  { label: '3D', description: 'Stylized 3D animated film', emoji: '🧊' },
  { label: 'Pixel', description: 'Detailed pixel art', emoji: '🕹️' },
  { label: 'Cartoon', description: 'Bold 2D illustration', emoji: '✏️' },
];

export const DEFAULT_VISUAL_STYLE: VisualStyle = 'Realistic';

export function normalizeVisualStyle(value: unknown): VisualStyle {
  return VISUAL_STYLES.some((style) => style.label === value)
    ? value as VisualStyle
    : DEFAULT_VISUAL_STYLE;
}
