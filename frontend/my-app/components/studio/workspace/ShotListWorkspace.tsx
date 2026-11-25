"use client";

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import Image from 'next/image';
import {
  CheckCircle2, Clapperboard, Film, ListVideo, LoaderCircle,
  Play, Plus, RefreshCw, Send, Video, XCircle,
} from 'lucide-react';
import {
  addShotVideoToTimeline,
  getShotList,
  retryFailedShotVideos,
  type ShotListItem,
} from '@/lib/api/video-generation';
import { formatSeconds, RUNTIME_TOLERANCE, runtimeDrift } from '@/lib/duration';
import { ErrorBanner } from '@/components/ui/ErrorBanner';

type Filter = 'all' | 'complete' | 'rendering' | 'failed' | 'missing';

interface ShotListWorkspaceProps {
  projectId: string | null;
  onOpenStoryboard: (sceneId: string) => void;
  onOpenTimeline: () => void;
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All shots' },
  { id: 'complete', label: 'Complete' },
  { id: 'rendering', label: 'Rendering' },
  { id: 'failed', label: 'Failed' },
  { id: 'missing', label: 'No video' },
];

function isRendering(status: string): boolean {
  return status === 'queued' || status === 'in_progress' || status === 'running';
}

function statusClass(status: string): string {
  if (status === 'complete') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'failed') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (isRendering(status)) return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300';
  return 'border-zinc-700 bg-zinc-800/70 text-zinc-400';
}

interface Runtime {
  target: number | null;
  planned: number | null;
  rendered: number | null;
}

function RuntimeFigure({ label, seconds, target }: { label: string; seconds: number | null; target: number | null }): JSX.Element | null {
  if (seconds == null) return null;
  const drift = runtimeDrift(target, seconds);
  const tone = drift == null
    ? 'text-zinc-300'
    : Math.abs(drift) <= RUNTIME_TOLERANCE
      ? 'text-emerald-300'
      : Math.abs(drift) <= RUNTIME_TOLERANCE * 3
        ? 'text-amber-300'
        : 'text-red-300';
  return (
    <span className="text-zinc-500">
      {label} <span className={`font-mono font-semibold ${tone}`}>{formatSeconds(seconds)}</span>
      {drift != null && <span className={`ml-1 font-mono ${tone}`}>({drift >= 0 ? '+' : ''}{Math.round(drift * 100)}%)</span>}
    </span>
  );
}

function statusLabel(status: string): string {
  if (status === 'in_progress') return 'Rendering';
  if (status === 'missing') return 'No video';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function ShotListWorkspace({ projectId, onOpenStoryboard, onOpenTimeline }: ShotListWorkspaceProps): JSX.Element {
  const [shots, setShots] = useState<ShotListItem[]>([]);
  const [runtime, setRuntime] = useState<Runtime>({ target: null, planned: null, rendered: null });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isAddingToTimeline, setIsAddingToTimeline] = useState(false);
  const [error, setError] = useState<string | Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadShotList = async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const response = await getShotList(projectId);
      setShots(response.shots);
      setRuntime({
        target: response.target_seconds ?? null,
        planned: response.planned_seconds ?? null,
        rendered: response.rendered_seconds ?? null,
      });
      setSelectedId((current) => {
        if (current && response.shots.some((shot) => shot.shot_id === current)) return current;
        return response.shots.find((shot) => shot.video_url)?.shot_id ?? response.shots[0]?.shot_id ?? null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError : 'Failed to load Shot List.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setError(null);
    void loadShotList();
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !shots.some((shot) => isRendering(shot.status))) return;
    const interval = window.setInterval(() => void loadShotList(), 4000);
    return () => window.clearInterval(interval);
  }, [projectId, shots]);

  if (!projectId) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-500">Loading project...</div>;
  }

  const visibleShots = shots.filter((shot) => {
    if (filter === 'all') return true;
    if (filter === 'rendering') return isRendering(shot.status);
    return shot.status === filter;
  });
  const selected = shots.find((shot) => shot.shot_id === selectedId) ?? null;
  const completedCount = shots.filter((shot) => shot.status === 'complete').length;
  const renderingCount = shots.filter((shot) => isRendering(shot.status)).length;
  const failedCount = shots.filter((shot) => shot.status === 'failed').length;

  const retrySelected = async () => {
    if (!selected?.batch_id || !projectId) return;
    setIsRetrying(true);
    setError(null);
    setNotice(null);
    try {
      await retryFailedShotVideos(projectId, selected.batch_id);
      setNotice('Failed shots in this render batch were requeued.');
      await loadShotList();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError : 'Failed to retry the shot video.');
    } finally {
      setIsRetrying(false);
    }
  };

  const addSelectedToTimeline = async () => {
    if (!selected?.video_asset_id) return;
    setIsAddingToTimeline(true);
    setError(null);
    setNotice(null);
    try {
      const result = await addShotVideoToTimeline(projectId, selected.shot_id, selected.video_asset_id);
      setNotice(result.created ? 'Shot video added to the timeline.' : 'This shot video is already on the timeline.');
    } catch (timelineError) {
      setError(timelineError instanceof Error ? timelineError : 'Failed to add the shot video to the timeline.');
    } finally {
      setIsAddingToTimeline(false);
    }
  };

  return (
    <div className="h-full overflow-auto bg-[#0A0A0B] px-6 py-7 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <div className="flex items-center gap-2.5"><ListVideo className="h-5 w-5 text-cyan-400" /><h1 className="text-xl font-bold text-zinc-100">Shot List</h1></div>
            <p className="mt-1 text-sm text-zinc-500">Review storyboard coverage and generated video clips in screenplay order.</p>
          </div>
          <button type="button" onClick={() => void loadShotList()} disabled={isLoading} className="inline-flex h-9 items-center gap-2 border border-zinc-700 bg-zinc-900 px-3 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800/70 pb-4 text-xs">
          <span className="font-semibold text-zinc-300">{shots.length} shots</span>
          <span className="text-emerald-300">{completedCount} complete</span>
          {renderingCount > 0 && <span className="text-cyan-300">{renderingCount} rendering</span>}
          {failedCount > 0 && <span className="text-red-300">{failedCount} failed</span>}
          {runtime.target != null && <span className="text-zinc-500">Target <span className="font-mono font-semibold text-zinc-300">{formatSeconds(runtime.target)}</span></span>}
          <RuntimeFigure label="Planned" seconds={runtime.planned} target={runtime.target} />
          <RuntimeFigure label="Rendered" seconds={runtime.rendered} target={runtime.target} />
          <div className="ml-auto flex flex-wrap gap-1">
            {FILTERS.map((item) => <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={`h-7 px-2.5 font-medium ${filter === item.id ? 'bg-cyan-500/15 text-cyan-200' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'}`}>{item.label}</button>)}
          </div>
        </div>

        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        {notice && <div className="flex items-center gap-2 border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" />{notice}</div>}

        {isLoading && shots.length === 0 ? <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-zinc-500"><LoaderCircle className="h-5 w-5 animate-spin" />Loading shots...</div> : shots.length === 0 ? <div className="flex min-h-72 flex-col items-center justify-center border border-dashed border-zinc-800 text-center"><Film className="mb-3 h-8 w-8 text-zinc-700" /><h2 className="text-sm font-semibold text-zinc-300">No planned shots yet</h2><p className="mt-1 max-w-sm text-sm text-zinc-500">Generate storyboard images from a scene before reviewing production shots.</p></div> : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
            <div className="overflow-x-auto border border-zinc-800 bg-zinc-950">
              <table className="w-full min-w-220 text-left text-sm"><thead className="border-b border-zinc-800 bg-zinc-900/60 text-[10px] font-semibold uppercase tracking-wide text-zinc-500"><tr><th className="px-4 py-3">Shot</th><th className="px-4 py-3">Scene</th><th className="px-4 py-3">Description</th><th className="px-4 py-3">Camera</th><th className="px-4 py-3">Duration</th><th className="px-4 py-3 text-right">Video</th></tr></thead><tbody className="divide-y divide-zinc-800/80">{visibleShots.map((shot) => <tr key={shot.shot_id} onClick={() => { setSelectedId(shot.shot_id); setNotice(null); }} className={`cursor-pointer transition-colors hover:bg-zinc-900 ${selected?.shot_id === shot.shot_id ? 'bg-cyan-500/10' : ''}`}><td className="px-4 py-3 font-mono text-xs font-bold text-cyan-300">S{shot.scene_sort_order + 1}.{shot.shot_number ?? shot.sort_order + 1}</td><td className="max-w-44 truncate px-4 py-3 text-xs text-zinc-400">{shot.scene_slugline || 'Untitled scene'}</td><td className="max-w-72 truncate px-4 py-3 text-xs text-zinc-200">{shot.description || 'No description'}</td><td className="px-4 py-3 text-xs text-zinc-500"><div>{shot.camera_angle || 'Unspecified'}</div><div className="mt-0.5 text-zinc-600">{shot.camera_motion || 'Static'}</div></td><td className="px-4 py-3 font-mono text-xs text-zinc-500">{shot.duration_seconds ? `${shot.duration_seconds}s` : shot.planned_seconds ? <span className="text-zinc-600" title="Planned clip length">{shot.planned_seconds}s planned</span> : '---'}</td><td className="px-4 py-3 text-right"><span className={`inline-flex items-center gap-1 border px-2 py-1 text-[10px] font-semibold ${statusClass(shot.status)}`}>{isRendering(shot.status) && <RefreshCw className="h-3 w-3 animate-spin" />}{shot.status === 'complete' && <CheckCircle2 className="h-3 w-3" />}{shot.status === 'failed' && <XCircle className="h-3 w-3" />}{statusLabel(shot.status)}</span></td></tr>)}</tbody></table>
              {visibleShots.length === 0 && <div className="px-6 py-12 text-center text-sm text-zinc-500">No shots match this filter.</div>}
            </div>

            <aside className="border border-zinc-800 bg-zinc-950">
              {selected ? <div><div className="relative aspect-video border-b border-zinc-800 bg-zinc-900">{selected.video_url ? <video className="h-full w-full object-contain" controls preload="metadata" src={selected.video_url} /> : selected.storyboard_url ? <Image src={selected.storyboard_url} alt={`Storyboard shot ${selected.shot_number ?? selected.sort_order + 1}`} fill sizes="416px" unoptimized className="object-contain" /> : <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-600"><Video className="h-7 w-7" /><span className="text-xs">No storyboard asset</span></div>}</div><div className="space-y-4 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs font-bold text-cyan-300">Shot {selected.shot_number ?? selected.sort_order + 1}</p><h2 className="mt-1 text-base font-bold text-zinc-100">{selected.scene_slugline || 'Untitled scene'}</h2></div><span className={`border px-2 py-1 text-[10px] font-semibold ${statusClass(selected.status)}`}>{statusLabel(selected.status)}</span></div><p className="text-sm leading-6 text-zinc-300">{selected.description || 'No shot description available.'}</p><dl className="grid grid-cols-2 gap-3 border-y border-zinc-800 py-3 text-xs"><div><dt className="text-zinc-600">Camera</dt><dd className="mt-1 text-zinc-300">{selected.camera_angle || 'Unspecified'}</dd></div><div><dt className="text-zinc-600">Motion</dt><dd className="mt-1 text-zinc-300">{selected.camera_motion || 'Static'}</dd></div></dl>{selected.status === 'failed' && <p className="text-xs leading-5 text-red-300">{selected.error_message || 'The video render failed.'}</p>}<div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => onOpenStoryboard(selected.scene_id)} className="inline-flex h-9 items-center justify-center gap-2 border border-zinc-700 text-xs font-semibold text-zinc-200 hover:bg-zinc-900" title="Open the source storyboard"><Clapperboard className="h-3.5 w-3.5" />Storyboard</button>{selected.status === 'failed' ? <button type="button" onClick={() => void retrySelected()} disabled={!selected.batch_id || isRetrying} className="inline-flex h-9 items-center justify-center gap-2 border border-amber-500/40 text-xs font-semibold text-amber-200 hover:bg-amber-500/10 disabled:opacity-50" title="Retry failed shots in this render batch"><RefreshCw className={`h-3.5 w-3.5 ${isRetrying ? 'animate-spin' : ''}`} />Retry</button> : selected.video_url ? <button type="button" onClick={() => void addSelectedToTimeline()} disabled={isAddingToTimeline} className="inline-flex h-9 items-center justify-center gap-2 bg-cyan-600 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50" title="Add this video clip to the timeline"><Plus className="h-3.5 w-3.5" />Timeline</button> : <span className="flex h-9 items-center justify-center text-xs text-zinc-600">Video not ready</span>}</div>{selected.video_url && <button type="button" onClick={onOpenTimeline} className="flex h-9 w-full items-center justify-center gap-2 border border-zinc-700 text-xs font-semibold text-zinc-300 hover:bg-zinc-900"><Send className="h-3.5 w-3.5" />Open Timeline</button>}</div></div> : <div className="flex min-h-96 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-zinc-600"><ListVideo className="h-6 w-6" />Select a shot to inspect its production state.</div>}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}