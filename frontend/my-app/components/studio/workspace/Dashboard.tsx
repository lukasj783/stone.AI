"use client";

import React from 'react';
import { Users, LayoutGrid, MonitorPlay, FileText, CheckCircle2, Circle, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DashboardProps {
  onNavigate: (view: string) => void;
}

const STAGES = [
  { id: 'idea', label: 'Idea', status: 'complete', progress: 100 },
  { id: 'script', label: 'Story', status: 'complete', progress: 100 },
  { id: 'characters', label: 'Assets', status: 'complete', progress: 100 },
  { id: 'storyboards', label: 'Storyboard', status: 'in_progress', progress: 60 },
  { id: 'voices', label: 'Audio', status: 'pending', progress: 40 },
  { id: 'video_clips', label: 'Video', status: 'pending', progress: 10 },
  { id: 'publish', label: 'Export', status: 'pending', progress: 0 },
];

export function StudioDashboard({ onNavigate }: DashboardProps) {
  return (
    <div className="p-8 max-w-5xl mx-auto w-full">
      <div className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Alien Invasion</h1>
        <p className="text-zinc-400">Project Workspace</p>
      </div>

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
              onClick={() => onNavigate('idea')}
              className="w-full flex items-center gap-3 p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-violet-500 hover:bg-zinc-800/80 transition-all text-left"
            >
              <div className="w-8 h-8 rounded-md bg-violet-600/20 text-violet-500 flex items-center justify-center shrink-0">
                <Lightbulb className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-200">Develop Movie Idea</div>
                <div className="text-xs text-zinc-500">Story Foundation</div>
              </div>
            </button>

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
