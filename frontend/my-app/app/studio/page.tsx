"use client";

import React, { useEffect, useState } from 'react';
import { StudioSidebar } from '@/components/studio/layout/Sidebar';
import { StudioTopbar } from '@/components/studio/layout/Topbar';
import { StudioBottomPanel } from '@/components/studio/layout/BottomPanel';
import { StudioDashboard } from '@/components/studio/workspace/Dashboard';
import { ScriptEditor } from '@/components/studio/workspace/ScriptEditor';
import { Scenes } from '@/components/studio/workspace/Scenes';
import { Characters } from '../../components/studio/workspace/Characters';
import { Environments } from '@/components/studio/workspace/Environments';
import { Objects } from '@/components/studio/workspace/Objects';
import { MovieIdea } from '@/components/studio/workspace/MovieIdea';
import { Outline } from '@/components/studio/workspace/Outline';
import { StoryboardWorkspace } from '@/components/studio/workspace/StoryboardWorkspace';
import { ShotListWorkspace } from '@/components/studio/workspace/ShotListWorkspace';
import { generateSceneStoryboard } from '@/lib/api/image-generation';
import { useProject } from '@/lib/useProject';

export default function StudioPage() {
  const { projectId, projectName, loadLastProject, createProject } = useProject();
  const [activeView, setActiveView] = useState('dashboard');
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [isProjectReady, setIsProjectReady] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [selectedStoryboardSceneId, setSelectedStoryboardSceneId] = useState<string | null>(null);

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

  const handleConvertToStoryboard = async (sceneId: string) => {
    if (!projectId) throw new Error('A project is required before generating a storyboard.');

    await generateSceneStoryboard({ project_id: projectId, scene_id: sceneId });
    setSelectedStoryboardSceneId(sceneId);
    setActiveView('storyboards');
  };

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
        return (
          <Scenes
            projectId={projectId}
            onNavigateToScript={() => { setActiveView('script'); }}
            onConvertToStoryboard={handleConvertToStoryboard}
          />
        );
      case 'characters': 
        return <Characters projectId={projectId} onSelect={() => {}} />;
      case 'environments':
        return <Environments projectId={projectId} onSelect={() => {}} />;
      case 'props':
        return <Objects projectId={projectId} onSelect={() => {}} />;
      case 'storyboards':
        return (
          <StoryboardWorkspace
            projectId={projectId}
            sceneId={selectedStoryboardSceneId}
            onBackToScenes={() => setActiveView('scenes')}
            onSelectScene={(newSceneId) => setSelectedStoryboardSceneId(newSceneId)}
          />
        );
      case 'shot_list':
        return (
          <ShotListWorkspace
            projectId={projectId}
            onOpenStoryboard={(sceneId) => {
              setSelectedStoryboardSceneId(sceneId);
              setActiveView('storyboards');
            }}
            onOpenTimeline={() => setActiveView('timeline')}
          />
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
