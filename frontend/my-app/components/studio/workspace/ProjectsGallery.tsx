"use client";

import React, { useMemo } from "react";
import { CheckCircle2, Clock3, Film, Loader2, RefreshCw, Trash2 } from "lucide-react";
import type { Project } from "@/lib/types/layers.types";
import { cn } from "@/lib/utils";
import { NewProjectForm } from "@/components/studio/projects/NewProjectForm";
import { VideoTypeBadge } from "@/components/studio/projects/VideoTypeSelector";
import {
  getVideoTypeConfig,
  resolveVideoType,
  type StudioVideoTypeId,
} from "@/lib/studioVideoTypes";

interface ProjectsGalleryProps {
  projects: Project[];
  activeProjectId: string | null;
  isLoading?: boolean;
  isCreating?: boolean;
  error?: string | null;
  onCreate: (name: string, videoType: StudioVideoTypeId) => Promise<void> | void;
  onSelect: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void;
  onRefresh?: () => void | Promise<unknown>;
}

function formatUpdatedAt(value?: string) {
  if (!value) return "Never updated";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Never updated";

  const diffDays = Math.floor((Date.now() - timestamp) / 86400000);
  if (diffDays <= 0) return "Updated today";
  if (diffDays === 1) return "Updated yesterday";
  if (diffDays < 7) return `Updated ${diffDays} days ago`;

  return `Updated ${new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

export function ProjectsGallery({
  projects,
  activeProjectId,
  isLoading = false,
  isCreating = false,
  error = null,
  onCreate,
  onSelect,
  onDelete,
  onRefresh,
}: ProjectsGalleryProps) {
  const sortedProjects = useMemo(
    () =>
      [...projects].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
    [projects]
  );

  const isEmpty = !isLoading && sortedProjects.length === 0;

  return (
    <div className="h-full overflow-y-auto bg-[#0A0A0B] px-5 py-8 text-zinc-100 lg:px-10">
      <div className="mx-auto w-full max-w-6xl space-y-8 pb-10">
        <header className="flex flex-col gap-4 border-b border-zinc-800 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-violet-400">
              <Film className="h-4 w-4" />
              Studio Projects
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
              {isEmpty ? "Start your first video project" : "Your Projects"}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              {isEmpty
                ? "Chagua aina ya video (Feature Film, Short Film, Music Video, Documentary au Advertisement), kisha weka jina la project."
                : `${sortedProjects.length} project${sortedProjects.length === 1 ? "" : "s"} in this studio. Pick one to continue where you left off.`}
            </p>
          </div>
          {onRefresh && (
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={isLoading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-zinc-700 px-4 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-900 disabled:opacity-50"
            >
              <RefreshCw size={14} className={cn(isLoading && "animate-spin")} />
              Refresh
            </button>
          )}
        </header>

        {error && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        {isLoading && sortedProjects.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 size={16} className="animate-spin" />
            Loading your movie ideas...
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-xl border border-dashed border-violet-500/40 bg-violet-500/[0.04] p-5 sm:col-span-2 xl:col-span-3">
            <NewProjectForm variant="wizard" onCreate={onCreate} isSubmitting={isCreating} />
          </div>

          {sortedProjects.map((project) => {
            const isActive = project.id === activeProjectId;
            const videoType = getVideoTypeConfig(resolveVideoType(project.settings));
            return (
              <article
                key={project.id}
                className={cn(
                  "flex flex-col justify-between rounded-xl border bg-zinc-900/60 p-5 transition-colors",
                  isActive
                    ? "border-violet-500/60 ring-1 ring-violet-500/30"
                    : "border-zinc-800 hover:border-zinc-700"
                )}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="line-clamp-2 text-base font-semibold text-zinc-100">
                      {project.name}
                    </h2>
                    {isActive && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-300">
                        <CheckCircle2 size={11} />
                        Active
                      </span>
                    )}
                  </div>
                  <VideoTypeBadge videoType={videoType} />
                  {project.description && (
                    <p className="line-clamp-2 text-xs text-zinc-400">{project.description}</p>
                  )}
                  <p className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <Clock3 size={12} />
                    {formatUpdatedAt(project.updatedAt)}
                  </p>
                </div>

                <div className="mt-5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void onSelect(project.id)}
                    disabled={isActive}
                    className={cn(
                      "inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition-colors",
                      isActive
                        ? "cursor-default bg-zinc-800 text-zinc-400"
                        : "bg-violet-600 text-white hover:bg-violet-500"
                    )}
                  >
                    {isActive ? "Currently open" : "Open project"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(project.id)}
                    title={`Delete ${project.name}`}
                    aria-label={`Delete ${project.name}`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 text-zinc-500 transition-colors hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-400"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default ProjectsGallery;
