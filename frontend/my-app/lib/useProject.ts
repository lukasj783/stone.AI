"use client";

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { TimelineState, Project } from '@/lib/types/layers.types';
import { INITIAL_TIMELINE_STATE } from '@/lib/types/layers.types';

// ─── Project CRUD Hooks ──────────────────────────────────────────────────────

export function useProject() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('Untitled');
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isProjectsLoading, setIsProjectsLoading] = useState(false);

  // Create a new project in Supabase
  const createProject = useCallback(async (name?: string): Promise<string | null> => {
    try {
      const projectName = name ?? 'Untitled';
      const { data, error } = await supabase
        .from('projects')
        .insert({
          name: projectName,
          timeline_state: INITIAL_TIMELINE_STATE,
        })
        .select('id')
        .single();

      if (error) throw error;
      if (data) {
        setProjectId(data.id);
        setProjectName(projectName);
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

  // Start a new project (resets local state, doesn't persist until save)
  const newProject = useCallback(() => {
    setProjectId(null);
    setProjectName('Untitled');
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
    isSaving,
    isDirty,
    setIsDirty,
    lastSavedAt,
    projects,
    isProjectsLoading,
    createProject,
    saveProject,
    loadProject,
    loadLastProject,
    newProject,
    listProjects,
    deleteProject,
  };
}
