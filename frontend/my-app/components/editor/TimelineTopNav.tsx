import React, { useState, useEffect, useRef } from 'react';
import { Home, Undo, Redo, Cloud, LayoutTemplate, Film, Plus, Loader2, Pause, Play, Download, Share, ChevronDown, Trash2 } from 'lucide-react';
import Link from 'next/link';
import type { Project } from '@/lib/types/layers.types';

export function TimelineTopNav({
  isPlaying, onTogglePlay, onUndo, onRedo, canUndo, canRedo,
  projectName, onProjectNameChange, onSave, isSaving, isDirty, onNewProject,
  projects, onLoadProject, onDeleteProject, onListProjects,
}: {
  isPlaying: boolean; onTogglePlay: () => void;
  onUndo: () => void; onRedo: () => void;
  canUndo: boolean; canRedo: boolean;
  projectName: string;
  onProjectNameChange: (name: string) => void;
  onSave: () => void;
  isSaving: boolean;
  isDirty: boolean;
  onNewProject: () => void;
  projects: Project[];
  onLoadProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onListProjects: () => void;
}) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(projectName);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setEditName(projectName); }, [projectName]);

  useEffect(() => {
    if (isDropdownOpen && onListProjects) {
        onListProjects();
    }
  }, [isDropdownOpen, onListProjects]);

  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  const handleNameSubmit = () => {
    setIsEditingName(false);
    const trimmed = editName.trim();
    if (trimmed && trimmed !== projectName) {
      onProjectNameChange(trimmed);
    } else {
      setEditName(projectName);
    }
  };

  return (
    <header className="h-14 bg-[#18181b] border-b border-zinc-800 flex items-center justify-between px-4 shrink-0 z-50">
      <div className="flex items-center gap-4">
        <Link href="/story" aria-label="Go home" className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-white">
          <Home size={18} />
        </Link>
        <div className="flex items-center gap-2 relative">
          <div className="group flex items-center gap-1">
            {isEditingName ? (
              <input
                ref={nameInputRef}
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleNameSubmit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNameSubmit();
                  if (e.key === 'Escape') { setEditName(projectName); setIsEditingName(false); }
                }}
                className="bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-sm font-bold text-white outline-none focus:border-blue-500 w-48"
                placeholder="Project name"
                aria-label="Project name"
              />
            ) : (
              <button
                className="font-bold text-white text-sm cursor-pointer hover:text-blue-400 transition-colors flex items-center gap-1"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                title="Click to project list"
              >
                {projectName}
                <ChevronDown size={14} className="text-zinc-500" />
              </button>
            )}
            <div className={`w-1.5 h-1.5 rounded-full ${isDirty ? 'bg-red-500' : 'bg-green-500'}`} title={isDirty ? 'Unsaved changes' : 'All saved'}></div>
          </div>

          {isDropdownOpen && (
            <div className="absolute top-8 left-0 w-64 bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl z-50 p-2 space-y-1">
              <div className="text-[10px] font-bold text-zinc-500 uppercase px-2 py-1">My Projects</div>
              
              {projects.map((p: Project) => (
                <div key={p.id} className="flex items-center justify-between group/item hover:bg-zinc-900 rounded p-1.5 transition-colors">
                  <button 
                    onClick={() => { onLoadProject(p.id); setIsDropdownOpen(false); }} 
                    className="text-xs text-zinc-300 hover:text-white truncate flex-1 text-left"
                  >
                    {p.name}
                  </button>
                  
                  <button 
                    onClick={(e) => { e.stopPropagation(); onDeleteProject(p.id); }} 
                    className="opacity-0 group-hover/item:opacity-100 p-1 hover:text-red-400 text-zinc-600 transition-all ml-2"
                    title="Delete project"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <div className="border-t border-zinc-800 mt-2 pt-2">
                <button onClick={() => { setIsEditingName(true); setIsDropdownOpen(false); }} className="text-xs text-zinc-400 hover:text-white px-2 py-1">Rename Project</button>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={onNewProject}
          className="flex items-center gap-1 ml-1 text-zinc-500 hover:text-white text-xs font-medium hover:bg-zinc-800 px-2 py-1 rounded transition-colors"
          title="New project"
        >
          <Plus size={12} />
          New
        </button>
        <div className="flex items-center gap-1 ml-4 border-l border-zinc-800 pl-4">
          <button aria-label="Undo" onClick={onUndo} disabled={!canUndo}
            className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 disabled:opacity-30 disabled:cursor-not-allowed">
            <Undo size={16} />
          </button>
          <button aria-label="Redo" onClick={onRedo} disabled={!canRedo}
            className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 disabled:opacity-30 disabled:cursor-not-allowed">
            <Redo size={16} />
          </button>
        </div>
        <button
          onClick={onSave}
          disabled={isSaving}
          className="flex items-center gap-2 ml-2 text-zinc-300 font-medium text-sm cursor-pointer hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} />}
          <span>{isSaving ? 'Saving...' : 'Save'}</span>
        </button>
      </div>

      <div className="flex items-center bg-zinc-900 rounded-lg p-1 border border-zinc-800">
        <Link href="/storyboard" className="flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium text-zinc-400 hover:text-white transition-colors">
          <LayoutTemplate size={16} />
          Storyboard
        </Link>
        <Link href="/editor" className="flex items-center gap-2 px-4 py-1.5 bg-zinc-800 rounded-md shadow-sm text-sm font-bold text-white">
          <Film size={16} />
          Timeline
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <button aria-label={isPlaying ? 'Pause' : 'Play'} title="Play/Pause (Space)" onClick={onTogglePlay}
          className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-white transition-colors">
          {isPlaying ? <Pause size={14} /> : <Play size={14} className="fill-white ml-0.5" />}
        </button>
        <button aria-label="Download" className="w-8 h-8 rounded-lg hover:bg-zinc-800 flex items-center justify-center text-zinc-400 transition-colors">
          <Download size={16} />
        </button>
        <button aria-label="Share" className="flex items-center gap-2 px-4 py-1.5 ml-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-bold transition-colors shadow-lg shadow-blue-600/20">
          Share
          <Share size={14} />
        </button>
      </div>
    </header>
  );
}
