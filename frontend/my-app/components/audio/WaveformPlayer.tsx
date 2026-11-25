"use client";

import { useEffect, useId, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { AlertCircle, Download, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Only one player sounds at a time: starting one pauses the others. */
const PLAY_EVENT = 'genesis-audio:play';
const SEEK_STEP_SECONDS = 5;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export interface WaveformPlayerProps {
  /** A URL or data: URL. */
  src: string;
  /** What is playing, read out to screen readers on the play button. */
  label: string;
  /** File name for the download button; no button when omitted. */
  downloadName?: string;
  size?: 'lg' | 'sm';
  /** Don't fetch the audio until the first press of play (for long lists of samples). */
  lazy?: boolean;
  className?: string;
}

/** A scrubbable waveform with play/pause, elapsed/total time and an optional download. */
export function WaveformPlayer({ src, label, downloadName, size = 'sm', lazy = false, className }: WaveformPlayerProps) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<WaveSurfer | null>(null);
  const playOnReadyRef = useRef(false);
  const [isActive, setIsActive] = useState(!lazy);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const large = size === 'lg';

  useEffect(() => {
    // Callers key each player by its clip, so a new src always means a fresh component and fresh state.
    if (!containerRef.current || !isActive) return;
    const wave = WaveSurfer.create({
      container: containerRef.current,
      url: src,
      height: large ? 72 : 36,
      waveColor: '#3f3f46',
      progressColor: '#ad46ff',
      cursorColor: 'transparent',
      barWidth: large ? 3 : 2,
      barGap: large ? 2 : 1,
      barRadius: 2,
      normalize: true,
      dragToSeek: true,
    });
    waveRef.current = wave;
    const subscriptions = [
      wave.on('ready', (total) => {
        setDuration(total);
        setIsReady(true);
        if (playOnReadyRef.current) {
          playOnReadyRef.current = false;
          void wave.play().catch(() => setFailed(true));
        }
      }),
      wave.on('timeupdate', (current) => setTime(current)),
      wave.on('play', () => {
        setIsPlaying(true);
        window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: id }));
      }),
      wave.on('pause', () => setIsPlaying(false)),
      wave.on('finish', () => setIsPlaying(false)),
      wave.on('error', () => setFailed(true)),
    ];
    const pauseIfOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) wave.pause();
    };
    window.addEventListener(PLAY_EVENT, pauseIfOther);
    return () => {
      window.removeEventListener(PLAY_EVENT, pauseIfOther);
      subscriptions.forEach((unsubscribe) => unsubscribe());
      wave.destroy();
      waveRef.current = null;
    };
  }, [src, large, id, isActive]);

  const togglePlay = () => {
    if (!isActive) {
      playOnReadyRef.current = true;
      setIsActive(true);
      return;
    }
    void waveRef.current?.playPause().catch(() => setFailed(true));
  };
  const isLoading = isActive && !isReady;

  const seekBy = (delta: number) => {
    const wave = waveRef.current;
    if (!wave || !isReady) return;
    wave.setTime(Math.min(Math.max(wave.getCurrentTime() + delta, 0), wave.getDuration()));
  };

  if (failed) {
    return (
      <div role="alert" className={cn('flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300', className)}>
        <AlertCircle className="h-4 w-4 shrink-0" />
        This clip could not be played. Generate it again, or try another browser.
      </div>
    );
  }

  return (
    <div className={cn('flex items-center', large ? 'gap-4' : 'gap-3', className)}>
      <button
        type="button"
        onClick={togglePlay}
        disabled={isLoading}
        aria-label={`${isPlaying ? 'Pause' : 'Play'} ${label}`}
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105 disabled:bg-zinc-800 disabled:text-zinc-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-400',
          large ? 'h-14 w-14' : 'h-9 w-9',
        )}
      >
        {isPlaying
          ? <Pause className={large ? 'h-6 w-6' : 'h-4 w-4'} fill="currentColor" />
          : <Play className={cn(large ? 'h-6 w-6' : 'h-4 w-4', 'translate-x-px')} fill="currentColor" />}
      </button>

      <div className="min-w-0 flex-1">
        <div
          ref={containerRef}
          role="slider"
          tabIndex={isReady ? 0 : -1}
          aria-label={`Position in ${label}`}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') { event.preventDefault(); seekBy(SEEK_STEP_SECONDS); }
            if (event.key === 'ArrowLeft') { event.preventDefault(); seekBy(-SEEK_STEP_SECONDS); }
            if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); togglePlay(); }
          }}
          className={cn(
            'w-full cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-purple-400',
            isLoading && 'animate-pulse rounded-md bg-zinc-900',
            !isActive && 'flex items-center',
          )}
          style={{ minHeight: large ? 72 : 36 }}
        >
          {/* Before a lazy player loads: a flat line where the waveform will be. */}
          {!isActive && <span aria-hidden className="h-0.5 w-full rounded-full bg-zinc-800" />}
        </div>
      </div>

      <span className={cn('shrink-0 text-right font-medium tabular-nums text-zinc-400', large ? 'w-24 text-sm' : 'w-20 text-xs')}>
        {formatTime(time)} / {formatTime(duration)}
      </span>

      {downloadName && (
        <a
          href={src}
          download={downloadName}
          aria-label={`Download ${label}`}
          title="Download"
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full border border-zinc-800 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-400',
            large ? 'h-11 w-11' : 'h-9 w-9',
          )}
        >
          <Download className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}
