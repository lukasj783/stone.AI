"use client";

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { TimelineState, Project } from '@/lib/types/layers.types';
import { INITIAL_TIMELINE_STATE } from '@/lib/types/layers.types';
import {
  DEFAULT_STUDIO_VIDEO_TYPE,
  resolveVideoType,
  type StudioVideoTypeId,
} from '@/lib/studioVideoTypes';

// ─── Studio project helpers ──────────────────────────────────────────────────

/**
 * Marker written into `projects.settings` for projects created inside the studio.
 * Editor timeline projects never set this, which lets the studio list only its own
 * movie ideas.
 */
export const STUDIO_PROJECT_SOURCE = 'studio';

const STUDIO_PROJECT_LIST_COLUMNS =
  'id, name, description, status, settings, created_at, updated_at';
const STUDIO_PROJECT_LIST_COLUMNS_FALLBACK = 'id, name, created_at, updated_at';

interface ProjectRow {
  id: string;
  name: string;
  description?: string | null;
  status?: string | null;
  settings?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

function isStudioProjectRow(row: ProjectRow, ideaProjectIds: Set<string>): boolean {
  if (row.settings && row.settings.app === STUDIO_PROJECT_SOURCE) return true;
  // Legacy studio projects created before the source marker existed are
  // recognised by their idea document.
  return ideaProjectIds.has(String(row.id));
}

function mapProjectRow(row: ProjectRow): Project {
  return {
    id: String(row.id),
    name: String(row.name ?? 'Untitled'),
    timelineState: INITIAL_TIMELINE_STATE,
    description: row.description ?? null,
    status: row.status ?? undefined,
    settings: row.settings ?? undefined,
    userId: '',
    createdAt: String(row.created_at ?? row.updated_at ?? ''),
    updatedAt: String(row.updated_at ?? row.created_at ?? ''),
  };
}

/**
 * Legacy studio projects have no `videoType` in `projects.settings`; the type
 * only exists in the idea document metadata. Read it so those projects keep
 * their brief/idea pipeline after a reload.
 */
async function loadLegacyIdeaVideoType(
  projectId: string,
): Promise<StudioVideoTypeId | null> {
  const { data, error } = await supabase
    .from('project_documents')
    .select('metadata')
    .eq('project_id', projectId)
    .eq('type', 'idea')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const metadata = (data.metadata as Record<string, unknown> | null) ?? null;
  return typeof metadata?.videoType === 'string'
    ? resolveVideoType(metadata.videoType)
    : null;
}

/** Merge a legacy idea-document video type into project settings. */
function withResolvedVideoType(
  project: Project,
  ideaVideoType: StudioVideoTypeId | null,
): Project {
  if (!ideaVideoType || project.settings?.videoType) return project;
  return {
    ...project,
    settings: {
      ...(project.settings ?? {}),
      app: project.settings?.app ?? STUDIO_PROJECT_SOURCE,
      videoType: ideaVideoType,
    },
  };
}

// ─── Project CRUD Hooks ──────────────────────────────────────────────────────

export function useProject() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('Untitled');
  // Video type of the currently open studio project. Drives the pipeline:
  // narrative types (feature/short film) must pass through the outline stage.
  const [projectVideoType, setProjectVideoType] = useState<StudioVideoTypeId>(
    DEFAULT_STUDIO_VIDEO_TYPE,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isProjectsLoading, setIsProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  // Create a new project in Supabase.
  // Pass { studio: true, videoType } for studio projects so they can be told apart
  // from editor timeline projects and routed to the right production pipeline.
  const createProject = useCallback(async (
    name?: string,
    options?: { studio?: boolean; videoType?: StudioVideoTypeId },
  ): Promise<string | null> => {
    try {
      const projectName = name ?? 'Untitled';
      const resolvedVideoType = resolveVideoType(options?.videoType);
      const basePayload = {
        name: projectName,
        timeline_state: INITIAL_TIMELINE_STATE,
      };
      const payload = options?.studio
        ? {
            ...basePayload,
            settings: { app: STUDIO_PROJECT_SOURCE, videoType: resolvedVideoType },
          }
        : basePayload;

      let { data, error } = await supabase
        .from('projects')
        .insert(payload)
        .select('id')
        .single();

      // Databases that have not applied the studio schema yet have no `settings`
      // column. Fall back to the plain payload; the idea document marks it later.
      if (
        error &&
        options?.studio &&
        (error.code === 'PGRST204' || /settings/i.test(error.message ?? ''))
      ) {
        ({ data, error } = await supabase
          .from('projects')
          .insert(basePayload)
          .select('id')
          .single());
      }

      if (error) throw error;
      if (data) {
        setProjectId(data.id);
        setProjectName(projectName);
        setProjectVideoType(resolvedVideoType);
        setIsDirty(false);
        setLastSavedAt(new Date());
        return data.id;
      }
      return null;
    } catch (err) {
      console.error('Failed to create project:', err);
      return null;
    }
  }, []);

  // Save project to Supabase (create if no ID, update if exists)
  const saveProject = useCallback(async (id: string | null, name: string, timelineState: TimelineState): Promise<boolean> => {
    setIsSaving(true);
    try {
      if (id) {
        // Update existing project
        const { error } = await supabase
          .from('projects')
          .update({
            name,
            timeline_state: timelineState,
          })
          .eq('id', id);

        if (error) throw error;
      } else {
        // Create new project
        const { data, error } = await supabase
          .from('projects')
          .insert({
            name,
            timeline_state: timelineState,
          })
          .select('id')
          .single();

        if (error) throw error;
        if (data) {
          setProjectId(data.id);
        }
      }
      setLastSavedAt(new Date());
      setIsDirty(false);
      return true;
    } catch (err) {
      console.error('Failed to save project:', err);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, []);

  // Load a project from Supabase
  const loadProject = useCallback(async (id: string): Promise<Project | null> => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      if (data) {
        const settings = (data.settings as Record<string, unknown> | null) ?? undefined;
        const project: Project = {
          id: data.id,
          name: data.name,
          timelineState: data.timeline_state,
          description: data.description ?? null,
          status: data.status ?? undefined,
          settings,
          userId: data.user_id,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        };
        const ideaVideoType = settings?.videoType
          ? null
          : await loadLegacyIdeaVideoType(project.id);
        const projectWithType = withResolvedVideoType(project, ideaVideoType);
        setProjectId(project.id);
        setProjectName(project.name);
        setProjectVideoType(resolveVideoType(projectWithType.settings));
        setIsDirty(false);
        setLastSavedAt(new Date(project.updatedAt));
        return projectWithType;
      }
      return null;
    } catch (err) {
      console.error('Failed to load project:', err);
      return null;
    }
  }, []);

  // Load the most recently updated project (for auto-restore on page load)
  const loadLastProject = useCallback(async (): Promise<Project | null> => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        // No projects exist yet — that's fine
        if (error.code === 'PGRST116') return null;
        throw error;
      }
      if (data) {
        const project: Project = {
          id: data.id,
          name: data.name,
          timelineState: data.timeline_state,
          userId: data.user_id,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        };
        setProjectId(project.id);
        setProjectName(project.name);
        setIsDirty(false);
        setLastSavedAt(new Date(project.updatedAt));
        return project;
      }
      return null;
    } catch (err) {
      console.error('Failed to load last project:', err);
      return null;
    }
  }, []);

  // Apply a loaded project to the local hook state
  const applyProject = useCallback((project: Project) => {
    setProjectId(project.id);
    setProjectName(project.name);
    setProjectVideoType(resolveVideoType(project.settings));
    setIsDirty(false);
    setLastSavedAt(project.updatedAt ? new Date(project.updatedAt) : null);
  }, []);

  // Update the video type of an existing studio project (and persist in `settings`).
  const updateProjectVideoType = useCallback(
    async (id: string, nextType: StudioVideoTypeId): Promise<void> => {
      const resolved = resolveVideoType(nextType);
      setProjectVideoType(resolved);
      setProjects((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                settings: { ...(item.settings ?? {}), app: STUDIO_PROJECT_SOURCE, videoType: resolved },
              }
            : item,
        ),
      );

      try {
        await supabase
          .from('projects')
          .update({ settings: { app: STUDIO_PROJECT_SOURCE, videoType: resolved } })
          .eq('id', id);
      } catch (err) {
        console.warn('Could not persist videoType to projects.settings:', err);
      }
    },
    [],
  );

  // Studio-only project list: excludes projects created from the editor timeline.
  const listStudioProjects = useCallback(async (): Promise<Project[]> => {
    setIsProjectsLoading(true);
    setProjectsError(null);
    try {
      const [projectsResult, ideaDocsResult] = await Promise.all([
        supabase
          .from('projects')
          .select(STUDIO_PROJECT_LIST_COLUMNS)
          .order('updated_at', { ascending: false }),
        supabase
          .from('project_documents')
          .select('project_id, metadata')
          .eq('type', 'idea'),
      ]);

      let projectRows = (projectsResult.data ?? []) as unknown as ProjectRow[];
      let projectsQueryError = projectsResult.error;

      // Older databases may miss the optional studio columns — retry with the base set.
      if (projectsQueryError) {
        const fallback = await supabase
          .from('projects')
          .select(STUDIO_PROJECT_LIST_COLUMNS_FALLBACK)
          .order('updated_at', { ascending: false });
        projectRows = (fallback.data ?? []) as unknown as ProjectRow[];
        projectsQueryError = fallback.error;
      }

      if (projectsQueryError) throw projectsQueryError;

      const ideaRows = (ideaDocsResult.data ?? []) as Array<{
        project_id: string;
        metadata?: Record<string, unknown> | null;
      }>;
      const ideaProjectIds = new Set<string>(
        ideaRows.map((row) => String(row.project_id)),
      );
      const ideaVideoTypes = new Map<string, StudioVideoTypeId>();
      ideaRows.forEach((row) => {
        const metadata = row.metadata ?? {};
        if (typeof metadata.videoType === 'string') {
          ideaVideoTypes.set(String(row.project_id), resolveVideoType(metadata.videoType));
        }
      });

      const mappedProjects = projectRows
        .filter((row) => isStudioProjectRow(row, ideaProjectIds))
        .map((row) => {
          const project = mapProjectRow(row);
          return withResolvedVideoType(project, ideaVideoTypes.get(project.id) ?? null);
        });

      setProjects(mappedProjects);
      return mappedProjects;
    } catch (err) {
      console.error('Failed to load studio project list:', err);
      setProjectsError(
        'Unable to load your movie ideas. Check the Supabase connection and table policies.',
      );
      return [];
    } finally {
      setIsProjectsLoading(false);
    }
  }, []);

  // Restore the most recent studio project (never an editor timeline project)
  const loadLastStudioProject = useCallback(async (): Promise<Project | null> => {
    const studioProjects = await listStudioProjects();
    const lastProject = studioProjects[0] ?? null;

    if (lastProject) {
      applyProject(lastProject);
    }

    return lastProject;
  }, [applyProject, listStudioProjects]);

  // Start a new project (resets local state, doesn't persist until save)
  const newProject = useCallback(() => {
    setProjectId(null);
    setProjectName('Untitled');
    setProjectVideoType(DEFAULT_STUDIO_VIDEO_TYPE);
    setIsDirty(true);
    setLastSavedAt(null);
  }, []);

  const listProjects = useCallback(async () => {
    setIsProjectsLoading(true);
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, updated_at')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      
      const mappedProjects: Project[] = (data || []).map((p: { id: string, name: string, updated_at: string }) => ({
        id: p.id,
        name: p.name,
        updatedAt: p.updated_at,
        // Fill other fields with defaults as this is a minimal list view
        timelineState: INITIAL_TIMELINE_STATE,
        userId: '',
        createdAt: p.updated_at
      }));
      setProjects(mappedProjects);
    } catch (err) {
      console.error('Failed to load project list:', err);
    } finally {
      setIsProjectsLoading(false);
    }
  }, []);

  const deleteProject = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      if (projectId === id) {
        newProject();
      }
      
      setProjects(prev => prev.filter(p => p.id !== id));
      return true;
    } catch (err) {
      console.error('Failed to delete project:', err);
      return false;
    }
  }, [projectId, newProject]);

  return {
    projectId,
    projectName,
    setProjectName,
    projectVideoType,
    setProjectVideoType,
    updateProjectVideoType,
    isSaving,
    isDirty,
    setIsDirty,
    lastSavedAt,
    projects,
    isProjectsLoading,
    projectsError,
    createProject,
    saveProject,
    loadProject,
    loadLastProject,
    loadLastStudioProject,
    listStudioProjects,
    newProject,
    listProjects,
    deleteProject,
  };
}
