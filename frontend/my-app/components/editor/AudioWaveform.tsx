"use client";

import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause } from 'lucide-react';

interface AudioWaveformProps {
  url: string;
}

export function AudioWaveform({ url }: AudioWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#4f46e5', // indigo-600
      progressColor: '#818cf8', // blue-400
      cursorColor: '#ffffff',
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      height: 40,
      url: url,
    });

    wavesurferRef.current = ws;

    ws.on('ready', () => {
      setIsReady(true);
    });

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => setIsPlaying(false));

    return () => {
      ws.destroy();
    };
  }, [url]);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation(); // prevent adding to timeline on click of play
    if (wavesurferRef.current && isReady) {
      wavesurferRef.current.playPause();
    }
  };

  return (
    <div className="flex items-center gap-3 w-full bg-zinc-950/50 p-2 rounded-lg border border-zinc-800">
      <button
        onClick={togglePlay}
        disabled={!isReady}
        className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 hover:bg-zinc-700 transition-colors border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? (
          <Pause size={12} className="text-white fill-white" />
        ) : (
          <Play size={12} className="text-white fill-white ml-0.5" />
        )}
      </button>
      <div 
        ref={containerRef} 
        className="flex-1 min-w-0 opacity-100 transition-opacity duration-300"
        style={{ opacity: isReady ? 1 : 0.5 }}
      />
    </div>
  );
}
