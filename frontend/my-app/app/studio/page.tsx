"use client";

import React, { useCallback, useEffect, useState } from 'react';
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
import { ProjectsGallery } from '@/components/studio/workspace/ProjectsGallery';
import DeleteConfirmationModal from '@/components/ui/DeleteConfirmationModal';
import { generateSceneStoryboard } from '@/lib/api/image-generation';
import { useProject } from '@/lib/useProject';
import {
  isNarrativeVideoType,
  type StudioVideoTypeId,
} from '@/lib/studioVideoTypes';

export default function StudioPage() {
  const {
    projectId,
    projectName,
    projectVideoType,
    projects,
    isProjectsLoading,
    projectsError,
    loadLastStudioProject,
    listStudioProjects,
    createProject,
    loadProject,
    deleteProject,
  } = useProject();
  const [activeView, setActiveView] = useState('dashboard');
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [isProjectReady, setIsProjectReady] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [selectedStoryboardSceneId, setSelectedStoryboardSceneId] = useState<string | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);

  const isNarrativeProject = isNarrativeVideoType(projectVideoType);

  // Restore the most recent studio project. No project is auto-created anymore —
  // the user names their first movie idea instead.
  useEffect(() => {
    let isMounted = true;

    async function prepareProject() {
      setProjectError(null);
      await loadLastStudioProject();

      if (!isMounted) return;
      setIsProjectReady(true);
    }

    prepareProject();

    return () => {
      isMounted = false;
    };
  }, [loadLastStudioProject]);

  const handleCreateProject = useCallback(
    async (name: string, videoType: StudioVideoTypeId) => {
      const trimmedName = name.trim();
      if (!trimmedName) return;

      setIsCreatingProject(true);
      try {
        const newProjectId = await createProject(trimmedName, { studio: true, videoType });

        if (!newProjectId) {
          setProjectError(
            'Unable to create a new movie idea. Check the Supabase connection and table policies.',
          );
          return;
        }

        setProjectError(null);
        setSelectedStoryboardSceneId(null);
        await listStudioProjects();
        setIsProjectReady(true);
        setActiveView('idea');
      } finally {
        setIsCreatingProject(false);
      }
    },
    [createProject, listStudioProjects],
  );

  const handleSelectProject = useCallback(
    async (id: string) => {
      if (!id || id === projectId) return;

      const project = await loadProject(id);
      if (!project) {
        setProjectError('Unable to open that movie idea. It may have been deleted.');
        return;
      }

      setProjectError(null);
      setSelectedStoryboardSceneId(null);
      setActiveView('dashboard');
    },
    [loadProject, projectId],
  );

  const handleRequestDeleteProject = useCallback(
    (id: string) => {
      const project = projects.find((item) => item.id === id);
      setProjectToDelete({ id, name: project?.name ?? 'this movie idea' });
    },
    [projects],
  );

  const handleConfirmDeleteProject = useCallback(async () => {
    if (!projectToDelete) return;

    const deletedProjectId = projectToDelete.id;
    const isDeletingActiveProject = deletedProjectId === projectId;

    setIsDeletingProject(true);
    try {
      const wasDeleted = await deleteProject(deletedProjectId);
      if (!wasDeleted) {
        setProjectError('Unable to delete that movie idea. Please try again.');
        return;
      }

      const remainingProjects = await listStudioProjects();

      if (isDeletingActiveProject) {
        setSelectedStoryboardSceneId(null);
        const nextProject = remainingProjects.find((project) => project.id !== deletedProjectId);

        if (nextProject) {
          await handleSelectProject(nextProject.id);
        } else {
          setActiveView('dashboard');
        }
      }
    } finally {
      setIsDeletingProject(false);
      setProjectToDelete(null);
    }
  }, [projectToDelete, projectId, deleteProject, listStudioProjects, handleSelectProject]);

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

    if (projectError && !projectId) {
      return (
        <div className="flex h-full items-center justify-center p-8 text-center text-sm text-red-300">
          {projectError}
        </div>
      );
    }

    if (!projectId) {
      return (
        <ProjectsGallery
          projects={projects}
          activeProjectId={projectId}
          isLoading={isProjectsLoading}
          isCreating={isCreatingProject}
          error={projectsError}
          onCreate={handleCreateProject}
          onSelect={handleSelectProject}
          onDelete={handleRequestDeleteProject}
          onRefresh={listStudioProjects}
        />
      );
    }

    switch (activeView) {
      case 'dashboard': 
        return (
          <StudioDashboard
            onNavigate={setActiveView}
            projectName={projectName}
            videoType={projectVideoType}
            projects={projects}
            activeProjectId={projectId}
            onSelectProject={handleSelectProject}
            onOpenStoryboard={(sceneId) => {
              setSelectedStoryboardSceneId(sceneId);
              setActiveView('storyboards');
            }}
          />
        );
      case 'projects':
        return (
          <ProjectsGallery
            projects={projects}
            activeProjectId={projectId}
            isLoading={isProjectsLoading}
            isCreating={isCreatingProject}
            error={projectsError}
            onCreate={handleCreateProject}
            onSelect={handleSelectProject}
            onDelete={handleRequestDeleteProject}
            onRefresh={listStudioProjects}
          />
        );
      case 'idea':
        return (
          <MovieIdea
            projectId={projectId}
            projectName={projectName}
            videoType={projectVideoType}
            onNavigateToCharacters={() => setActiveView('characters')}
            onNavigateToOutline={() => setActiveView('outline')}
            onNavigateToScript={() => setActiveView('script')}
          />
        );
      case 'outline':
        // Non-narrative video types skip the outline stage entirely.
        if (!isNarrativeProject) {
          return (
            <MovieIdea
              projectId={projectId}
              projectName={projectName}
              videoType={projectVideoType}
              onNavigateToCharacters={() => setActiveView('characters')}
              onNavigateToScript={() => setActiveView('script')}
            />
          );
        }
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
      <StudioTopbar
        projectName={projectId ? projectName : 'No project yet'}
        projectId={projectId}
        projects={projects}
        isProjectsLoading={isProjectsLoading}
        isCreatingProject={isCreatingProject}
        onRefreshProjects={listStudioProjects}
        onSelectProject={handleSelectProject}
        onCreateProject={handleCreateProject}
        onDeleteProject={handleRequestDeleteProject}
        onOpenProjects={() => setActiveView('projects')}
      />
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
              <StudioSidebar activeView={activeView} videoType={projectVideoType} onNavigate={(view) => {
                setActiveView(view);
                setIsSidebarVisible(false);
              }} />
            </div>
          </div>
        </div>

        {/* Main Content Area Workspace */}
        <main className="flex-1 overflow-auto bg-[#0A0A0B] relative flex flex-col hide-scrollbar ml-4 mr-4">
          {projectError && projectId && (
            <div className="m-4 flex items-start justify-between gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              <span>{projectError}</span>
              <button
                type="button"
                onClick={() => setProjectError(null)}
                className="shrink-0 text-xs font-semibold uppercase tracking-wide text-rose-300 hover:text-rose-100"
              >
                Dismiss
              </button>
            </div>
          )}
          {/* Remount on project switch so per-project local state resets */}
          <div key={projectId ?? 'no-project'} className="flex min-h-0 flex-1 flex-col">
            {renderWorkspace()}
          </div>
        </main>
      </div>
      <StudioBottomPanel activeView={activeView} />

      <DeleteConfirmationModal
        isOpen={Boolean(projectToDelete)}
        title="Delete project?"
        message={
          projectToDelete
            ? `"${projectToDelete.name}" and all of its documents will be permanently deleted. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete project"
        isPending={isDeletingProject}
        onConfirm={() => {
          void handleConfirmDeleteProject();
        }}
        onCancel={() => {
          if (!isDeletingProject) setProjectToDelete(null);
        }}
      />

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
