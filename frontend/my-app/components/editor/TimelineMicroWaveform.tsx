"use client";

import React, { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';

interface TimelineMicroWaveformProps {
  url: string;
  duration: number;
}

export function TimelineMicroWaveform({ url }: TimelineMicroWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const fallbackBars = Array.from({ length: 72 }, (_, i) => {
    const seed = (i * 1103515245 + 12345) >>> 0;
    return 18 + (seed % 72);
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: 'rgba(52, 211, 153, 0.4)', // emerald-400 with opacity
      progressColor: 'rgba(52, 211, 153, 0.4)', // keep static color
      cursorWidth: 0,
      barWidth: 1,
      barGap: 1,
      height: 48,
      interact: false,
      url: url,
    });

    wavesurferRef.current = ws;

    return () => {
      ws.destroy();
    };
  }, [url]);

  return (
    <div className="absolute inset-0 pointer-events-none opacity-60">
      <div className="absolute inset-0 flex items-center gap-px px-1">
        {fallbackBars.map((height, index) => (
          <div
            key={index}
            className="flex-1 rounded-full bg-emerald-400/30"
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
      <div ref={containerRef} className="relative z-10 w-full h-full" />
    </div>
  );
}
