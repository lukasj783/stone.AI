import React, { useRef, useEffect } from 'react';
import type { TimelineElement } from '@/lib/types/layers.types';
import { seekMedia } from './mediaUtils';

export function DynamicAudioPlayer({ element, isPlaying, currentTime }: { element: TimelineElement, isPlaying: boolean, currentTime: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    
    const targetTime = (currentTime - element.startTime) * element.speed + element.trimStart;
    
    if (isPlaying) {
      if (Math.abs(audio.currentTime - targetTime) > 0.2) {
        seekMedia(audio, targetTime);
      }
      if (audio.paused) {
        audio.play().catch(() => {});
      }
    } else {
      audio.pause();
      if (Math.abs(audio.currentTime - targetTime) > 0.05) {
        seekMedia(audio, targetTime);
      }
    }
  }, [currentTime, isPlaying, element]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = element.volume / 100;
    audio.playbackRate = element.speed;
  }, [element.volume, element.speed]);

  return (
    <audio
      ref={audioRef}
      src={element.assetUrl}
      preload="auto"
      muted={element.volume === 0}
      className="hidden"
    />
  );
}
