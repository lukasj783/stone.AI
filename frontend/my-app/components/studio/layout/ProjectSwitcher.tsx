"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Film, FolderOpen, Search, Trash2 } from "lucide-react";
import type { Project } from "@/lib/types/layers.types";
import { cn } from "@/lib/utils";
import { NewProjectForm } from "@/components/studio/projects/NewProjectForm";
import {
  getVideoTypeConfig,
  resolveVideoType,
  type StudioVideoTypeId,
} from "@/lib/studioVideoTypes";

interface ProjectSwitcherProps {
  projectId: string | null;
  projectName: string;
  projects: Project[];
  isLoading?: boolean;
  isCreating?: boolean;
  onRefresh: () => void | Promise<unknown>;
  onSelect: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void;
  onCreate: (name: string, videoType: StudioVideoTypeId) => Promise<void> | void;
  onOpenGallery: () => void;
}

function formatRelativeDate(value?: string) {
  if (!value) return "Never updated";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Never updated";

  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} h ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays} d ago`;

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ProjectSwitcher({
  projectId,
  projectName,
  projects,
  isLoading = false,
  isCreating = false,
  onRefresh,
  onSelect,
  onDelete,
  onCreate,
  onOpenGallery,
}: ProjectSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return projects;
    return projects.filter((project) => project.name.toLowerCase().includes(normalized));
  }, [projects, query]);

  const handleToggle = () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    setQuery("");
    setIsOpen(true);
    void onRefresh();
  };

  const handleSelect = async (id: string) => {
    setIsOpen(false);
    if (id === projectId) return;
    await onSelect(id);
  };

  const handleCreate = async (name: string, videoType: StudioVideoTypeId) => {
    await onCreate(name, videoType);
    setIsOpen(false);
  };

  return (
    <div className="relative ml-2" ref={containerRef}>
      <button
        type="button"
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title="Switch movie idea"
        className="flex max-w-[18rem] items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
      >
        <Film className="h-3.5 w-3.5 shrink-0 text-violet-400" />
        <span className="flex min-w-0 flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 leading-none">
            Project
          </span>
          <span className="truncate text-sm font-semibold leading-tight text-zinc-100">
            {projectName || "No project selected"}
          </span>
        </span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform", isOpen && "rotate-180")}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-zinc-800 bg-[#0F0F12] shadow-2xl shadow-black/70">
          <div className="border-b border-zinc-800 p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search movie ideas..."
                aria-label="Search movie ideas"
                className="h-8 w-full rounded-lg border border-zinc-800 bg-[#0A0A0B] pl-8 pr-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-500"
              />
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto p-1.5">
            {isLoading && (
              <p className="px-2 py-3 text-xs text-zinc-500">Loading your ideas...</p>
            )}

            {!isLoading && filteredProjects.length === 0 && (
              <p className="px-2 py-3 text-xs text-zinc-500">
                {projects.length === 0
                  ? "No movie ideas yet. Create your first one below."
                  : "No ideas match your search."}
              </p>
            )}

            {filteredProjects.map((project) => {
              const isActive = project.id === projectId;
              const projectVideoType = getVideoTypeConfig(resolveVideoType(project.settings));
              return (
                <div
                  key={project.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-lg px-2 py-2 transition-colors",
                    isActive ? "bg-violet-600/10" : "hover:bg-zinc-800/60"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => void handleSelect(project.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                        isActive ? "bg-violet-600 text-white" : "bg-zinc-800 text-zinc-400"
                      )}
                    >
                      {isActive ? <Check size={12} /> : <Film size={12} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-sm font-medium",
                          isActive ? "text-violet-200" : "text-zinc-200"
                        )}
                      >
                        {project.name}
                      </span>
                      <span className="block text-[10px] text-zinc-500">
                        {projectVideoType.label} · {formatRelativeDate(project.updatedAt)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(project.id);
                    }}
                    title={`Delete ${project.name}`}
                    aria-label={`Delete ${project.name}`}
                    className="rounded p-1 text-zinc-600 opacity-0 transition-all hover:text-rose-400 group-hover:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="space-y-2 border-t border-zinc-800 bg-zinc-950/60 p-3">
            <NewProjectForm
              onCreate={handleCreate}
              isSubmitting={isCreating}
              variant="inline"
              placeholder="New project title..."
            />
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onOpenGallery();
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-100"
            >
              <FolderOpen size={13} />
              Browse all movie ideas
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProjectSwitcher;
