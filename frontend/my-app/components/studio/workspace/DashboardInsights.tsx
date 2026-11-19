"use client";

import { useState } from 'react';
import type { JSX } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { retryFailedShotVideos } from '@/lib/api/video-generation';
import { formatSeconds, PACING_OPTIONS, RUNTIME_TOLERANCE, runtimeDrift } from '@/lib/duration';
import type { ProjectProgress } from '@/lib/projectProgress';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// ---------------------------------------------------------------------------
// Runtime: chosen target vs. what the script, shots and renders add up to
// ---------------------------------------------------------------------------

function driftTone(drift: number | null): string {
  if (drift == null) return 'text-zinc-300';
  const size = Math.abs(drift);
  if (size <= RUNTIME_TOLERANCE) return 'text-emerald-300';
  if (size <= RUNTIME_TOLERANCE * 3) return 'text-amber-300';
  return 'text-red-300';
}

function RuntimeRow({ label, seconds, target }: { label: string; seconds: number | null; target: number | null }) {
  const drift = runtimeDrift(target, seconds);
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-zinc-500">{label}</span>
      {seconds == null ? (
        <span className="text-xs text-zinc-600">Not yet</span>
      ) : (
        <span className={cn('font-mono', driftTone(drift))}>
          {formatSeconds(seconds)}
          {drift != null && (
            <span className="ml-1.5 text-xs">
              ({drift >= 0 ? '+' : ''}
              {Math.round(drift * 100)}%)
            </span>
          )}
        </span>
      )}
    </div>
  );
}

export function RuntimeCard({
  progress,
  onNavigate,
}: {
  progress: ProjectProgress | null;
  onNavigate: (view: string) => void;
}): JSX.Element {
  const runtime = progress?.runtime;
  const pacing = PACING_OPTIONS.find((option) => option.id === runtime?.pacing);
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
          <Clock3 className="h-4 w-4 text-cyan-400" />
          Runtime
        </h2>
        {pacing && (
          <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-xs font-semibold text-cyan-200">
            {pacing.label} pacing
          </span>
        )}
      </div>
      {!runtime ? (
        <div className="h-28 animate-pulse rounded-lg bg-zinc-900" />
      ) : !runtime.targetSeconds ? (
        <p className="text-sm text-zinc-500">
          No target runtime set.{' '}
          <button type="button" onClick={() => onNavigate('idea')} className="font-semibold text-violet-400 hover:text-violet-300">
            Set it on the Idea page
          </button>
        </p>
      ) : (
        <>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-sm text-zinc-500">Target</span>
            <span className="font-mono text-2xl font-bold text-zinc-100">{formatSeconds(runtime.targetSeconds)}</span>
          </div>
          <div className="divide-y divide-zinc-800/80 border-t border-zinc-800/80">
            <RuntimeRow label="Script plan" seconds={runtime.scriptSeconds} target={runtime.targetSeconds} />
            <RuntimeRow label="Shots planned" seconds={runtime.shotSeconds} target={runtime.targetSeconds} />
            <RuntimeRow label="Rendered video" seconds={runtime.renderedSeconds} target={runtime.targetSeconds} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Needs attention: running work and failures, with retry
// ---------------------------------------------------------------------------

const RUNNING_LABELS: Record<string, [string, string]> = {
  storyboard: ['storyboard', 'generating'],
  video: ['shot video', 'rendering'],
  character: ['character image', 'generating'],
  environment: ['location image', 'generating'],
  prop: ['object image', 'generating'],
  image: ['image', 'generating'],
};

interface AttentionItemProps {
  tone: 'running' | 'failed';
  title: string;
  detail?: string | null;
  action?: { label: string; onClick: () => void | Promise<void>; external?: boolean };
}

function AttentionItem({ tone, title, detail, action }: AttentionItemProps) {
  const [isBusy, setIsBusy] = useState(false);
  return (
    <li className="flex items-start gap-3 py-2.5">
      {tone === 'running' ? (
        <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-400" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-zinc-200">{title}</p>
        {detail && (
          <p className="truncate text-xs text-zinc-500" title={detail}>
            {detail}
          </p>
        )}
      </div>
      {action && (
        <button
          type="button"
          disabled={isBusy}
          onClick={async () => {
            setIsBusy(true);
            try {
              await action.onClick();
            } finally {
              setIsBusy(false);
            }
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          {action.external ? <ExternalLink className="h-3 w-3" /> : <RefreshCw className={cn('h-3 w-3', isBusy && 'animate-spin')} />}
          {action.label}
        </button>
      )}
    </li>
  );
}

export function AttentionCard({
  progress,
  projectId,
  onNavigate,
  onOpenStoryboard,
  onChanged,
}: {
  progress: ProjectProgress | null;
  projectId: string | null;
  onNavigate: (view: string) => void;
  onOpenStoryboard?: (sceneId: string) => void;
  /** Called after a retry was queued, to reload progress. */
  onChanged: () => void | Promise<void>;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);

  const run = (task: () => Promise<unknown>) => async () => {
    setError(null);
    try {
      await task();
      await onChanged();
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : 'Retry failed.');
    }
  };

  const items: (AttentionItemProps & { key: string })[] = [];
  if (progress && projectId) {
    for (const [kind, count] of Object.entries(progress.activeJobs)) {
      const [noun, verb] = RUNNING_LABELS[kind] ?? [`${kind} job`, 'running'];
      items.push({ key: `running-${kind}`, tone: 'running', title: `${count} ${noun}${count === 1 ? '' : 's'} ${verb}` });
    }
    const { failures } = progress;
    if (failures.scenes.length) {
      items.push({
        key: 'failed-scenes',
        tone: 'failed',
        title: `${failures.scenes.length} scene${failures.scenes.length === 1 ? '' : 's'} failed to write`,
        detail: failures.scenes.map((scene) => scene.title).slice(0, 3).join(', '),
        action: {
          label: 'Retry',
          onClick: run(async () => {
            const response = await fetch(`${API_URL}/api/story/rewrite-incomplete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ project_id: projectId }),
            });
            if (!response.ok) {
              const body = (await response.json().catch(() => null)) as { detail?: string } | null;
              throw new Error(body?.detail || 'Could not restart the failed scenes.');
            }
          }),
        },
      });
    }
    for (const failed of failures.storyboards.slice(0, 3)) {
      items.push({
        key: `failed-storyboard-${failed.sceneId}`,
        tone: 'failed',
        title: `Storyboard failed: ${failed.title}`,
        detail: failed.error,
        action: onOpenStoryboard
          ? { label: 'Open', external: true, onClick: () => onOpenStoryboard(failed.sceneId) }
          : undefined,
      });
    }
    if (failures.storyboards.length > 3) {
      items.push({
        key: 'failed-storyboard-more',
        tone: 'failed',
        title: `${failures.storyboards.length - 3} more storyboards failed`,
        action: { label: 'Open', external: true, onClick: () => onNavigate('scenes') },
      });
    }
    if (failures.videos.count) {
      const batchId = failures.videos.batchId;
      items.push({
        key: 'failed-videos',
        tone: 'failed',
        title: `${failures.videos.count} shot video${failures.videos.count === 1 ? '' : 's'} failed`,
        detail: failures.videos.error,
        action: batchId
          ? { label: 'Retry', onClick: run(() => retryFailedShotVideos(projectId, batchId)) }
          : { label: 'Open', external: true, onClick: () => onNavigate('shot_list') },
      });
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 md:col-span-2">
      <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-zinc-100">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
        Needs Attention
      </h2>
      {!progress ? (
        <div className="h-28 animate-pulse rounded-lg bg-zinc-900" />
      ) : items.length === 0 ? (
        <p className="flex items-center gap-2 py-3 text-sm text-zinc-500">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          Nothing running and no failures.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-800/80">
          {items.map(({ key, ...item }) => (
            <AttentionItem key={key} {...item} />
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
