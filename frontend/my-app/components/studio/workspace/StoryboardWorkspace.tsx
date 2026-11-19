"use client";

import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import Image from 'next/image';
import { 
  AlertCircle, ArrowLeft, Clapperboard, Image as ImageIcon, 
  RefreshCw, Sparkles, ChevronDown, User, MountainSnow, Box, Edit2, Check, Film, RotateCcw
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { characterTags, characterTheme } from '@/lib/characterTheme';
import type { StoryboardCharacterLabel } from '@/lib/types/image-generation';
import { generateSceneStoryboard, regenerateShotFrame } from '@/lib/api/image-generation';
import { DEFAULT_STORYBOARD_MODEL, StoryboardModelPicker } from './StoryboardModelPicker';
import {
  getShotVideoBatch,
  retryFailedShotVideos,
  ShotVideoBatchResponse,
  startShotVideoBatch,
} from '@/lib/api/video-generation';

interface StoryboardWorkspaceProps {
  projectId: string | null;
  sceneId: string | null;
  onBackToScenes: () => void;
  onSelectScene?: (id: string) => void;
}

interface SceneRecord {
  id: string;
  slugline_raw: string | null;
  sort_order?: number;
}

interface ShotRecord {
  id: string;
  shot_number: number | null;
  description: string | null;
  camera_angle: string | null;
  camera_motion: string | null;
  prompt?: string | null;
  status: string;
  sort_order: number;
  metadata?: { characters?: StoryboardCharacterLabel[] | null } | null;
}

interface EntityBadge {
  id: string;
  name: string;
  type: 'character' | 'environment' | 'object';
  tags?: string[];
}

/** Character name plus its tag aliases, colored so each character stays recognizable. */
function CharacterChip({ character, compact = false }: { character: StoryboardCharacterLabel; compact?: boolean }): JSX.Element {
  const theme = characterTheme(character);
  const tags = characterTags(character);
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full border font-semibold ${
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]'
      }`}
      style={{ borderColor: theme.border, backgroundColor: theme.soft, color: theme.accent }}
      title={tags.length > 0 ? `Tags: ${tags.join(', ')}` : character.name}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: theme.accent }} />
      <span className="truncate">{character.name}</span>
      {tags.map((tag) => (
        <span
          key={tag}
          className="shrink-0 rounded bg-black/40 px-1 text-[9px] font-medium uppercase tracking-wide"
          style={{ color: theme.accent }}
        >
          {tag}
        </span>
      ))}
    </span>
  );
}

export function StoryboardWorkspace({ 
  projectId, 
  sceneId, 
  onBackToScenes,
  onSelectScene,
}: StoryboardWorkspaceProps): JSX.Element {
  const [allScenes, setAllScenes] = useState<SceneRecord[]>([]);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(sceneId);
  const [scene, setScene] = useState<SceneRecord | null>(null);
  const [shots, setShots] = useState<ShotRecord[]>([]);
  const [imageByShot, setImageByShot] = useState<Record<string, string>>({});
  const [videoByShot, setVideoByShot] = useState<Record<string, string>>({});
  const [entities, setEntities] = useState<EntityBadge[]>([]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<{ percent: number; statusText: string }>({ percent: 0, statusText: '' });
  const [regeneratingShotId, setRegeneratingShotId] = useState<string | null>(null);
  const [editingShotId, setEditingShotId] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [storyboardModel, setStoryboardModelState] = useState<string>(DEFAULT_STORYBOARD_MODEL);
  // Remember the chosen model per project in this browser (a convenience; the server default still applies elsewhere).
  useEffect(() => {
    if (!projectId) return;
    try {
      const saved = window.localStorage.getItem(`storyboard-model:${projectId}`);
      setStoryboardModelState(saved || DEFAULT_STORYBOARD_MODEL);
    } catch { /* storage unavailable: keep the default */ }
  }, [projectId]);
  const setStoryboardModel = useCallback((modelId: string) => {
    setStoryboardModelState(modelId);
    if (!projectId) return;
    try { window.localStorage.setItem(`storyboard-model:${projectId}`, modelId); } catch { /* storage unavailable */ }
  }, [projectId]);
  const [videoBatch, setVideoBatch] = useState<ShotVideoBatchResponse | null>(null);
  const [isQueueingVideos, setIsQueueingVideos] = useState(false);
  // 0 = auto: each shot uses the clip length planned from the runtime budget.
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoResolution, setVideoResolution] = useState<'480p' | '720p' | '1080p' | '4k'>('720p');
  const [videoAudio, setVideoAudio] = useState(true);

  // Fetch all project scenes for selector dropdown
  useEffect(() => {
    if (!projectId) return;
    const fetchScenes = async () => {
      const { data } = await supabase
        .from('scenes')
        .select('id, slugline_raw, title, sort_order')
        .eq('project_id', projectId)
        // Storyboards are made per leaf unit (scene, section, segment), never per act or chapter.
        .eq('is_leaf', true)
        .order('sort_order', { ascending: true });
      if (data && data.length > 0) {
        setAllScenes(
          (data as (SceneRecord & { title?: string | null })[]).map((row) => ({
            ...row,
            slugline_raw: row.slugline_raw || row.title || 'Untitled',
          }))
        );
        if (!activeSceneId) {
          setActiveSceneId(data[0].id);
        }
      }
    };
    void fetchScenes();
  }, [projectId, activeSceneId]);

  useEffect(() => {
    if (sceneId) setActiveSceneId(sceneId);
  }, [sceneId]);

  useEffect(() => {
    if (!projectId || !activeSceneId) {
      setScene(null);
      setShots([]);
      setImageByShot({});
      setVideoByShot({});
      setEntities([]);
      return;
    }

    let isMounted = true;
    const loadStoryboard = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const { data: sceneRow, error: sceneError } = await supabase
          .from('scenes')
          .select('id, slugline_raw, title, sort_order')
          .eq('id', activeSceneId)
          .eq('project_id', projectId)
          .single();
        if (sceneError) throw sceneError;
        const sceneData = sceneRow
          ? { ...sceneRow, slugline_raw: sceneRow.slugline_raw || sceneRow.title || 'Untitled' }
          : sceneRow;

        const { data: shotsData, error: shotsError } = await supabase
          .from('shots')
          .select('id, shot_number, description, camera_angle, camera_motion, prompt, status, sort_order, metadata')
          .eq('scene_id', activeSceneId)
          .eq('project_id', projectId)
          .order('sort_order', { ascending: true });
        if (shotsError) throw shotsError;

        const loadedShots = (shotsData ?? []) as ShotRecord[];
        const shotIds = loadedShots.map((shot) => shot.id);
        const loadedImageByShot: Record<string, string> = {};
        const loadedVideoByShot: Record<string, string> = {};

        if (shotIds.length > 0) {
          const { data: linksData, error: linksError } = await supabase
            .from('asset_links')
            .select('target_id, asset_id, role')
            .eq('project_id', projectId)
            .eq('target_type', 'shot')
            .in('role', ['storyboard', 'video'])
            .in('target_id', shotIds);
          if (linksError) throw linksError;

          const links = (linksData ?? []) as { target_id: string; asset_id: string; role: 'storyboard' | 'video' }[];
          const assetIds = links.map((link) => link.asset_id);
          if (assetIds.length > 0) {
            const { data: assetsData, error: assetsError } = await supabase
              .from('assets')
              .select('id, url')
              .in('id', assetIds);
            if (assetsError) throw assetsError;

            const urlByAsset = new Map(
              ((assetsData ?? []) as { id: string; url: string }[]).map((asset) => [asset.id, asset.url]),
            );
            for (const link of links) {
              const assetUrl = urlByAsset.get(link.asset_id);
              if (assetUrl && link.role === 'storyboard') loadedImageByShot[link.target_id] = assetUrl;
              if (assetUrl && link.role === 'video') loadedVideoByShot[link.target_id] = assetUrl;
            }
          }
        }

        // Fetch scene linked entity badges (Characters, Environments, Objects)
        const fetchedBadges: EntityBadge[] = [];
        const { data: chars } = await supabase.from('characters').select('id, name, tags').eq('project_id', projectId);
        (chars ?? []).forEach(c => fetchedBadges.push({ id: c.id, name: c.name, type: 'character', tags: (c.tags as string[] | null) ?? [] }));

        const { data: envs } = await supabase.from('environments').select('id, name').eq('project_id', projectId);
        (envs ?? []).forEach(e => fetchedBadges.push({ id: e.id, name: e.name, type: 'environment' }));

        const { data: objs } = await supabase.from('props').select('id, name').eq('project_id', projectId);
        (objs ?? []).forEach(o => fetchedBadges.push({ id: o.id, name: o.name, type: 'object' }));

        if (isMounted) {
          setScene(sceneData as SceneRecord);
          setShots(loadedShots);
          setImageByShot(loadedImageByShot);
          setVideoByShot(loadedVideoByShot);
          setEntities(fetchedBadges);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load storyboard.');
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    void loadStoryboard();
    return () => { isMounted = false; };
  }, [projectId, activeSceneId]);

  useEffect(() => {
    if (!projectId || !videoBatch || !['queued', 'running'].includes(videoBatch.status)) return;
    const interval = window.setInterval(() => {
      void getShotVideoBatch(projectId, videoBatch.batch_id)
        .then((batch) => {
          setVideoBatch(batch);
          setVideoByShot((previous) => {
            const next = { ...previous };
            batch.jobs.forEach((job) => {
              if (job.video_url) next[job.shot_id] = job.video_url;
            });
            return next;
          });
        })
        .catch((statusError) => setError(statusError instanceof Error ? statusError.message : 'Failed to refresh video render status.'));
    }, 4000);
    return () => window.clearInterval(interval);
  }, [projectId, videoBatch]);

  const handleGenerateStoryboard = async (force: boolean = false) => {
    if (!projectId || !activeSceneId) return;
    setIsGenerating(true);
    setGenerationProgress({ percent: 10, statusText: 'Analyzing screenplay & scene context...' });
    setError(null);

    const progressInterval = setInterval(() => {
      setGenerationProgress((prev) => {
        if (prev.percent < 30) {
          return { percent: prev.percent + 5, statusText: 'Extracting keyframes, environments & objects...' };
        } else if (prev.percent < 85) {
          return { percent: prev.percent + 4, statusText: `Generating 16:9 shot stills (${prev.percent}%)...` };
        } else if (prev.percent < 95) {
          return { percent: prev.percent + 1, statusText: 'Saving images & linking assets...' };
        }
        return prev;
      });
    }, 800);

    try {
      const res = await generateSceneStoryboard({
        project_id: projectId,
        scene_id: activeSceneId,
        force_regenerate: force,
        provider: 'wavespeed',
        model: storyboardModel,
      });

      clearInterval(progressInterval);
      setGenerationProgress({ percent: 100, statusText: 'Completed!' });

      const updatedShots: ShotRecord[] = res.frames.map((f, idx) => ({
        id: f.shot_id,
        shot_number: f.shot_number,
        description: f.description,
        camera_angle: f.camera_angle ?? null,
        camera_motion: f.camera_motion ?? null,
        prompt: f.prompt,
        status: f.status,
        sort_order: idx,
        metadata: { characters: f.characters ?? [] },
      }));
      setShots(updatedShots);

      const newImages: Record<string, string> = {};
      res.frames.forEach((f) => {
        if (f.image_url) newImages[f.shot_id] = f.image_url;
      });
      setImageByShot(newImages);
    } catch (genError) {
      clearInterval(progressInterval);
      setError(genError instanceof Error ? genError.message : 'Failed to generate storyboard.');
    } finally {
      setIsGenerating(false);
      setTimeout(() => {
        setGenerationProgress({ percent: 0, statusText: '' });
      }, 1200);
    }
  };

  const handleRegenerateSingleShot = async (shot: ShotRecord) => {
    if (!projectId) return;
    setRegeneratingShotId(shot.id);
    setError(null);
    try {
      const res = await regenerateShotFrame({
        project_id: projectId,
        shot_id: shot.id,
        prompt_override: promptDraft || shot.prompt || undefined,
        provider: 'wavespeed',
        model: storyboardModel,
      });

      if (res.image_url) {
        setImageByShot((prev) => ({ ...prev, [shot.id]: res.image_url! }));
        setShots((prev) =>
          prev.map((s) => (s.id === shot.id ? { ...s, prompt: res.prompt, status: 'complete' } : s))
        );
      }
      setEditingShotId(null);
      setPromptDraft('');
    } catch (regError) {
      setError(regError instanceof Error ? regError.message : 'Failed to regenerate frame.');
    } finally {
      setRegeneratingShotId(null);
    }
  };

  const applyVideoBatch = (batch: ShotVideoBatchResponse) => {
    setVideoBatch(batch);
    setVideoByShot((previous) => {
      const next = { ...previous };
      batch.jobs.forEach((job) => {
        if (job.video_url) next[job.shot_id] = job.video_url;
      });
      return next;
    });
  };

  const handleGenerateProjectVideos = async () => {
    if (!projectId || isQueueingVideos) return;
    setIsQueueingVideos(true);
    setError(null);
    try {
      applyVideoBatch(await startShotVideoBatch({
        project_id: projectId,
        duration: videoDuration || 5,
        use_shot_durations: videoDuration === 0,
        resolution: videoResolution,
        aspect_ratio: '16:9',
        generate_audio: videoAudio,
      }));
    } catch (videoError) {
      setError(videoError instanceof Error ? videoError.message : 'Failed to queue shot videos.');
    } finally {
      setIsQueueingVideos(false);
    }
  };

  const handleRetryFailedVideos = async () => {
    if (!projectId || !videoBatch || isQueueingVideos) return;
    setIsQueueingVideos(true);
    setError(null);
    try {
      applyVideoBatch(await retryFailedShotVideos(projectId, videoBatch.batch_id));
    } catch (videoError) {
      setError(videoError instanceof Error ? videoError.message : 'Failed to retry shot videos.');
    } finally {
      setIsQueueingVideos(false);
    }
  };

  const failedFrames = shots.filter((shot) => shot.status === 'failed').length;

  return (
    <div className="h-full overflow-auto bg-[#0A0A0B] px-8 py-8">
      <div className="mx-auto max-w-7xl">
        
        {/* Header & Controls */}
        <div className="mb-7 border-b border-zinc-800/60 pb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <button
                type="button"
                onClick={onBackToScenes}
                className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-200"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Scenes
              </button>
              <div className="flex items-center gap-3">
                <Clapperboard className="h-6 w-6 text-violet-400" />
                
                {/* Scene Dropdown Selector */}
                {allScenes.length > 0 ? (
                  <div className="relative inline-block">
                    <select
                      value={activeSceneId ?? ''}
                      onChange={(e) => {
                        setActiveSceneId(e.target.value);
                        if (onSelectScene) onSelectScene(e.target.value);
                      }}
                      className="appearance-none rounded-lg border border-zinc-700 bg-zinc-900/90 py-1.5 pl-3 pr-8 text-base font-bold text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
                    >
                      {allScenes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.slugline_raw || `Scene ${(s.sort_order ?? 0) + 1}`}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  </div>
                ) : (
                  <h1 className="text-xl font-bold text-zinc-100">{scene?.slugline_raw || 'Scene Storyboard'}</h1>
                )}
              </div>
              <p className="mt-1.5 text-xs text-zinc-400">
                Generating 16:9 static storyboard images using character keyframes, environments, objects, and screenplay action lines.
              </p>
              {videoBatch && (
                <p className="mt-1 text-xs text-cyan-300">
                  Shot video batch: {videoBatch.completed_jobs}/{videoBatch.total_jobs} complete
                  {videoBatch.failed_jobs > 0 ? `, ${videoBatch.failed_jobs} failed` : ''}.
                </p>
              )}
            </div>

            {/* Action Bar */}
            <div className="flex flex-col items-end gap-2">
              <StoryboardModelPicker value={storyboardModel} onChange={setStoryboardModel} disabled={isGenerating || regeneratingShotId !== null} />
              <div className="flex items-center gap-3">
                {shots.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleGenerateStoryboard(true)}
                    disabled={isGenerating}
                    className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
                    Regenerate All
                  </button>
                )}
                
                <button
                  type="button"
                  onClick={() => handleGenerateStoryboard(false)}
                  disabled={isGenerating}
                  className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-violet-600/20 transition-colors hover:bg-violet-500 disabled:opacity-50"
                >
                  <Sparkles className={`h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`} />
                  {isGenerating ? `Generating (${generationProgress.percent}%)...` : shots.length > 0 ? 'Generate New Shots' : 'Generate Storyboard Images'}
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-800/60 pt-2">
                <select
                  value={videoDuration}
                  onChange={(event) => setVideoDuration(Number(event.target.value))}
                  disabled={Boolean(videoBatch && ['queued', 'running'].includes(videoBatch.status))}
                  aria-label="Shot video duration"
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] font-semibold text-zinc-200 disabled:opacity-50"
                >
                  <option value={0}>Auto (fits runtime)</option>
                  {[4, 5, 6, 8, 10, 15].map((duration) => <option key={duration} value={duration}>{duration}s each</option>)}
                </select>
                <select
                  value={videoResolution}
                  onChange={(event) => setVideoResolution(event.target.value as typeof videoResolution)}
                  disabled={Boolean(videoBatch && ['queued', 'running'].includes(videoBatch.status))}
                  aria-label="Shot video resolution"
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] font-semibold text-zinc-200 disabled:opacity-50"
                >
                  {(['480p', '720p', '1080p', '4k'] as const).map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
                </select>
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                  <input type="checkbox" checked={videoAudio} onChange={(event) => setVideoAudio(event.target.checked)} disabled={Boolean(videoBatch && ['queued', 'running'].includes(videoBatch.status))} />
                  Audio
                </label>
                {videoBatch?.failed_jobs ? (
                  <button type="button" onClick={handleRetryFailedVideos} disabled={isQueueingVideos || ['queued', 'running'].includes(videoBatch.status)} className="flex items-center gap-1.5 rounded-md border border-amber-500/40 px-3 py-1.5 text-[11px] font-bold text-amber-200 hover:bg-amber-500/10 disabled:opacity-50">
                    <RotateCcw className={`h-3.5 w-3.5 ${isQueueingVideos ? 'animate-spin' : ''}`} /> Retry Failed
                  </button>
                ) : (
                  <button type="button" onClick={handleGenerateProjectVideos} disabled={isQueueingVideos || Boolean(videoBatch && ['queued', 'running'].includes(videoBatch.status))} className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-cyan-500 disabled:opacity-50">
                    <Film className={`h-3.5 w-3.5 ${isQueueingVideos ? 'animate-pulse' : ''}`} />
                    {videoBatch && ['queued', 'running'].includes(videoBatch.status) ? 'Rendering Project Videos...' : 'Render Project Videos'}
                  </button>
                )}
              </div>

              {/* Inline Progress Bar & Status Text */}
              {isGenerating && (
                <div className="w-64 space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-[11px] font-medium text-zinc-400">
                    <span className="truncate pr-2">{generationProgress.statusText}</span>
                    <span className="font-mono text-violet-400 font-bold">{generationProgress.percent}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full bg-gradient-to-r from-violet-600 to-indigo-500 transition-all duration-300 ease-out"
                      style={{ width: `${generationProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Multimodal Context Badges */}
          {entities.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-800/40">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Context Assets:</span>
              {entities.map((e) => {
                const theme = e.type === 'character' ? characterTheme(e) : null;
                return (
                  <span
                    key={e.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 px-2.5 py-0.5 text-[11px] font-medium text-zinc-300"
                    style={theme ? { borderColor: theme.border, backgroundColor: theme.soft, color: theme.accent } : undefined}
                    title={e.tags && e.tags.length > 0 ? `Tags: ${e.tags.join(', ')}` : undefined}
                  >
                    {e.type === 'character' && <User className="h-3 w-3" />}
                    {e.type === 'environment' && <MountainSnow className="h-3 w-3 text-emerald-400" />}
                    {e.type === 'object' && <Box className="h-3 w-3 text-amber-400" />}
                    {e.name}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <div className="mb-5 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Content Area */}
        {isLoading || isGenerating ? (
          <div className="flex min-h-80 flex-col items-center justify-center gap-3 text-sm text-zinc-400">
            <RefreshCw className="h-8 w-8 animate-spin text-violet-500" />
            <p className="font-semibold text-zinc-200">Generating 16:9 Storyboard Images...</p>
            <p className="text-xs text-zinc-500">Integrating character views, environment look, and screenplay action lines.</p>
          </div>
        ) : shots.length === 0 ? (
          <div className="flex min-h-80 flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/50">
              <ImageIcon className="h-8 w-8 text-zinc-600" />
            </div>
            <div>
              <p className="font-semibold text-zinc-200">No storyboard images generated yet</p>
              <p className="mt-1 text-xs text-zinc-500">Click &quot;Generate Storyboard Images&quot; above to create scene stills.</p>
            </div>
            <button
              type="button"
              onClick={() => handleGenerateStoryboard(false)}
              className="mt-2 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-violet-600/20 hover:bg-violet-500"
            >
              <Sparkles className="h-4 w-4" />
              Generate Storyboard Images
            </button>
          </div>
        ) : (
          <>
            {failedFrames > 0 && (
              <div className="mb-5 flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {failedFrames} {failedFrames === 1 ? 'frame failed' : 'frames failed'} to generate.
              </div>
            )}

            {/* Storyboard Grid */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {shots.map((shot, index) => {
                const imageUrl = imageByShot[shot.id];
                const videoUrl = videoByShot[shot.id];
                const videoJob = videoBatch?.jobs.find((job) => job.shot_id === shot.id);
                const isRegenerating = regeneratingShotId === shot.id;
                const isEditing = editingShotId === shot.id;
                const cast = shot.metadata?.characters ?? [];

                return (
                  <article key={shot.id} className="group overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/70 shadow-xl transition-all hover:border-zinc-700">
                    
                    {/* 16:9 Image Still */}
                    <div className="relative aspect-video bg-zinc-950">
                      {imageUrl ? (
                        <Image
                          src={imageUrl}
                          alt={`Storyboard frame ${shot.shot_number ?? index + 1}`}
                          fill
                          className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                          sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                          // Load straight from Supabase like the other studio images: the Next.js
                          // optimizer times out (500) fetching large frames from storage.
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-zinc-500">
                          {shot.status === 'failed' ? (
                            <AlertCircle className="h-6 w-6 text-red-400" />
                          ) : (
                            <RefreshCw className="h-6 w-6 animate-spin text-violet-500" />
                          )}
                          <span>{shot.status === 'failed' ? 'Generation failed' : 'Generating image...'}</span>
                        </div>
                      )}

                      {videoUrl && (
                        <video className="absolute inset-0 h-full w-full bg-black object-cover" controls preload="metadata" src={videoUrl} />
                      )}

                      {/* Overlay Shot Badge */}
                      <div className="absolute left-3 top-3 rounded-md bg-black/70 px-2 py-1 backdrop-blur-md">
                        <span className="font-mono text-[11px] font-bold uppercase text-violet-400">
                          Shot {shot.shot_number ?? index + 1}
                        </span>
                      </div>

                      {/* Top Right Action Button */}
                      <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => {
                            if (isEditing) {
                              setEditingShotId(null);
                            } else {
                              setEditingShotId(shot.id);
                              setPromptDraft(shot.prompt || '');
                            }
                          }}
                          className="rounded-lg bg-black/70 p-2 text-zinc-300 backdrop-blur-md hover:bg-black hover:text-white"
                          title="Edit Shot Prompt"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Frame Details & Prompt Controls */}
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                          {shot.camera_angle || 'Medium Shot'}
                        </span>
                        {shot.camera_motion && (
                          <span className="text-[10px] font-medium text-zinc-500">
                            {shot.camera_motion}
                          </span>
                        )}
                      </div>

                      <p className="text-xs leading-relaxed text-zinc-200 line-clamp-3">
                        {shot.description || 'No description available.'}
                      </p>

                      {cast.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {cast.map((character) => (
                            <CharacterChip key={character.id ?? character.name} character={character} compact />
                          ))}
                        </div>
                      )}

                      {videoJob && !videoUrl && (
                        <p className={`text-[11px] font-medium ${videoJob.status === 'failed' ? 'text-red-300' : 'text-cyan-300'}`}>
                          {videoJob.status === 'failed' ? videoJob.error_message || 'Video render failed.' : `Video render ${videoJob.status.replace('_', ' ')}...`}
                        </p>
                      )}

                      {isEditing ? (
                        <div className="mt-3 space-y-2 rounded-lg border border-zinc-700 bg-zinc-950 p-2.5">
                          <label className="text-[10px] font-bold uppercase text-zinc-400">Custom Image Prompt</label>
                          <textarea
                            value={promptDraft}
                            onChange={(e) => setPromptDraft(e.target.value)}
                            rows={3}
                            className="w-full resize-none rounded bg-zinc-900 p-2 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-violet-500"
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingShotId(null)}
                              className="px-2.5 py-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-200"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRegenerateSingleShot(shot)}
                              disabled={isRegenerating}
                              className="flex items-center gap-1 rounded bg-violet-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-violet-500 disabled:opacity-50"
                            >
                              {isRegenerating ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              Regenerate Still
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="pt-2 border-t border-zinc-800/60 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => handleRegenerateSingleShot(shot)}
                            disabled={isRegenerating}
                            className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-400 hover:text-violet-400 transition-colors disabled:opacity-50"
                          >
                            <RefreshCw className={`h-3 w-3 ${isRegenerating ? 'animate-spin' : ''}`} />
                            {isRegenerating ? 'Regenerating...' : 'Regenerate Image'}
                          </button>
                        </div>
                      )}
                    </div>

                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
