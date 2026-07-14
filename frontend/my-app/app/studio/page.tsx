"use client";

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { StudioSidebar } from '@/components/studio/layout/Sidebar';
import { StudioTopbar } from '@/components/studio/layout/Topbar';
import { StudioInspector } from '@/components/studio/layout/Inspector';
import { StudioBottomPanel } from '@/components/studio/layout/BottomPanel';
import { StudioDashboard } from '@/components/studio/workspace/Dashboard';
import { ScriptEditor } from '@/components/studio/workspace/ScriptEditor';
import { Scenes } from '@/components/studio/workspace/Scenes';
import { Characters } from '@/components/studio/workspace/Characters';
import { MovieIdea } from '@/components/studio/workspace/MovieIdea';
import { Outline } from '@/components/studio/workspace/Outline';
import { useProject } from '@/lib/useProject';

export default function StudioPage() {
  const { projectId, projectName, loadLastProject, createProject } = useProject();
  const [activeView, setActiveView] = useState('dashboard');
  const [selectedItem, setSelectedItem] = useState<Record<string, unknown> | null>(null);
  const [isInspectorVisible, setIsInspectorVisible] = useState(true);
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [isProjectReady, setIsProjectReady] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function prepareProject() {
      setProjectError(null);
      const existingProject = await loadLastProject();

      if (!isMounted) return;

      if (existingProject) {
        setIsProjectReady(true);
        return;
      }

      const newProjectId = await createProject('Alien Invasion');
      if (!isMounted) return;

      if (newProjectId) {
        setIsProjectReady(true);
      } else {
        setProjectError('Unable to create a studio project. Check Supabase connection and table policies.');
        setIsProjectReady(true);
      }
    }

    prepareProject();

    return () => {
      isMounted = false;
    };
  }, [createProject, loadLastProject]);

  const renderWorkspace = () => {
    if (!isProjectReady) {
      return (
        <div className="flex h-full items-center justify-center p-8 text-sm text-zinc-500">
          Loading studio project...
        </div>
      );
    }

    if (projectError) {
      return (
        <div className="flex h-full items-center justify-center p-8 text-center text-sm text-red-300">
          {projectError}
        </div>
      );
    }

    switch (activeView) {
      case 'dashboard': 
        return <StudioDashboard onNavigate={setActiveView} />;
      case 'idea':
        return <MovieIdea projectId={projectId} onNavigateToCharacters={() => setActiveView('characters')} onNavigateToOutline={() => setActiveView('outline')} />;
      case 'outline':
        return <Outline projectId={projectId} onNavigateToIdea={() => setActiveView('idea')} />;
      case 'script': 
        return <ScriptEditor projectId={projectId} />;
      case 'scenes':
        return <Scenes projectId={projectId} onNavigateToScript={() => { setActiveView('script'); }} />;
      case 'characters': 
        return <Characters onSelect={(item) => setSelectedItem(item)} />;
      case 'storyboards':
        return (
          <div className="p-8">
            <h1 className="text-2xl font-bold text-white mb-6">Scene 1: Storyboard</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map((idx) => (
                <div key={idx} className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900 group">
                  <div className="aspect-video relative bg-zinc-800">
                     <Image src={`https://picsum.photos/seed/story${idx}/800/450`} alt={`Storyboard frame ${idx}`} fill className="object-cover opacity-80 group-hover:opacity-100 transition-opacity" sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw" />
                  </div>
                  <div className="p-4">
                    <p className="text-xs text-zinc-400 font-mono mb-2">SHOT {idx}.0</p>
                    <p className="text-sm text-zinc-200">Medium wide tracking shot pushing in as they approach the console.</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      default: 
        return (
          <div className="p-8 flex flex-col items-center justify-center h-full text-zinc-500">
            <div className="w-16 h-16 mb-4 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/50 flex items-center justify-center">
               <span className="text-2xl font-mono opacity-50">?</span>
            </div>
            <p>Select a view from the sidebar</p>
            <p className="text-xs mt-2">Currently selected: {activeView}</p>
          </div>
        );
    }
  };

  return (
    <div className="h-screen w-full flex flex-col bg-[#0A0A0B] text-zinc-100 overflow-hidden font-sans selection:bg-violet-500/30">
      <StudioTopbar projectName={projectName} />
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Animated Side Navigation - Shifting, No Overlap */}
        <div 
          className="flex h-full relative"
          onMouseLeave={() => setIsSidebarVisible(false)}
        >
          {/* Expand Sensor */}
          <div 
            className="w-4 h-full cursor-e-resize relative group shrink-0 z-50"
            onMouseEnter={() => setIsSidebarVisible(true)}
          >
             <div className="absolute left-0 top-0 bottom-0 w-1 bg-violet-500/0 group-hover:bg-violet-500/50 transition-colors delay-100" />
          </div>
          
          {/* Sidebar Content (Width Animated to avoid overlaying & clipping) */}
          <div 
            className="transition-all duration-300 ease-out h-full overflow-hidden shrink-0 border-r border-zinc-800 bg-zinc-950 flex"
            style={{ width: isSidebarVisible ? '16rem' : '0px' }}
          >
            <div className="w-64 shrink-0 h-full">
              <StudioSidebar activeView={activeView} onNavigate={(view) => {
                setActiveView(view);
                setIsSidebarVisible(false);
              }} />
            </div>
          </div>
        </div>

        {/* Main Content Area Workspace */}
        <main className="flex-1 overflow-auto bg-[#0A0A0B] relative flex flex-col hide-scrollbar ml-4 mr-4">
          {renderWorkspace()}
        </main>

        {/* Hover Inspector Overlay */}
        {activeView !== 'dashboard' && activeView !== 'idea' && (
          <div 
            className={`absolute right-0 top-0 bottom-0 z-50 flex justify-end ${
              isInspectorVisible ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            onMouseLeave={() => setIsInspectorVisible(false)}
          >
            {/* Collapse Sensor */}
            <div 
              className="w-4 h-full pointer-events-auto cursor-w-resize relative group"
              onMouseEnter={() => setIsInspectorVisible(true)}
            >
               <div className="absolute right-0 top-0 bottom-0 w-1 bg-violet-500/0 group-hover:bg-violet-500/50 transition-colors delay-100" />
            </div>
            
            {/* Inspector Content */}
            <div className={`absolute right-0 top-0 transition-transform duration-300 ease-out h-full ${
              isInspectorVisible ? 'translate-x-0' : 'translate-x-full pointer-events-none'
            }`}>
              <StudioInspector activeView={activeView} selectedItem={selectedItem} onClose={() => setIsInspectorVisible(false)} />
            </div>
          </div>
        )}
      </div>
      <StudioBottomPanel activeView={activeView} />

      {/* Global CSS for scrollbars */}
      <style dangerouslySetInnerHTML={{__html: `
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}} />
    </div>
  );
}
