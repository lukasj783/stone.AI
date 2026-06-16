import { useState, useCallback } from 'react';
import { TimelineState, TimelineElement, } from '@/lib/types/layers.types';
import { INITIAL_TIMELINE_STATE } from '@/lib/types/layers.types';
import { generateId } from './utils';
import { isFinitePositiveNumber } from './mediaUtils';
import { UploadedAsset } from './types';

export function useTimeline() {
  const [tl, setTl] = useState<TimelineState>(INITIAL_TIMELINE_STATE);
  const [history, setHistory] = useState<TimelineState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const pushHistory = useCallback((state: TimelineState) => {
    setHistory((prev) => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(state);
      if (newHistory.length > 50) newHistory.shift(); // Bound history to 50
      return newHistory;
    });
    setHistoryIndex((prev) => Math.min(prev + 1, 49));
  }, [historyIndex]);

  const recalcDuration = (state: TimelineState): TimelineState => {
    const MIN_DURATION = 60;
    let maxEnd = MIN_DURATION;
    for (const track of state.tracks) {
      for (const el of track.elements) {
        const end = el.startTime + el.duration;
        if (end > maxEnd) maxEnd = end;
      }
    }
    const newDuration = Math.max(MIN_DURATION, Math.ceil((maxEnd + 10) / 10) * 10);
    return { ...state, totalDuration: newDuration };
  };

  const updateTl = useCallback((updater: (prev: TimelineState) => TimelineState) => {
    setTl((prev) => {
      pushHistory(prev);
      const updated = updater(prev);
      return recalcDuration(updated);
    });
  }, [pushHistory]);

  const undo = useCallback(() => {
    if (historyIndex < 0) return;
    const prevState = history[historyIndex];
    setTl(prevState);
    setHistoryIndex((prev) => prev - 1);
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex + 1 >= history.length) return;
    const nextState = history[historyIndex + 1];
    setTl(nextState);
    setHistoryIndex((prev) => prev + 1);
  }, [history, historyIndex]);

  const addElementToTrack = useCallback((trackId: string, asset: UploadedAsset, startTime?: number) => {
    updateTl((prev) => ({
      ...prev,
      tracks: prev.tracks.map((track) => {
        if (track.id !== trackId) return track;
        const usedEnd = track.elements.reduce((max, el) => Math.max(max, el.startTime + el.duration), 0);
        const pos = startTime ?? usedEnd;
        const newElement: TimelineElement = {
          id: generateId(),
          assetId: asset.id,
          assetUrl: asset.url,
          assetName: asset.name,
          assetType: asset.type,
          sourceDuration: isFinitePositiveNumber(asset.duration) ? asset.duration : undefined,
          startTime: pos,
          duration: asset.duration ?? (asset.type === 'audio' ? 10 : 5),
          trimStart: 0,
          trimEnd: 0,
          volume: 100,
          speed: 1,
          fadeIn: 0,
          fadeOut: 0,
          opacity: 100,
          locked: false,
          textContent: asset.textContent,
        };
        return { ...track, elements: [...track.elements, newElement] };
      }),
    }));
  }, [updateTl]);

  const removeElement = useCallback((elementId: string) => {
    updateTl((prev) => ({
      ...prev,
      tracks: prev.tracks.map((track) => ({
        ...track,
        elements: track.elements.filter((el) => el.id !== elementId),
      })),
      selectedElementId: prev.selectedElementId === elementId ? null : prev.selectedElementId,
    }));
  }, [updateTl]);

  const splitElement = useCallback((elementId: string) => {
    updateTl((prev) => {
      const newTracks = prev.tracks.map((track) => {
        const elIndex = track.elements.findIndex((el) => el.id === elementId);
        if (elIndex === -1) return track;
        const el = track.elements[elIndex];
        const splitPoint = prev.currentTime;
        if (splitPoint <= el.startTime || splitPoint >= el.startTime + el.duration) return track;
        const first = { ...el, id: generateId(), duration: splitPoint - el.startTime };
        const second = { ...el, id: generateId(), startTime: splitPoint, duration: el.startTime + el.duration - splitPoint, trimStart: 0 };
        const newElements = [...track.elements];
        newElements.splice(elIndex, 1, first, second);
        return { ...track, elements: newElements };
      });
      return { ...prev, tracks: newTracks };
    });
  }, [updateTl]);

  const updateElement = useCallback((elementId: string, updates: Partial<TimelineElement>) => {
    updateTl((prev) => ({
      ...prev,
      tracks: prev.tracks.map((track) => ({
        ...track,
        elements: track.elements.map((el) =>
          el.id === elementId ? { ...el, ...updates } : el
        ),
      })),
    }));
  }, [updateTl]);

  const setTimelineState = (newState: TimelineState) => setTl(newState);

  return {
    tl,
    setTl,
    historyIndex,
    undo,
    redo,
    addElementToTrack,
    removeElement,
    splitElement,
    updateElement,
    updateTl,
    setTimelineState
  };
}
