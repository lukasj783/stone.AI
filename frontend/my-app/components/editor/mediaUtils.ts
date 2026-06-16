import type { TimelineElement } from '@/lib/types/layers.types';

export const MAX_FILE_SIZE_MB = 100;
export const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
export const STORAGE_BUCKET = 'user-images';

export function seekMedia(media: HTMLMediaElement, time: number) {
  if (typeof media.fastSeek === 'function') {
    media.fastSeek(time);
  } else {
    media.currentTime = time;
  }
}

export function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function readLocalMediaDuration(file: File, assetType: 'video' | 'image' | 'audio'): Promise<number | undefined> {
  if (assetType !== 'video' && assetType !== 'audio') return Promise.resolve(undefined);

  return new Promise((resolve) => {
    const media = assetType === 'video' ? document.createElement('video') : document.createElement('audio');
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const cleanup = () => {
      media.removeAttribute('src');
      media.load();
      URL.revokeObjectURL(objectUrl);
      media.onloadedmetadata = null;
      media.onerror = null;
    };

    const finish = (duration?: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      cleanup();
      resolve(duration);
    };

    const timeoutId = window.setTimeout(() => finish(undefined), 5000);

    media.preload = 'metadata';
    media.onloadedmetadata = () => {
      const duration = media.duration;
      finish(isFinitePositiveNumber(duration) ? duration : undefined);
    };
    media.onerror = () => finish(undefined);
    media.src = objectUrl;
  });
}

export function clampMediaElementDuration(element: TimelineElement): TimelineElement {
  if (
    !isFinitePositiveNumber(element.sourceDuration) ||
    (element.assetType !== 'video' && element.assetType !== 'audio')
  ) {
    return element;
  }

  const playbackRate = isFinitePositiveNumber(element.speed) ? element.speed : 1;
  const remainingSourceDuration = Math.max(0, element.sourceDuration - element.trimStart);
  const maxTimelineDuration = remainingSourceDuration / playbackRate;

  if (element.duration <= maxTimelineDuration) return element;
  return { ...element, duration: maxTimelineDuration };
}

export function isTimelineElementActive(element: TimelineElement, currentTime: number) {
  return currentTime >= element.startTime && currentTime < element.startTime + element.duration;
}
