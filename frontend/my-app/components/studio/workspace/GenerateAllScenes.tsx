"use client";

import { useEffect, useId, useRef, useState } from 'react';
import type { JSX } from 'react';
import { AlertTriangle, CheckCircle2, Layers, Loader2, RotateCcw, Square, X } from 'lucide-react';
import {
  getStoryboardBatchPreflight,
  isStoryboardBatchActive,
  type StoryboardBatch,
  type StoryboardBatchPreflight,
} from '@/lib/api/storyboard-batches';

function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

interface GenerateAllScenesDialogProps {
  projectId: string;
  modelLabel: string;
  isStarting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmation before a batch starts: what will be generated, what is skipped, and consistency warnings. */
export function GenerateAllScenesDialog({
  projectId,
  modelLabel,
  isStarting,
  onCancel,
  onConfirm,
}: GenerateAllScenesDialogProps): JSX.Element {
  const [preflight, setPreflight] = useState<StoryboardBatchPreflight | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    getStoryboardBatchPreflight(projectId)
      .then((result) => { if (!cancelled) setPreflight(result); })
      .catch((error) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Failed to check the scenes.'); });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    (preflight && preflight.scenes_to_generate > 0 ? confirmRef.current : cancelRef.current)?.focus();
  }, [preflight, loadError]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isStarting) onCancel();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isStarting, onCancel]);

  const nothingToDo = preflight !== null && preflight.scenes_to_generate === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold text-zinc-100">
            <Layers className="h-4 w-4 text-violet-400" aria-hidden />
            Generate All Scenes at Once
          </h2>
          <button type="button" onClick={onCancel} disabled={isStarting} aria-label="Close" className="text-zinc-500 hover:text-zinc-200 disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!preflight && !loadError && (
          <p className="mt-5 flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking the scenes...
          </p>
        )}
        {loadError && <p className="mt-5 text-sm text-red-300">{loadError}</p>}

        {preflight && (
          <div className="mt-4 space-y-4 text-sm">
            {nothingToDo ? (
              <p className="flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Every scene already has a finished storyboard.
              </p>
            ) : (
              <dl className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                  <dt className="text-[11px] text-zinc-500">Scenes to generate</dt>
                  <dd className="mt-1 text-xl font-bold text-zinc-100">{preflight.scenes_to_generate}</dd>
                  {preflight.scenes_skipped > 0 && (
                    <dd className="mt-0.5 text-[11px] text-zinc-500">{preflight.scenes_skipped} finished, skipped</dd>
                  )}
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                  <dt className="text-[11px] text-zinc-500">Images (about)</dt>
                  <dd className="mt-1 text-xl font-bold text-zinc-100">~{preflight.estimated_images}</dd>
                  <dd className="mt-0.5 truncate text-[11px] text-zinc-500">{modelLabel}</dd>
                </div>
              </dl>
            )}

            {!nothingToDo && preflight.characters_without_references.length > 0 && (
              <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p>
                  <span className="font-semibold">{preflight.characters_without_references.join(', ')}</span>{' '}
                  {preflight.characters_without_references.length === 1 ? 'has' : 'have'} no reference image yet, so their look
                  may change from scene to scene. Generate their images on the Characters page first for consistent results.
                </p>
              </div>
            )}

            {!nothingToDo && (
              <p className="text-xs leading-5 text-zinc-500">
                Scenes run in parallel in the background. Every frame uses the same character, location and prop reference images,
                so characters stay consistent across scenes. You can keep working or leave this page.
              </p>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={isStarting} className="h-9 rounded-lg border border-zinc-700 px-3 text-xs font-semibold text-zinc-300 hover:bg-zinc-900 disabled:opacity-50">
            {nothingToDo || loadError ? 'Close' : 'Cancel'}
          </button>
          {preflight && !nothingToDo && (
            <button ref={confirmRef} type="button" onClick={onConfirm} disabled={isStarting} className="flex h-9 items-center gap-2 rounded-lg bg-violet-600 px-4 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-50">
              {isStarting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {isStarting ? 'Starting...' : `Generate ${plural(preflight.scenes_to_generate, 'scene')}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface StoryboardBatchProgressProps {
  batch: StoryboardBatch;
  isBusy: boolean;
  onCancel: () => void;
  onRetryFailed: () => void;
  onDismiss: () => void;
}

/** Live progress of a "Generate All Scenes at Once" batch, with stop, retry and dismiss. */
export function StoryboardBatchProgress({ batch, isBusy, onCancel, onRetryFailed, onDismiss }: StoryboardBatchProgressProps): JSX.Element {
  const active = isStoryboardBatchActive(batch);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const startedAt = batch.created_at ? Date.parse(batch.created_at) : NaN;
  const endedAt = !active && batch.completed_at ? Date.parse(batch.completed_at) : now;
  const elapsed = Number.isFinite(startedAt) ? formatElapsed((endedAt - startedAt) / 1000) : null;

  const finishedImages = batch.completed_shots + batch.failed_shots;
  const imageTotal = Math.max(batch.total_shots, batch.estimated_images, finishedImages, 1);
  const percent = active ? Math.min(99, Math.round((finishedImages / imageTotal) * 100)) : 100;
  const doneScenes = batch.completed_scenes + batch.failed_scenes;
  const hasFailures = batch.failed_scenes > 0 || batch.failed_shots > 0;

  let headline: string;
  if (active) headline = 'Generating all scenes';
  else if (batch.status === 'cancelled') headline = 'Stopped';
  else if (!hasFailures) headline = `All ${plural(batch.total_scenes, 'scene')} generated`;
  else headline = `${batch.completed_scenes} of ${plural(batch.total_scenes, 'scene')} generated`;

  const tone = active
    ? 'border-violet-500/30 bg-violet-500/5'
    : hasFailures || batch.status === 'cancelled'
      ? 'border-amber-500/30 bg-amber-500/5'
      : 'border-emerald-500/30 bg-emerald-500/5';

  return (
    <section aria-label="Generate all scenes progress" className={`mb-5 rounded-xl border px-4 py-3 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            {active ? <Loader2 className="h-4 w-4 animate-spin text-violet-400" aria-hidden />
              : hasFailures || batch.status === 'cancelled' ? <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden />
                : <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />}
            {headline}
            {elapsed && <span className="font-mono text-xs font-medium text-zinc-500">{active ? elapsed : `in ${elapsed}`}</span>}
          </p>
          <p className="mt-1 text-xs text-zinc-400" aria-live="polite">
            {doneScenes}/{plural(batch.total_scenes, 'scene')} · {batch.completed_shots}/{active ? `~${imageTotal}` : batch.total_shots} images
            {batch.failed_shots > 0 && <span className="text-red-300"> · {plural(batch.failed_shots, 'image')} failed</span>}
            {batch.failed_scenes > 0 && batch.failed_shots === 0 && <span className="text-red-300"> · {plural(batch.failed_scenes, 'scene')} failed</span>}
          </p>
          {batch.error_message && (batch.status !== 'cancelled' || batch.error_message.includes('restarted')) && (
            <p className="mt-1 text-xs text-amber-200">{batch.error_message}</p>
          )}
          {active && batch.runner === 'local' && (
            <p className="mt-1 text-[11px] text-zinc-500">
              Running inside the backend because Redis isn&apos;t running. Don&apos;t restart the backend until it finishes.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {active && (
            <button type="button" onClick={onCancel} disabled={isBusy} className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700 px-3 text-xs font-semibold text-zinc-300 hover:bg-zinc-900 disabled:opacity-50">
              <Square className="h-3 w-3" aria-hidden /> Stop
            </button>
          )}
          {!active && hasFailures && (
            <button type="button" onClick={onRetryFailed} disabled={isBusy} className="flex h-8 items-center gap-1.5 rounded-lg bg-amber-500/90 px-3 text-xs font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-50">
              <RotateCcw className="h-3 w-3" aria-hidden /> Retry failed
            </button>
          )}
          {!active && (
            <button type="button" onClick={onDismiss} aria-label="Dismiss" className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-label="Images generated" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className={`h-full rounded-full transition-all duration-500 ${active ? 'bg-violet-500' : hasFailures ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}
