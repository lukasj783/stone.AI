import React, { useRef, useEffect } from 'react';
import type { TimelineElement } from '@/lib/types/layers.types';
import { seekMedia } from './mediaUtils';

export function DynamicVideoPlayer({ element, isPlaying, currentTime }: { element: TimelineElement, isPlaying: boolean, currentTime: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    const targetTime = (currentTime - element.startTime) * element.speed + element.trimStart;
    
    if (isPlaying) {
      if (Math.abs(video.currentTime - targetTime) > 0.2) {
        seekMedia(video, targetTime);
      }
      if (video.paused) {
        video.play().catch(() => {});
      }
    } else {
      video.pause();
      if (Math.abs(video.currentTime - targetTime) > 0.05) {
        seekMedia(video, targetTime);
      }
    }
  }, [currentTime, isPlaying, element]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = element.volume / 100;
    video.playbackRate = element.speed;
  }, [element.volume, element.speed]);

  return (
    <video
      ref={videoRef}
      src={element.assetUrl}
      className="absolute inset-0 w-full h-full object-cover"
      style={{ opacity: element.opacity / 100 }}
      preload="auto"
      muted={element.volume === 0}
    />
  );
}
