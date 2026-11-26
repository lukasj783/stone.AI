"use client";

import { useCallback, useEffect, useState } from 'react';
import {
  cancelStoryboardBatch,
  getActiveStoryboardBatch,
  getStoryboardBatch,
  isStoryboardBatchActive,
  retryFailedStoryboardBatch,
  startStoryboardBatch,
  type StoryboardBatch,
} from '@/lib/api/storyboard-batches';

const POLL_MS = 3000;

/**
 * The project's "Generate All Scenes at Once" batch: picks up a running one when the page loads
 * and checks its progress every few seconds until it ends.
 */
export function useStoryboardBatch(
  projectId: string | null,
  onError: (error: Error | string) => void,
  /** Called with every progress update, so the page can refresh what changed. */
  onUpdate?: (batch: StoryboardBatch) => void,
) {
  const [batch, setBatchState] = useState<StoryboardBatch | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const active = isStoryboardBatchActive(batch);
  const batchId = batch?.batch_id ?? null;
  const setBatch = useCallback((next: StoryboardBatch | null) => {
    setBatchState(next);
    if (next) onUpdate?.(next);
  }, [onUpdate]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    getActiveStoryboardBatch(projectId)
      .then((found) => { if (!cancelled) setBatch(found); })
      // No batch tables yet (migration not applied) just means no batch is running.
      .catch(() => { if (!cancelled) setBatch(null); });
    return () => {
      cancelled = true;
      setBatchState(null);
    };
  }, [projectId, setBatch]);

  useEffect(() => {
    if (!projectId || !batchId || !active) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      getStoryboardBatch(projectId, batchId)
        .then((next) => { if (!cancelled) setBatch(next); })
        .catch((error) => { if (!cancelled) onError(error instanceof Error ? error : 'Failed to refresh batch progress.'); });
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [projectId, batchId, active, onError, setBatch]);

  const run = useCallback(async (action: () => Promise<StoryboardBatch>, fallback: string) => {
    setIsBusy(true);
    try {
      setBatch(await action());
      return true;
    } catch (error) {
      onError(error instanceof Error ? error : fallback);
      return false;
    } finally {
      setIsBusy(false);
    }
  }, [onError, setBatch]);

  const start = useCallback(
    (model: string) => (projectId ? run(() => startStoryboardBatch(projectId, model), 'Failed to start generating all scenes.') : Promise.resolve(false)),
    [projectId, run],
  );
  const cancel = useCallback(
    () => (projectId && batchId ? run(() => cancelStoryboardBatch(projectId, batchId), 'Failed to stop the batch.') : Promise.resolve(false)),
    [projectId, batchId, run],
  );
  const retryFailed = useCallback(
    () => (projectId && batchId ? run(() => retryFailedStoryboardBatch(projectId, batchId), 'Failed to retry the failed scenes.') : Promise.resolve(false)),
    [projectId, batchId, run],
  );
  const dismiss = useCallback(() => setBatchState(null), []);

  return { batch, active, isBusy, start, cancel, retryFailed, dismiss };
}
