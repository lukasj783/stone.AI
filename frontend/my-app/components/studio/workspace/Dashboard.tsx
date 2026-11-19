"use client";

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Circle, CircleDashed, Clapperboard, FileText, FolderOpen, Image as ImageIcon,
  Lightbulb, LayoutGrid, ListVideo, Plus, RefreshCw, Scissors, Sparkles, UploadCloud,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  computeProjectProgress,
  loadProjectSnapshot,
  type NextActionIcon,
  type ProjectProgress,
} from '@/lib/projectProgress';
import { AttentionCard, RuntimeCard } from '@/components/studio/workspace/DashboardInsights';
import type { Project } from '@/lib/types/layers.types';
import { VideoTypeBadge } from '@/components/studio/projects/VideoTypeSelector';
import { getVideoTypeConfig, resolveVideoType } from '@/lib/studioVideoTypes';

interface DashboardProps {
  onNavigate: (view: string) => void;
  projectName?: string;
  /** Video type of the active project (Feature Film, Music Video, ...). */
  videoType?: string | null;
  projects?: Project[];
  activeProjectId?: string | null;
  onSelectProject?: (id: string) => void | Promise<void>;
  /** Open one scene in the storyboard view. */
  onOpenStoryboard?: (sceneId: string) => void;
}

const ACTION_ICONS: Record<NextActionIcon, { icon: typeof FileText; className: string }> = {
  idea: { icon: Lightbulb, className: 'bg-amber-600/20 text-amber-400' },
  script: { icon: FileText, className: 'bg-violet-600/20 text-violet-400' },
  assets: { icon: ImageIcon, className: 'bg-blue-600/20 text-blue-400' },
  storyboard: { icon: LayoutGrid, className: 'bg-emerald-600/20 text-emerald-400' },
  video: { icon: ListVideo, className: 'bg-cyan-600/20 text-cyan-400' },
  timeline: { icon: Scissors, className: 'bg-pink-600/20 text-pink-400' },
  export: { icon: UploadCloud, className: 'bg-zinc-600/30 text-zinc-300' },
};

// While anything is generating, re-read progress this often.
const LIVE_REFRESH_MS = 15000;

function useProjectProgress(projectId: string | null, isNarrative: boolean) {
  const [progress, setProgress] = useState<ProjectProgress | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) {
      setProgress(null);
      return;
    }
    setIsLoading(true);
    try {
      const snapshot = await loadProjectSnapshot(projectId);
      setProgress(computeProjectProgress(snapshot, isNarrative));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load project progress.');
    } finally {
      setIsLoading(false);
    }
  }, [projectId, isNarrative]);

  useEffect(() => {
    setProgress(null);
    void load();
  }, [load]);

  const isRunning = Boolean(progress?.stages.some((stage) => stage.isRunning));
  useEffect(() => {
    if (!isRunning) return;
    const interval = window.setInterval(() => void load(), LIVE_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [isRunning, load]);

  return { progress, isLoading, error, reload: load };
}

export function StudioDashboard({
  onNavigate,
  projectName = 'Untitled',
  videoType,
  projects = [],
  activeProjectId = null,
  onSelectProject,
  onOpenStoryboard,
}: DashboardProps) {
  const activeVideoType = getVideoTypeConfig(resolveVideoType(videoType ?? null));
  const otherProjects = projects.filter((project) => project.id !== activeProjectId).slice(0, 3);
  const { progress, isLoading, error, reload } = useProjectProgress(activeProjectId, activeVideoType.requiresOutline);
  const overall = progress?.overall ?? 0;

  return (
    // The studio page clips overflow, so the dashboard scrolls inside its own area.
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="p-8 max-w-5xl mx-auto w-full">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <VideoTypeBadge videoType={activeVideoType} className="mb-2" />
            <h1 className="text-3xl font-bold tracking-tight text-white mb-2">{projectName}</h1>
            <p className="text-zinc-400">
              {activeVideoType.requiresOutline
                ? 'Project Workspace · Idea → Outline → Script'
                : 'Project Workspace · Brief → Script'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate('projects')}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-700 px-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
            >
              <FolderOpen size={15} />
              All Projects
            </button>
            <button
              type="button"
              onClick={() => onNavigate('projects')}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-violet-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
            >
              <Plus size={15} />
              New Project
            </button>
          </div>
        </div>

        {otherProjects.length > 0 && (
          <div className="mb-10">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
                MY Projects
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('projects')}
                className="text-xs font-semibold text-violet-400 transition-colors hover:text-violet-300"
              >
                View all
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {otherProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    void onSelectProject?.(project.id);
                    onNavigate('dashboard');
                  }}
                  className="flex flex-col gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-left transition-colors hover:border-violet-500/60 hover:bg-zinc-900"
                >
                  <span className="line-clamp-2 text-sm font-semibold text-zinc-100">
                    {project.name}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {project.updatedAt
                      ? `Updated ${new Date(project.updatedAt).toLocaleDateString()}`
                      : 'Never updated'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-3">
          <AttentionCard
            progress={progress}
            projectId={activeProjectId}
            onNavigate={onNavigate}
            onOpenStoryboard={onOpenStoryboard}
            onChanged={reload}
          />
          <RuntimeCard progress={progress} onNavigate={onNavigate} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="md:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 flex flex-col justify-center">
            <div className="flex justify-between items-end mb-4">
              <div>
                <h2 className="text-lg font-semibold text-zinc-100">Project Progress</h2>
                <p className="text-sm text-zinc-500">Overall completion status</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void reload()}
                  disabled={isLoading || !activeProjectId}
                  className="text-zinc-500 transition-colors hover:text-zinc-200 disabled:opacity-50"
                  title="Refresh progress"
                  aria-label="Refresh progress"
                >
                  <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
                </button>
                <span className="text-2xl font-bold text-violet-400" aria-live="polite">
                  {progress ? `${overall}%` : '–'}
                </span>
              </div>
            </div>
            <div
              className="w-full h-3 bg-zinc-800 rounded-full overflow-hidden"
              role="progressbar"
              aria-label="Overall project progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={overall}
            >
              <div
                className="h-full bg-violet-600 rounded-full transition-[width] duration-700 ease-out"
                style={{ width: `${overall}%` }}
              />
            </div>

            {error && (
              <p className="mt-4 flex items-center gap-2 text-xs text-red-300">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {progress
                ? progress.stages.map((stage, idx) => (
                    <button
                      key={stage.id}
                      type="button"
                      onClick={() => onNavigate(stage.view)}
                      className="flex flex-col gap-2 p-3 rounded-lg border border-zinc-800/50 bg-zinc-900 hover:border-zinc-700 transition-colors text-left group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-zinc-300 group-hover:text-zinc-100 flex items-center gap-2">
                          <span className="text-xs text-zinc-600 bg-zinc-950 w-5 h-5 flex items-center justify-center rounded">{idx + 1}</span>
                          {stage.label}
                        </span>
                        {stage.isRunning ? (
                          <span title="Generating now">
                            <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
                          </span>
                        ) : stage.status === 'complete' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        ) : stage.status === 'in_progress' ? (
                          <CircleDashed className="w-4 h-4 text-amber-500" />
                        ) : (
                          <Circle className="w-4 h-4 text-zinc-700" />
                        )}
                      </div>
                      <div className="flex gap-1 h-1 w-full" aria-hidden="true">
                        {[...Array(10)].map((_, i) => (
                          <div
                            key={i}
                            className={cn(
                              "flex-1 rounded-full",
                              i < Math.round(stage.progress / 10)
                                ? stage.status === 'complete' ? "bg-emerald-500/70" : "bg-zinc-500"
                                : "bg-zinc-800"
                            )}
                          />
                        ))}
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="truncate text-zinc-500">{stage.detail}</span>
                        <span className="ml-2 font-mono text-zinc-400">{stage.progress}%</span>
                      </div>
                    </button>
                  ))
                : [...Array(6)].map((_, i) => (
                    <div key={i} className="h-[76px] animate-pulse rounded-lg border border-zinc-800/50 bg-zinc-900" />
                  ))}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 flex flex-col">
            <h2 className="text-lg font-semibold text-zinc-100 mb-6">Continue Working</h2>
            <div className="space-y-3 flex-1">
              {!progress ? (
                [...Array(3)].map((_, i) => (
                  <div key={i} className="h-[58px] animate-pulse rounded-lg border border-zinc-800 bg-zinc-900" />
                ))
              ) : progress.nextActions.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 py-6 text-center text-sm text-zinc-500">
                  <Sparkles className="h-5 w-5 text-emerald-400" />
                  Everything is done. Nice work!
                </div>
              ) : (
                progress.nextActions.map((action) => {
                  const { icon: Icon, className } = ACTION_ICONS[action.icon];
                  return (
                    <button
                      key={action.key}
                      type="button"
                      onClick={() => {
                        if (action.sceneId && onOpenStoryboard) onOpenStoryboard(action.sceneId);
                        else onNavigate(action.view);
                      }}
                      className="w-full flex items-center gap-3 p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-violet-500 hover:bg-zinc-800/80 transition-all text-left"
                    >
                      <div className={cn('w-8 h-8 rounded-md flex items-center justify-center shrink-0', className)}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-zinc-200">{action.title}</div>
                        <div className="truncate text-xs text-zinc-500">{action.subtitle}</div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            {progress && (
              <button
                type="button"
                onClick={() => onNavigate('scenes')}
                className="mt-4 inline-flex items-center gap-1.5 self-start text-xs font-semibold text-violet-400 transition-colors hover:text-violet-300"
              >
                <Clapperboard className="h-3.5 w-3.5" />
                All scenes
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}