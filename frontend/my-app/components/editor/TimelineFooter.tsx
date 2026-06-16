import React, { useMemo, useRef, useCallback } from 'react';
import Image from 'next/image';
import {
  SkipBack, SkipForward, Pause, Play, Scissors,
  ZoomOut, ZoomIn, EyeOff, Volume2, Lock, Unlock, Plus, X, Video,
  MousePointer2, Magnet, Copy, Trash2, Bookmark
} from 'lucide-react';
import { TimelineState, TimelineElement, TimelineTool } from '@/lib/types/layers.types';
import { formatTime, TRACK_ICON_MAP, TRACK_COLOR_MAP } from './utils';
import { TimelineMicroWaveform } from './TimelineMicroWaveform';
import { VideoTimelineFilmstrip } from './VideoTimelineFilmstrip';

export interface TimelineFooterProps {
  tl: TimelineState;
  setTl: React.Dispatch<React.SetStateAction<TimelineState>>;
  seekToStart: () => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  splitElement: (elementId: string) => void;
  zoomOut: () => void;
  zoomIn: () => void;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackLock: (trackId: string) => void;
  handleTimelineDrop: (e: React.DragEvent, trackId: string) => void;
  updateElement: (elementId: string, updates: Partial<TimelineElement>) => void;
  removeElement: (elementId: string) => void;
  moveElementToTrack: (elementId: string, fromTrackId: string, toTrackId: string, newStartTime: number) => void;
  duplicateElement: (elementId: string) => void;
}

export function TimelineFooter({
  tl,
  setTl,
  seekToStart,
  togglePlay,
  seek,
  splitElement,
  zoomOut,
  zoomIn,
  toggleTrackMute,
  toggleTrackLock,
  handleTimelineDrop,
  updateElement,
  removeElement,
  moveElementToTrack,
  duplicateElement,
}: TimelineFooterProps) {
  const rulerTicks = useMemo(() => {
    const count = Math.ceil(tl.totalDuration / 10);
    return Array.from({ length: count + 1 }, (_, i) => i * 10);
  }, [tl.totalDuration]);

  const timelineContentWidth = useMemo(() => tl.totalDuration * tl.zoomLevel, [tl.totalDuration, tl.zoomLevel]);
  const playheadLeft = useMemo(() => tl.currentTime * tl.zoomLevel, [tl.currentTime, tl.zoomLevel]);

  // ─── High-Performance Seek / Scrub ─────────────────────────────────────────
  const playheadRef = useRef<HTMLDivElement>(null);
  const rulerPlayheadRef = useRef<HTMLDivElement>(null);
  const timelineContentRef = useRef<HTMLDivElement>(null);
  const tracksScrollRef = useRef<HTMLDivElement>(null);
  const rulerContentRef = useRef<HTMLDivElement>(null);
  const isScrubbingRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, scrollLeft: 0 });
  const rafIdRef = useRef<number | null>(null);
  const lastSeekTimeRef = useRef<number>(0);

  // ─── Scroll Sync & Auto-Scroll ─────────────────────────────────────────────
  // Sync ruler scrollLeft with tracks scrollLeft
  const handleTracksScroll = useCallback(() => {
    if (rulerContentRef.current && tracksScrollRef.current) {
      rulerContentRef.current.style.transform = `translateX(-${tracksScrollRef.current.scrollLeft}px)`;
    }
  }, []);

  // Mouse wheel horizontal scroll on tracks area
  const handleTracksWheel = useCallback((e: React.WheelEvent) => {
    if (!tracksScrollRef.current) return;
    // Shift+wheel or trackpad horizontal swipe → horizontal scroll
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    tracksScrollRef.current.scrollBy({ left: delta * 2, behavior: 'auto' });
  }, []);

  // Auto-scroll during playback
  React.useEffect(() => {
    if (!tl.isPlaying || !tracksScrollRef.current) return;
    const container = tracksScrollRef.current;
    const playheadPx = tl.currentTime * tl.zoomLevel;
    const visibleWidth = container.clientWidth;
    const scrollLeft = container.scrollLeft;
    const marginPx = visibleWidth * 0.2;

    if (playheadPx > scrollLeft + visibleWidth - marginPx || playheadPx < scrollLeft) {
      container.scrollLeft = playheadPx - marginPx;
      if (rulerContentRef.current) {
        rulerContentRef.current.style.transform = `translateX(-${container.scrollLeft}px)`;
      }
    }
  }, [tl.currentTime, tl.isPlaying, tl.zoomLevel]);

  // ─── Hand Tool / Middle-Mouse Panning ──────────────────────────────────────
  const handlePanStart = useCallback((e: React.MouseEvent | MouseEvent, isMiddleMouse = false) => {
    if (!tracksScrollRef.current) return;
    // Only pan if hand tool is active or middle mouse button
    if (!isMiddleMouse && tl.activeTool !== 'hand') return;
    if (isMiddleMouse && e.button !== 1) return;
    if (!isMiddleMouse && e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();
    isPanningRef.current = true;
    panStartRef.current = { x: e.clientX, scrollLeft: tracksScrollRef.current.scrollLeft };

    const cursorTarget = (e.currentTarget as HTMLElement);
    if (cursorTarget) cursorTarget.style.cursor = 'grabbing';

    const onMove = (me: MouseEvent) => {
      if (!isPanningRef.current || !tracksScrollRef.current) return;
      const dx = me.clientX - panStartRef.current.x;
      tracksScrollRef.current.scrollLeft = panStartRef.current.scrollLeft - dx;
      if (rulerContentRef.current) {
        rulerContentRef.current.style.transform = `translateX(-${tracksScrollRef.current.scrollLeft}px)`;
      }
    };

    const onUp = () => {
      isPanningRef.current = false;
      if (cursorTarget) cursorTarget.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [tl.activeTool]);

  // Convert a mouse clientX to a timeline time value
  const clientXToTime = useCallback((clientX: number): number => {
    if (!timelineContentRef.current) return 0;
    const rect = timelineContentRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const time = Math.max(0, Math.min(x / tl.zoomLevel, tl.totalDuration));
    return time;
  }, [tl.zoomLevel, tl.totalDuration]);

  // Instantly move playhead DOM elements (bypass React render) for 60fps scrubbing
  const movePlayheadDOM = useCallback((time: number) => {
    const px = time * tl.zoomLevel;
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translateX(${px}px)`;
    }
    if (rulerPlayheadRef.current) {
      rulerPlayheadRef.current.style.transform = `translateX(${px}px)`;
    }
  }, [tl.zoomLevel]);

  // Sync playhead DOM elements during playback
  React.useEffect(() => {
    movePlayheadDOM(tl.currentTime);
  }, [tl.currentTime, movePlayheadDOM]);

  // Throttled seek: updates React state at most every ~33ms (30fps) during scrub
  const throttledSeek = useCallback((time: number) => {
    const now = performance.now();
    if (now - lastSeekTimeRef.current >= 33) {
      lastSeekTimeRef.current = now;
      seek(time);
    }
  }, [seek]);

  // Main scrub handler: mousedown on ruler or track area
  const handleScrubMouseDown = useCallback((e: React.MouseEvent) => {
    // Only handle left click
    if (e.button !== 0) return;
    e.preventDefault();

    const targetTime = clientXToTime(e.clientX);

    // Immediately seek on click
    seek(targetTime);
    movePlayheadDOM(targetTime);
    isScrubbingRef.current = true;

    const onMove = (me: MouseEvent) => {
      if (!isScrubbingRef.current) return;

      const newTime = clientXToTime(me.clientX);

      // Move playhead DOM directly for instant visual feedback (bypasses React)
      movePlayheadDOM(newTime);

      // Throttle React state updates to ~30fps to avoid re-render overhead
      throttledSeek(newTime);
    };

    const onUp = (me: MouseEvent) => {
      isScrubbingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);

      // Final precise seek on mouse up
      const finalTime = clientXToTime(me.clientX);
      seek(finalTime);
      movePlayheadDOM(finalTime);

      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [clientXToTime, seek, movePlayheadDOM, throttledSeek]);

  // Playhead drag handler (dragging the playhead handle itself)
  const handlePlayheadMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isScrubbingRef.current = true;

    const onMove = (me: MouseEvent) => {
      if (!isScrubbingRef.current) return;

      const newTime = clientXToTime(me.clientX);

      // Move playhead DOM directly for instant visual feedback
      movePlayheadDOM(newTime);

      // Throttle React state updates
      throttledSeek(newTime);
    };

    const onUp = (me: MouseEvent) => {
      isScrubbingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);

      // Final precise seek
      const finalTime = clientXToTime(me.clientX);
      seek(finalTime);
      movePlayheadDOM(finalTime);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [clientXToTime, seek, movePlayheadDOM, throttledSeek]);

  return (
    <footer className="h-72 bg-[#121214] border-t border-zinc-800 flex flex-col shrink-0 z-10 w-full relative">
      {/* Timeline Toolbar — organized in rounded panels */}
      <div className="h-14 border-b border-zinc-800/80 flex items-center justify-between px-4 shrink-0 relative gap-3">
        
        {/* Time Display */}
        <div className="text-xs font-bold text-zinc-400 font-mono w-40 shrink-0">
          <span className="text-blue-500">{formatTime(tl.currentTime)}</span> / {formatTime(tl.totalDuration)}
        </div>

        {/* Tools Group — rounded panel */}
        <div className="flex items-center gap-1 bg-zinc-800/60 rounded-xl border border-zinc-700/40 px-1.5 py-1">
          <button
            className={`p-1.5 rounded-lg transition-colors ${tl.activeTool === 'select' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/60'}`}
            aria-label="Select tool"
            title="Select (V)"
            onClick={() => setTl((prev) => ({ ...prev, activeTool: 'select' as TimelineTool }))}
          >
            <MousePointer2 size={15} />
          </button>
          <button
            className={`p-1.5 rounded-lg transition-colors ${tl.activeTool === 'razor' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/60'}`}
            aria-label="Razor tool"
            title="Razor / Split (C)"
            onClick={() => setTl((prev) => ({ ...prev, activeTool: 'razor' as TimelineTool }))}
          >
            <Scissors size={15} />
          </button>
          <button
            className={`p-1.5 rounded-lg transition-colors ${tl.activeTool === 'hand' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/60'}`}
            aria-label="Hand tool"
            title="Hand / Pan (H)"
            onClick={() => setTl((prev) => ({ ...prev, activeTool: 'hand' as TimelineTool }))}
          >
            <SkipForward size={15} className="rotate-90" />
          </button>
          <div className="w-px h-5 bg-zinc-700/60 mx-0.5"></div>
          <button
            className={`p-1.5 rounded-lg transition-colors ${tl.snapEnabled ? 'bg-blue-600/30 text-blue-400' : 'text-zinc-500 hover:text-white hover:bg-zinc-700/60'}`}
            aria-label="Toggle snap"
            title="Snap to grid (N)"
            onClick={() => setTl((prev) => ({ ...prev, snapEnabled: !prev.snapEnabled }))}
          >
            <Magnet size={15} />
          </button>
          <div className="w-px h-5 bg-zinc-700/60 mx-0.5"></div>
          <button
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-700/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Duplicate clip"
            title="Duplicate (Ctrl+D)"
            disabled={!tl.selectedElementId}
            onClick={() => tl.selectedElementId && duplicateElement(tl.selectedElementId)}
          >
            <Copy size={15} />
          </button>
          <button
            className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Delete clip"
            title="Delete (Del)"
            disabled={!tl.selectedElementId}
            onClick={() => tl.selectedElementId && removeElement(tl.selectedElementId)}
          >
            <Trash2 size={15} />
          </button>
        </div>

        {/* Transport Group — rounded panel */}
        <div className="flex items-center gap-1 bg-zinc-800/60 rounded-xl border border-zinc-700/40 px-1.5 py-1">
          <button className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-700/60 transition-colors" aria-label="Go to start" onClick={seekToStart}>
            <SkipBack size={14} />
          </button>
          <button
            className="p-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-zinc-700/60 transition-colors"
            aria-label={tl.isPlaying ? 'Pause' : 'Play'}
            title="Play/Pause (Space)"
            onClick={togglePlay}
          >
            {tl.isPlaying ? <Pause size={18} /> : <Play size={18} className="fill-current" />}
          </button>
          <button className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-700/60 transition-colors" aria-label="Go to end" onClick={() => seek(tl.totalDuration)}>
            <SkipForward size={14} />
          </button>
          <div className="w-px h-5 bg-zinc-700/60 mx-0.5"></div>
          <button className="p-1.5 rounded-lg text-zinc-400 hover:text-yellow-400 hover:bg-yellow-900/20 transition-colors" aria-label="Add marker" title="Add Marker (M)">
            <Bookmark size={14} />
          </button>
        </div>

        {/* Zoom Group — rounded panel */}
        <div className="flex items-center gap-1 bg-zinc-800/60 rounded-xl border border-zinc-700/40 px-1.5 py-1">
          <button onClick={zoomOut} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-700/60 transition-colors" aria-label="Zoom out">
            <ZoomOut size={15} />
          </button>
          <input aria-label="Zoom timeline" type="range" min="0.1" max="1000" step="0.1"
            value={tl.zoomLevel}
            onChange={(e) => setTl((prev) => ({ ...prev, zoomLevel: Number(e.target.value) }))}
            className="w-20 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
          <button onClick={zoomIn} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-700/60 transition-colors" aria-label="Zoom in">
            <ZoomIn size={15} />
          </button>
          <span className="text-[10px] text-zinc-600 font-mono w-10">{tl.zoomLevel}px/s</span>
        </div>
      </div>

      {/* Tracks Viewer */}
      <div className="flex-1 relative flex flex-col overflow-hidden bg-[#18181b]/30">
        
        {/* Timeline Ruler — synced with tracks horizontal scroll */}
        <div
          className="h-6 w-full border-b border-zinc-800/50 relative shrink-0 overflow-hidden cursor-col-resize"
          style={{ paddingLeft: 64 }}
        >
          <div
            ref={rulerContentRef}
            className="flex relative h-full"
            style={{ width: timelineContentWidth, minWidth: '100%' }}
            onMouseDown={handleScrubMouseDown}
          >
            {rulerTicks.map((tick) => (
              <div
                key={tick}
                className="absolute top-0 h-full flex flex-col items-center text-[10px] text-zinc-600 font-bold font-mono"
                style={{ left: tick * tl.zoomLevel }}
              >
                <span>{tick}s</span>
                <div className="absolute bottom-0 w-px h-1.5 bg-zinc-700"></div>
              </div>
            ))}
            {/* Current playhead indicator on ruler — uses transform for performance */}
            <div
              ref={rulerPlayheadRef}
              className="absolute top-0 h-full w-px bg-red-500/60 z-20 pointer-events-none"
              style={{ transform: `translateX(${playheadLeft}px)` }}
            >
              <div className="w-2 h-2 bg-red-500 rounded-full -mt-0.5 -ml-0.5"></div>
            </div>
          </div>
        </div>

        {/* Tracks List — scroll container with synced scroll, wheel, and pan support */}
        <div
          ref={tracksScrollRef}
          className="flex-1 overflow-auto scrollbar-visible flex"
          onScroll={handleTracksScroll}
          onWheel={handleTracksWheel}
          onMouseDown={(e) => {
            // Middle-mouse button panning (any tool)
            if (e.button === 1) {
              e.preventDefault();
              handlePanStart(e, true);
            }
            // Hand tool panning on empty track area
            if (e.button === 0 && tl.activeTool === 'hand' && e.target === e.currentTarget) {
              handlePanStart(e, false);
            }
          }}
        >
          
          {/* Left Track Icons Fixed column */}
          <div className="w-16 shrink-0 border-r border-zinc-800 bg-[#121214] flex flex-col sticky left-0 z-20">
            {tl.tracks.map((track) => {
              const Icon = TRACK_ICON_MAP[track.type] || Video;
              return (
                <div key={track.id} className="h-16 w-full flex flex-col items-center justify-center gap-0.5 border-b border-zinc-800/50 relative group">
                  <Icon size={16} className={TRACK_COLOR_MAP[track.type] || 'text-zinc-400'} />
                  <span className="text-[8px] text-zinc-600 font-mono uppercase">{track.type}</span>
                  <div className="absolute right-0 top-0 bottom-0 flex flex-col items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 pr-1">
                    <button
                      onClick={() => toggleTrackMute(track.id)}
                      className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${track.muted ? 'bg-red-900/50 text-red-400' : 'bg-zinc-800 text-zinc-500'}`}
                      title={track.muted ? 'Unmute' : 'Mute'}
                    >
                      {track.muted ? <EyeOff size={8} /> : <Volume2 size={8} />}
                    </button>
                    <button
                      onClick={() => toggleTrackLock(track.id)}
                      className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${track.locked ? 'bg-yellow-900/50 text-yellow-400' : 'bg-zinc-800 text-zinc-500'}`}
                      title={track.locked ? 'Unlock' : 'Lock'}
                    >
                      {track.locked ? <Lock size={8} /> : <Unlock size={8} />}
                    </button>
                  </div>
                </div>
              );
            })}
            {/* Add track button */}
            <button
              className="h-10 w-full flex items-center justify-center text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900/50 transition-colors border-b border-zinc-800/50"
              aria-label="Add track"
              title="Add track"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* Track Content Timeline items — click empty area or drag to seek */}
          <div
            ref={timelineContentRef}
            className="flex-1 relative"
            style={{ minWidth: Math.max(800, timelineContentWidth) }}
            onMouseDown={handleScrubMouseDown}
          >
            {tl.tracks.map((track) => (
              <div
                key={track.id}
                data-track-id={track.id}
                className="h-16 border-b border-zinc-800/50 relative"
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('bg-blue-900/10'); }}
                onDragLeave={(e) => { e.currentTarget.classList.remove('bg-blue-900/10'); }}
                onDrop={(e) => { e.currentTarget.classList.remove('bg-blue-900/10'); handleTimelineDrop(e, track.id); }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) {
                    // Click on empty track area: seek + select track
                    const clickTime = clientXToTime(e.clientX);
                    seek(clickTime);
                    setTl((prev) => ({ ...prev, selectedTrackId: track.id, selectedElementId: null }));
                  }
                }}
              >
                {/* Element clips on this track */}
                {track.elements.map((el) => {
                  const left = el.startTime * tl.zoomLevel;
                  const width = el.duration * tl.zoomLevel;
                  const isSelected = tl.selectedElementId === el.id;
                  return (
                    <div
                      key={el.id}
                      className={`absolute top-1 h-12 rounded border transition-colors flex items-center px-2 overflow-hidden ${
                        tl.activeTool === 'razor' ? 'cursor-crosshair' : tl.activeTool === 'hand' ? 'cursor-grab' : 'cursor-pointer'
                      } ${
                        isSelected
                          ? 'bg-blue-600/30 border-blue-500 ring-1 ring-blue-400'
                          : 'bg-zinc-800 border-zinc-700 hover:border-zinc-500'
                      }`}
                      style={{ left, width: Math.max(20, width) }}
                      onClick={(e) => {
                        e.stopPropagation();
                        // Razor tool: split clip at click position
                        if (tl.activeTool === 'razor') {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const clickX = e.clientX - rect.left;
                          const splitTime = el.startTime + (clickX / (el.duration * tl.zoomLevel)) * el.duration;
                          if (splitTime > el.startTime + 0.1 && splitTime < el.startTime + el.duration - 0.1) {
                            splitElement(el.id);
                          }
                          return;
                        }
                        setTl((prev) => ({ ...prev, selectedElementId: el.id, selectedTrackId: track.id }));
                      }}
                      onMouseDown={(e) => {
                        // Only left click, not on trim handles
                        if (e.button !== 0) return;
                        if ((e.target as HTMLElement).closest('[data-trim-handle]')) return;
                        e.stopPropagation();
                        e.preventDefault();

                        // Select the clip
                        setTl((prev) => ({ ...prev, selectedElementId: el.id, selectedTrackId: track.id }));

                        // Don't reposition if track is locked
                        if (track.locked) return;

                        const startX = e.clientX;
                        const origStartTime = el.startTime;
                        const SNAP_THRESHOLD = 0.15; // seconds
                        let lastUpdateTime = 0;

                        const onMove = (me: MouseEvent) => {
                          const dx = (me.clientX - startX) / tl.zoomLevel;
                          let newStartTime = Math.max(0, origStartTime + dx);

                          // Snap to other clip boundaries if snapping is enabled
                          if (tl.snapEnabled) {
                            const elEnd = newStartTime + el.duration;
                            for (const t of tl.tracks) {
                              for (const other of t.elements) {
                                if (other.id === el.id) continue;
                                // Snap start to other clip's start
                                if (Math.abs(newStartTime - other.startTime) < SNAP_THRESHOLD) {
                                  newStartTime = other.startTime;
                                }
                                // Snap start to other clip's end
                                if (Math.abs(newStartTime - (other.startTime + other.duration)) < SNAP_THRESHOLD) {
                                  newStartTime = other.startTime + other.duration;
                                }
                                // Snap end to other clip's start
                                if (Math.abs(elEnd - other.startTime) < SNAP_THRESHOLD) {
                                  newStartTime = other.startTime - el.duration;
                                }
                                // Snap end to other clip's end
                                if (Math.abs(elEnd - (other.startTime + other.duration)) < SNAP_THRESHOLD) {
                                  newStartTime = other.startTime + other.duration - el.duration;
                                }
                              }
                            }
                            // Snap to zero
                            if (Math.abs(newStartTime) < SNAP_THRESHOLD) newStartTime = 0;
                          }

                          // Clamp: only prevent going before zero; timeline auto-expands past totalDuration
                          newStartTime = Math.max(0, newStartTime);

                          // Throttle updates to ~30fps
                          const now = performance.now();
                          if (now - lastUpdateTime >= 33) {
                            lastUpdateTime = now;
                            updateElement(el.id, { startTime: newStartTime });
                          }
                        };

                        const onUp = (me: MouseEvent) => {
                          window.removeEventListener('mousemove', onMove);
                          window.removeEventListener('mouseup', onUp);

                          // Final precise update
                          const dx = (me.clientX - startX) / tl.zoomLevel;
                          let finalStartTime = Math.max(0, origStartTime + dx);

                          // Apply snap one more time for final position
                          if (tl.snapEnabled) {
                            const elEnd = finalStartTime + el.duration;
                            for (const t of tl.tracks) {
                              for (const other of t.elements) {
                                if (other.id === el.id) continue;
                                if (Math.abs(finalStartTime - other.startTime) < SNAP_THRESHOLD) finalStartTime = other.startTime;
                                if (Math.abs(finalStartTime - (other.startTime + other.duration)) < SNAP_THRESHOLD) finalStartTime = other.startTime + other.duration;
                                if (Math.abs(elEnd - other.startTime) < SNAP_THRESHOLD) finalStartTime = other.startTime - el.duration;
                                if (Math.abs(elEnd - (other.startTime + other.duration)) < SNAP_THRESHOLD) finalStartTime = other.startTime + other.duration - el.duration;
                              }
                            }
                            if (Math.abs(finalStartTime) < SNAP_THRESHOLD) finalStartTime = 0;
                          }

                          finalStartTime = Math.max(0, finalStartTime);

                          // Check if dropped on a different track (cross-track move)
                          // Determine target track from mouse Y position
                          const trackEls = timelineContentRef.current?.querySelectorAll('[data-track-id]') as NodeListOf<HTMLElement>;
                          if (trackEls) {
                            for (const trackEl of trackEls) {
                              const rect = trackEl.getBoundingClientRect();
                              if (me.clientY >= rect.top && me.clientY <= rect.bottom) {
                                const targetTrackId = trackEl.dataset.trackId;
                                if (targetTrackId && targetTrackId !== track.id) {
                                  // Cross-track move
                                  moveElementToTrack(el.id, track.id, targetTrackId, finalStartTime);
                                  return; // Don't do same-track update
                                }
                              }
                            }
                          }

                          // Same-track update
                          updateElement(el.id, { startTime: finalStartTime });
                        };

                        window.addEventListener('mousemove', onMove);
                        window.addEventListener('mouseup', onUp);
                      }}
                    >
                      {/* Trim handle left */}
                      {width > 40 && (
                        <div
                          data-trim-handle="left"
                          className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-white/20 z-10 rounded-l"
                          draggable={false}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const startX = e.clientX;
                            const origStart = el.startTime;
                            const origDur = el.duration;
                            const onMove = (me: MouseEvent) => {
                              const dx = (me.clientX - startX) / tl.zoomLevel;
                              const newStart = Math.max(0, origStart + dx);
                              const newDur = Math.max(0.5, origDur - dx);
                              updateElement(el.id, { startTime: newStart, duration: newDur, trimStart: Math.max(0, el.trimStart + dx) });
                            };
                            const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                            window.addEventListener('mousemove', onMove);
                            window.addEventListener('mouseup', onUp);
                          }}
                        />
                      )}
                      {/* Visualizations (Background) */}
                      {el.assetType === 'audio' && (
                        <TimelineMicroWaveform url={el.assetUrl} duration={el.duration} />
                      )}
                      {el.assetType === 'video' && (
                        <VideoTimelineFilmstrip
                          url={el.assetUrl}
                          duration={el.duration}
                          trimStart={el.trimStart}
                          sourceDuration={el.sourceDuration}
                        />
                      )}
                      {el.assetType === 'image' && (
                        <Image
                          src={el.assetUrl}
                          alt={el.assetName}
                          fill
                          unoptimized
                          className="object-cover pointer-events-none rounded opacity-60"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      )}

                      {/* Clip content (Foreground Text) */}
                      <div className="flex-1 min-w-0 truncate text-[10px] font-bold text-white relative z-20 drop-shadow-md">
                        {el.assetName}
                      </div>
                      {/* Trim handle right */}
                      {width > 40 && (
                        <div
                          data-trim-handle="right"
                          className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-white/20 z-10 rounded-r"
                          draggable={false}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const startX = e.clientX;
                            const origDur = el.duration;
                            const onMove = (me: MouseEvent) => {
                              const dx = (me.clientX - startX) / tl.zoomLevel;
                              updateElement(el.id, { duration: Math.max(0.5, origDur + dx) });
                            };
                            const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                            window.addEventListener('mousemove', onMove);
                            window.addEventListener('mouseup', onUp);
                          }}
                        />
                      )}
                      {/* Remove button on selected */}
                      {isSelected && (
                        <button
                          onClick={(e) => { e.stopPropagation(); removeElement(el.id); }}
                          className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-red-600 flex items-center justify-center hover:bg-red-500 z-20"
                          aria-label="Remove clip"
                        >
                          <X size={10} className="text-white" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Playhead Marker — uses transform + direct DOM for 60fps scrub */}
            <div
              ref={playheadRef}
              className="absolute top-0 bottom-0 w-px bg-white z-30 cursor-col-resize"
              style={{ transform: `translateX(${playheadLeft}px)` }}
              onMouseDown={handlePlayheadMouseDown}
            >
              <div className="absolute -top-3 -left-1.5 w-3.5 h-4 bg-white rounded-xs shadow-md">
                <div className="w-0.5 h-2 bg-black/30 mx-auto mt-1"></div>
              </div>
            </div>

          </div>

        </div>

      </div>
    </footer>
  );
}
