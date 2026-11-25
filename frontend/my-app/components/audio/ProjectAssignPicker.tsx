"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Clapperboard } from 'lucide-react';
import { type AudioOverview, getAudioOverview } from '@/lib/api/audio';
import { useProject } from '@/lib/useProject';
import { EmptyState, ErrorBanner, NotConfiguredNotice, SkeletonRows } from './Feedback';
import { errorText } from './shared';

export interface PickedProject {
  projectId: string;
  projectName: string;
  overview: AudioOverview;
}

/**
 * Voices are designed and cloned for a Studio project, so its cast can use them.
 * This picks the project and loads its cast; `children` renders the form for it.
 */
export function ProjectAssignPicker({ children }: { children: (picked: PickedProject, reload: () => void) => React.ReactNode }) {
  const { projects, isProjectsLoading, projectsError, listStudioProjects } = useProject();
  const [projectId, setProjectId] = useState<string>('');
  const [overview, setOverview] = useState<AudioOverview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasListed, setHasListed] = useState(false);

  useEffect(() => {
    void listStudioProjects().then((list) => {
      setHasListed(true);
      setProjectId((current) => current || list[0]?.id || '');
    });
  }, [listStudioProjects]);

  const loadOverview = useCallback(async () => {
    if (!projectId) { setOverview(null); return; }
    setIsLoading(true);
    setError(null);
    try {
      setOverview(await getAudioOverview(projectId));
    } catch (reason) {
      setOverview(null);
      setError(errorText(reason, 'Failed to load the project cast.'));
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  if (!hasListed || (isProjectsLoading && projects.length === 0)) return <SkeletonRows count={2} />;
  if (projectsError) return <ErrorBanner message={projectsError} onRetry={() => void listStudioProjects()} />;
  if (projects.length === 0) {
    return (
      <EmptyState
        icon={Clapperboard}
        title="Create a story project first"
        action={<Link href="/studio" className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-bold text-white hover:bg-purple-500">Open Studio</Link>}
      >
        Voices are saved to a Studio project so its narrator and characters can use them.
      </EmptyState>
    );
  }

  const projectName = projects.find((project) => project.id === projectId)?.name ?? 'Untitled';
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="audio-project" className="block text-sm font-medium text-zinc-300">Project</label>
        <select
          id="audio-project"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          className="mt-1.5 h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100"
        >
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <p className="mt-1.5 text-xs text-zinc-400">The voice can go to this project&apos;s narrator or one of its characters.</p>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void loadOverview()} />}
      {isLoading && !overview && <SkeletonRows count={2} />}
      {overview && !overview.configured && <NotConfiguredNotice />}
      {overview && overview.configured && children({ projectId, projectName, overview }, () => void loadOverview())}
    </div>
  );
}
