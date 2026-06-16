import { Video, Music, Type, ImageIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export const TRACK_ICON_MAP: Record<string, LucideIcon> = {
  video: Video,
  audio: Music,
  text: Type,
  image: ImageIcon,
  caption: Type,
};

export const TRACK_COLOR_MAP: Record<string, string> = {
  video: 'text-blue-500',
  audio: 'text-emerald-500',
  text: 'text-yellow-500',
  image: 'text-purple-500',
  caption: 'text-pink-500',
};
