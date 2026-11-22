"use client";

import { useCallback, useState, useSyncExternalStore } from 'react';
import { DEFAULT_STORYBOARD_MODEL } from '@/components/studio/workspace/StoryboardModelPicker';

const CHANGE_EVENT = 'character-sheet-model-change';
const sheetKey = (projectId: string) => `character-sheet-model:${projectId}`;
const storyboardKey = (projectId: string) => `storyboard-model:${projectId}`;

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function readSaved(projectId: string | null): string | null {
  if (!projectId) return null;
  try {
    return window.localStorage.getItem(sheetKey(projectId)) ?? window.localStorage.getItem(storyboardKey(projectId));
  } catch {
    return null;
  }
}

/**
 * The WaveSpeed model that draws character sheets for a project. It starts from the
 * project's storyboard model, so characters and shots come from the same model, and
 * remembers its own choice once changed (per browser).
 */
export function useSheetModel(projectId: string | null) {
  const saved = useSyncExternalStore(subscribe, () => readSaved(projectId), () => null);
  // Holds the choice when browser storage is unavailable, so the dropdown still works.
  const [unsaved, setUnsaved] = useState<{ projectId: string | null; model: string } | null>(null);
  const model = (unsaved?.projectId === projectId ? unsaved.model : null) ?? saved ?? DEFAULT_STORYBOARD_MODEL;

  const setModel = useCallback((modelId: string) => {
    setUnsaved({ projectId, model: modelId });
    if (!projectId) return;
    try {
      window.localStorage.setItem(sheetKey(projectId), modelId);
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch { /* storage unavailable: the in-memory choice above still applies */ }
  }, [projectId]);

  return [model, setModel] as const;
}
