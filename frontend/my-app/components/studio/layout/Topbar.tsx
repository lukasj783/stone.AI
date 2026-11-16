"use client";

import React from 'react';
import { Search, Bell, Settings, User, Home } from 'lucide-react';
import Link from 'next/link';
import type { Project } from '@/lib/types/layers.types';
import type { StudioVideoTypeId } from '@/lib/studioVideoTypes';
import { ProjectSwitcher } from '@/components/studio/layout/ProjectSwitcher';

interface StudioTopbarProps {
  projectName?: string;
  projectId?: string | null;
  projects?: Project[];
  isProjectsLoading?: boolean;
  isCreatingProject?: boolean;
  onRefreshProjects?: () => void | Promise<unknown>;
  onSelectProject?: (id: string) => void | Promise<void>;
  onCreateProject?: (name: string, videoType: StudioVideoTypeId) => Promise<void> | void;
  onDeleteProject?: (id: string) => void;
  onOpenProjects?: () => void;
}

export function StudioTopbar({
  projectName = 'Untitled',
  projectId = null,
  projects = [],
  isProjectsLoading = false,
  isCreatingProject = false,
  onRefreshProjects,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onOpenProjects,
}: StudioTopbarProps) {
  return (
    <header className="h-14 border-b border-zinc-800 bg-[#0A0A0B] shrink-0 flex items-center justify-between px-4 z-20">
      <div className="flex items-center gap-2">
        <Link href="/story" className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-white">
          <Home size={18} />
        </Link>
        <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center shrink-0">
          <span className="font-bold text-white text-lg leading-none">A</span>
        </div>
        <div className="flex flex-col ml-2">
          <span className="text-sm font-semibold leading-none text-zinc-100 whitespace-nowrap">AI Movie Studio</span>
          <span className="text-xs text-zinc-500 leading-none mt-1 whitespace-nowrap">Project workspace</span>
        </div>
        <ProjectSwitcher
          projectId={projectId}
          projectName={projectName}
          projects={projects}
          isLoading={isProjectsLoading}
          isCreating={isCreatingProject}
          onRefresh={onRefreshProjects ?? (() => undefined)}
          onSelect={onSelectProject ?? (() => undefined)}
          onDelete={onDeleteProject ?? (() => undefined)}
          onCreate={onCreateProject ?? (() => undefined)}
          onOpenGallery={onOpenProjects ?? (() => undefined)}
        />
      </div>
      
      <div className="flex-1 max-w-md mx-8">
        <div className="relative group">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-zinc-500 group-focus-within:text-violet-500 transition-colors" />
          </div>
          <input
            type="text"
            className="block w-full h-9 pl-10 pr-3 rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-violet-500 focus:bg-[#0A0A0B] focus:outline-none transition-all"
            placeholder="Command Palette (Cmd+K)"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors">
          <Bell className="w-4 h-4" />
        </button>
        <button className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors">
          <Settings className="w-4 h-4" />
        </button>
        <button className="w-9 h-9 flex items-center justify-center rounded-full bg-zinc-800 border border-zinc-700 ml-2 overflow-hidden">
          <User className="w-4 h-4 text-zinc-400" />
        </button>
      </div>
    </header>
  );
}
