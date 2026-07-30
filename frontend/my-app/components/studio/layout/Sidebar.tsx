"use client";

import React from 'react';
import { 
  Lightbulb, List, FileText, Clapperboard, 
  Users, MountainSnow, Box, LayoutGrid, 
  ListVideo, Mic2, Music, Sparkles, 
  Video, Mic, MonitorPlay, Scissors, 
  Type, PlaySquare, Film, UploadCloud
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAVIGATION = [
  {
    category: 'Project',
    items: [
      { id: 'dashboard', label: 'Project Dashboard', icon: Film },
      { id: 'idea', label: 'Idea', icon: Lightbulb },
      { id: 'outline', label: 'Outline', icon: List },
      { id: 'script', label: 'Script', icon: FileText },
      { id: 'scenes', label: 'Scenes', icon: Clapperboard },
    ]
  },
  {
    category: 'Assets',
    items: [
      { id: 'characters', label: 'Characters', icon: Users },
      { id: 'environments', label: 'Environments', icon: MountainSnow },
      { id: 'props', label: 'Objects', icon: Box },
    ]
  },
  {
    category: 'Planning',
    items: [
      { id: 'storyboards', label: 'Storyboards', icon: LayoutGrid },
      { id: 'shot_list', label: 'Shot List', icon: ListVideo },
    ]
  },
  {
    category: 'Audio',
    items: [
      { id: 'voices', label: 'Voices', icon: Mic2 },
      { id: 'music', label: 'Music', icon: Music },
      { id: 'sfx', label: 'SFX', icon: Sparkles },
    ]
  },
  {
    category: 'Production',
    items: [
      { id: 'video_clips', label: 'Video Clips', icon: Video },
      { id: 'lip_sync', label: 'Lip Sync', icon: Mic },
      { id: 'scene_render', label: 'Scene Render', icon: MonitorPlay },
    ]
  },
  {
    category: 'Assembly',
    items: [
      { id: 'timeline', label: 'Timeline', icon: Scissors },
      { id: 'captions', label: 'Captions', icon: Type },
      { id: 'preview', label: 'Preview', icon: PlaySquare },
    ]
  },
  {
    category: 'Export',
    items: [
      { id: 'publish', label: 'Publish', icon: UploadCloud },
    ]
  }
];

interface SidebarProps {
  activeView: string;
  onNavigate: (id: string) => void;
}

export function StudioSidebar({ activeView, onNavigate }: SidebarProps) {
  return (
    <aside className="h-full w-64 xl:w-72 shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col overflow-y-auto shadow-2xl shadow-black/50">
      <div className="p-4">
        {NAVIGATION.map((section, idx) => (
          <div key={idx} className="mb-6 last:mb-0">
            <h3 className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {section.category}
            </h3>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = activeView === item.id;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500",
                      isActive 
                        ? "bg-violet-600/10 text-violet-400" 
                        : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50"
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}