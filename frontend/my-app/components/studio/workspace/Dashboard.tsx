"use client";

import { Users, LayoutGrid, MonitorPlay, FileText, CheckCircle2, Circle, FolderOpen, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
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
}

const STAGES = [
  { id: 'script', label: 'Story', status: 'complete', progress: 100 },
  { id: 'characters', label: 'Assets', status: 'complete', progress: 100 },
  { id: 'storyboards', label: 'Storyboard', status: 'in_progress', progress: 60 },
  { id: 'voices', label: 'Audio', status: 'pending', progress: 40 },
  { id: 'video_clips', label: 'Video', status: 'pending', progress: 10 },
  { id: 'publish', label: 'Export', status: 'pending', progress: 0 },
];

export function StudioDashboard({
  onNavigate,
  projectName = 'Untitled',
  videoType,
  projects = [],
  activeProjectId = null,
  onSelectProject,
}: DashboardProps) {
  const activeVideoType = getVideoTypeConfig(resolveVideoType(videoType ?? null));
  const otherProjects = projects.filter((project) => project.id !== activeProjectId).slice(0, 3);

  return (
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
              Your Projects
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 flex flex-col justify-center">
          <div className="flex justify-between items-end mb-4">
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">Project Progress</h2>
              <p className="text-sm text-zinc-500">Overall completion status</p>
            </div>
            <span className="text-2xl font-bold text-violet-400">67%</span>
          </div>
          <div className="w-full h-3 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-violet-600 w-[67%] rounded-full transition-all duration-1000 ease-in-out"></div>
          </div>
          
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {STAGES.map((stage, idx) => (
              <button 
                key={stage.id}
                onClick={() => onNavigate(stage.id)}
                className="flex flex-col gap-2 p-3 rounded-lg border border-zinc-800/50 bg-zinc-900 hover:border-zinc-700 transition-colors text-left group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-300 group-hover:text-zinc-100 flex items-center gap-2">
                    <span className="text-xs text-zinc-600 bg-zinc-950 w-5 h-5 flex items-center justify-center rounded">{idx + 1}</span>
                    {stage.label}
                  </span>
                  {stage.status === 'complete' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : stage.status === 'in_progress' ? (
                    <div className="w-4 h-4 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
                  ) : (
                    <Circle className="w-4 h-4 text-zinc-700" />
                  )}
                </div>
                <div className="flex gap-1 h-1 w-full">
                  {[...Array(10)].map((_, i) => (
                    <div 
                      key={i} 
                      className={cn(
                        "flex-1 rounded-full",
                        i < stage.progress / 10 ? "bg-zinc-500" : "bg-zinc-800"
                      )} 
                    />
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 flex flex-col">
          <h2 className="text-lg font-semibold text-zinc-100 mb-6">Continue Working</h2>
          <div className="space-y-3 flex-1">
            <button 
              onClick={() => onNavigate('script')}
              className="w-full flex items-center gap-3 p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-violet-500 hover:bg-zinc-800/80 transition-all text-left"
            >
              <div className="w-8 h-8 rounded-md bg-violet-600/20 text-violet-500 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-200">Scene 8</div>
                <div className="text-xs text-zinc-500">Edit Script</div>
              </div>
            </button>
            
            <button 
              onClick={() => onNavigate('characters')}
              className="w-full flex items-center gap-3 p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-violet-500 hover:bg-zinc-800/80 transition-all text-left"
            >
              <div className="w-8 h-8 rounded-md bg-blue-600/20 text-blue-500 flex items-center justify-center shrink-0">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-200">Generate Characters</div>
                <div className="text-xs text-zinc-500">Assets</div>
              </div>
            </button>
            
            <button 
              onClick={() => onNavigate('storyboards')}
              className="w-full flex items-center gap-3 p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-violet-500 hover:bg-zinc-800/80 transition-all text-left"
            >
              <div className="w-8 h-8 rounded-md bg-emerald-600/20 text-emerald-500 flex items-center justify-center shrink-0">
                <LayoutGrid className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-200">Review Storyboards</div>
                <div className="text-xs text-zinc-500">Planning</div>
              </div>
            </button>
            
            <button 
              onClick={() => onNavigate('scene_render')}
              className="w-full flex items-center gap-3 p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-violet-500 hover:bg-zinc-800/80 transition-all text-left"
            >
              <div className="w-8 h-8 rounded-md bg-amber-600/20 text-amber-500 flex items-center justify-center shrink-0">
                <MonitorPlay className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-200">Render Scene</div>
                <div className="text-xs text-zinc-500">Production</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}