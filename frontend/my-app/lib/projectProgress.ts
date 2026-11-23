// Real production progress for one studio project, read from Supabase.
//
// loadProjectSnapshot() gathers counts from the project's tables;
// computeProjectProgress() turns them into stage progress and next actions.
// The computation is pure so it can be reasoned about (and tested) without data.

import { isPacing, parseDurationSeconds, type Pacing } from '@/lib/duration';
import { isCharacterOnCamera, loadCharacterTypes } from '@/lib/characterTypes';
import { supabase } from '@/lib/supabaseClient';

export type StageStatus = 'pending' | 'in_progress' | 'complete';

export interface ProjectSnapshot {
  hasIdea: boolean;
  hasOutline: boolean;
  /** Leaf script units (scenes, segments, sections...) in script order. */
  scenes: { id: string; title: string; status: string }[];
  assets: {
    characters: { total: number; withImage: number };
    environments: { total: number; withImage: number };
    props: { total: number; withImage: number };
  };
  /** Scene ids that have at least one finished storyboard frame. */
  storyboardedSceneIds: Set<string>;
  storyboardShots: number;
  videoShots: number;
  timelineItems: number;
  exportStatus: 'complete' | 'running' | 'failed' | null;
  /** Generation jobs queued or running right now, by kind. */
  activeJobs: Record<string, number>;
  runtime: RuntimeSnapshot;
  failures: FailureSnapshot;
}

export interface RuntimeSnapshot {
  /** Runtime chosen on the idea form. */
  targetSeconds: number | null;
  pacing: Pacing | null;
  /** Sum of the script scenes' planned lengths. */
  scriptSeconds: number | null;
  /** Sum of the storyboard shots' planned clip lengths. */
  shotSeconds: number | null;
  /** Planned script length of just the storyboarded scenes (what shotSeconds should match). */
  storyboardedSceneSeconds: number | null;
  storyboardedSceneCount: number;
  /** Sum of the rendered shot clips' lengths. */
  renderedSeconds: number | null;
}

export interface FailureSnapshot {
  /** Script scenes whose writing failed. */
  scenes: { id: string; title: string }[];
  /** Scenes whose latest storyboard run failed and that have no storyboard. */
  storyboards: { sceneId: string; title: string; error: string | null }[];
  /** Shots whose latest video render failed and that have no video. */
  videos: { count: number; batchId: string | null; error: string | null };
}

export interface StageProgress {
  id: 'story' | 'assets' | 'storyboard' | 'video' | 'edit' | 'export';
  label: string;
  /** Studio view the stage opens. */
  view: string;
  progress: number;
  status: StageStatus;
  /** Short fact under the stage, e.g. "12 / 20 scenes". */
  detail: string;
  /** Work for this stage is generating right now. */
  isRunning: boolean;
}

export type NextActionIcon = 'idea' | 'script' | 'assets' | 'storyboard' | 'video' | 'timeline' | 'export';

export interface NextAction {
  key: string;
  title: string;
  subtitle: string;
  view: string;
  icon: NextActionIcon;
  /** Open this scene in the storyboard view. */
  sceneId?: string;
}

export interface ProjectProgress {
  overall: number;
  stages: StageProgress[];
  nextActions: NextAction[];
  runtime: RuntimeSnapshot;
  failures: FailureSnapshot;
  /** Generation jobs queued or running right now, by kind. */
  activeJobs: Record<string, number>;
}

// Share of overall progress per stage (sums to 100).
const STAGE_WEIGHTS: Record<StageProgress['id'], number> = {
  story: 20,
  assets: 15,
  storyboard: 20,
  video: 25,
  edit: 10,
  export: 10,
};

const ratio = (done: number, total: number): number => (total > 0 ? Math.min(1, done / total) : 0);
const percent = (value: number): number => Math.round(value * 100);
const statusOf = (progress: number): StageStatus =>
  progress >= 100 ? 'complete' : progress > 0 ? 'in_progress' : 'pending';
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

export function computeProjectProgress(snapshot: ProjectSnapshot, isNarrative: boolean): ProjectProgress {
  const { scenes, assets } = snapshot;
  const sceneCount = scenes.length;
  const writtenScenes = scenes.filter((scene) => scene.status === 'complete').length;
  const scriptShare = ratio(writtenScenes, sceneCount);

  // Story: idea (+ outline for films) then the written script.
  const storyParts = isNarrative
    ? [snapshot.hasIdea ? 1 : 0, snapshot.hasOutline ? 1 : 0, scriptShare * 3]
    : [snapshot.hasIdea ? 1 : 0, scriptShare * 3];
  const storyProgress = percent(storyParts.reduce((a, b) => a + b, 0) / (isNarrative ? 5 : 4));

  const assetTotal = assets.characters.total + assets.environments.total + assets.props.total;
  const assetDone = assets.characters.withImage + assets.environments.withImage + assets.props.withImage;
  // A finished script with no characters, locations or objects (an ad, say) needs no assets.
  const noAssetsNeeded = assetTotal === 0 && sceneCount > 0 && writtenScenes === sceneCount;
  const storyboarded = scenes.filter((scene) => snapshot.storyboardedSceneIds.has(scene.id)).length;
  const exportProgress = snapshot.exportStatus === 'complete' ? 100 : snapshot.exportStatus === 'running' ? 50 : 0;
  const running = (kind: string) => (snapshot.activeJobs[kind] ?? 0) > 0;

  const stageData: Omit<StageProgress, 'status'>[] = [
    {
      id: 'story',
      label: 'Story',
      view: sceneCount ? 'script' : 'idea',
      progress: storyProgress,
      detail: sceneCount
        ? `${writtenScenes} / ${sceneCount} scenes written`
        : snapshot.hasIdea
          ? isNarrative && !snapshot.hasOutline ? 'Idea saved · no outline' : 'No script yet'
          : 'No idea yet',
      isRunning: scenes.some((scene) => scene.status === 'in_progress'),
    },
    {
      id: 'assets',
      label: 'Assets',
      view: 'characters',
      progress: noAssetsNeeded ? 100 : percent(ratio(assetDone, assetTotal)),
      detail: assetTotal ? `${assetDone} / ${assetTotal} with images` : noAssetsNeeded ? 'None needed' : 'None extracted yet',
      isRunning: running('character') || running('environment') || running('prop') || running('image'),
    },
    {
      id: 'storyboard',
      label: 'Storyboard',
      view: 'storyboards',
      progress: percent(ratio(storyboarded, sceneCount)),
      detail: sceneCount ? `${storyboarded} / ${sceneCount} scenes` : 'Needs a script',
      isRunning: running('storyboard'),
    },
    {
      id: 'video',
      label: 'Video',
      view: 'shot_list',
      progress: percent(ratio(snapshot.videoShots, snapshot.storyboardShots)),
      detail: snapshot.storyboardShots
        ? `${snapshot.videoShots} / ${snapshot.storyboardShots} shots rendered`
        : 'Needs storyboards',
      isRunning: running('video'),
    },
    {
      id: 'edit',
      label: 'Edit',
      view: 'timeline',
      progress: percent(ratio(snapshot.timelineItems, snapshot.videoShots)),
      detail: snapshot.videoShots
        ? `${Math.min(snapshot.timelineItems, snapshot.videoShots)} / ${snapshot.videoShots} clips on timeline`
        : 'Needs video clips',
      isRunning: false,
    },
    {
      id: 'export',
      label: 'Export',
      view: 'publish',
      progress: exportProgress,
      detail:
        snapshot.exportStatus === 'complete' ? 'Exported'
          : snapshot.exportStatus === 'running' ? 'Exporting...'
            : snapshot.exportStatus === 'failed' ? 'Last export failed'
              : 'Not exported',
      isRunning: snapshot.exportStatus === 'running',
    },
  ];
  const stages = stageData.map((stage) => ({ ...stage, status: statusOf(stage.progress) }));
  const overall = Math.round(
    stages.reduce((sum, stage) => sum + stage.progress * STAGE_WEIGHTS[stage.id], 0) / 100,
  );

  return {
    overall,
    stages,
    nextActions: nextActions(snapshot, isNarrative),
    runtime: snapshot.runtime,
    failures: snapshot.failures,
    activeJobs: snapshot.activeJobs,
  };
}

function nextActions(snapshot: ProjectSnapshot, isNarrative: boolean): NextAction[] {
  const actions: NextAction[] = [];
  const { scenes, assets } = snapshot;

  if (!snapshot.hasIdea) {
    actions.push({
      key: 'idea',
      title: isNarrative ? 'Write your movie idea' : 'Write your creative brief',
      subtitle: 'Start here: runtime, pacing, story',
      view: 'idea',
      icon: 'idea',
    });
  } else if (isNarrative && !snapshot.hasOutline && !scenes.length) {
    actions.push({ key: 'outline', title: 'Generate the outline', subtitle: 'Story', view: 'idea', icon: 'idea' });
  }
  if (snapshot.hasIdea && !scenes.length && (!isNarrative || snapshot.hasOutline)) {
    actions.push({
      key: 'script',
      title: 'Generate the script',
      subtitle: 'Story',
      view: isNarrative ? 'outline' : 'idea',
      icon: 'script',
    });
  }

  const unwritten = scenes.filter((scene) => scene.status !== 'complete');
  if (unwritten.length) {
    actions.push({
      key: 'script-unwritten',
      title: `Finish ${plural(unwritten.length, 'scene')}`,
      subtitle: `Script · next: ${unwritten[0].title}`,
      view: 'script',
      icon: 'script',
    });
  }

  const missing = (
    [
      ['characters', 'character', assets.characters],
      ['environments', 'location', assets.environments],
      ['props', 'object', assets.props],
    ] as const
  ).find(([, , counts]) => counts.total > counts.withImage);
  if (missing) {
    const [view, word, counts] = missing;
    actions.push({
      key: `assets-${view}`,
      title: `Generate images for ${plural(counts.total - counts.withImage, word)}`,
      subtitle: 'Assets',
      view,
      icon: 'assets',
    });
  }

  const nextScene = scenes.find(
    (scene) => scene.status === 'complete' && !snapshot.storyboardedSceneIds.has(scene.id),
  );
  if (nextScene) {
    const remaining = scenes.filter((scene) => !snapshot.storyboardedSceneIds.has(scene.id)).length;
    actions.push({
      key: 'storyboard',
      title: `Storyboard ${nextScene.title}`,
      subtitle: `Storyboard · ${plural(remaining, 'scene')} left`,
      view: 'storyboards',
      icon: 'storyboard',
      sceneId: nextScene.id,
    });
  }

  const unrendered = snapshot.storyboardShots - snapshot.videoShots;
  if (unrendered > 0) {
    actions.push({
      key: 'video',
      title: `Render ${plural(unrendered, 'shot video')}`,
      subtitle: 'Video · Shot List',
      view: 'shot_list',
      icon: 'video',
    });
  }

  const offTimeline = snapshot.videoShots - snapshot.timelineItems;
  if (offTimeline > 0) {
    actions.push({
      key: 'timeline',
      title: `Add ${plural(offTimeline, 'clip')} to the timeline`,
      subtitle: 'Edit',
      view: 'shot_list',
      icon: 'timeline',
    });
  }

  if (snapshot.videoShots > 0 && snapshot.exportStatus !== 'complete' && actions.length < 4) {
    actions.push({ key: 'export', title: 'Export the film', subtitle: 'Export', view: 'publish', icon: 'export' });
  }
  return actions.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const PAGE = 1000;

/** Fetch every row of a query, 1000 at a time (PostgREST caps a single response). */
async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

async function countRows(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

type EntityRow = { primary_asset_id: string | null };
const entityCounts = (rows: EntityRow[]) => ({
  total: rows.length,
  withImage: rows.filter((row) => row.primary_asset_id).length,
});

export async function loadProjectSnapshot(projectId: string): Promise<ProjectSnapshot> {
  const [docs, scenes, characterRows, environments, props, shots, videoLinks, timelineItems, exports, jobs, characterTypes] =
    await Promise.all([
      fetchAll<{ type: string; metadata: Record<string, unknown> | null }>((from, to) =>
        supabase.from('project_documents').select('type, metadata').eq('project_id', projectId).range(from, to),
      ),
      fetchAll<{
        id: string;
        title: string | null;
        slugline_raw: string | null;
        status: string;
        duration_seconds: number | null;
      }>((from, to) =>
        supabase
          .from('scenes')
          .select('id, title, slugline_raw, status, duration_seconds')
          .eq('project_id', projectId)
          .eq('is_leaf', true)
          .order('sort_order')
          .range(from, to),
      ),
      fetchAll<EntityRow & { character_type: string | null; on_camera: boolean | null; metadata: Record<string, unknown> | null }>((from, to) =>
        supabase.from('characters').select('primary_asset_id, character_type, on_camera, metadata').eq('project_id', projectId).range(from, to),
      ),
      fetchAll<EntityRow>((from, to) =>
        supabase
          .from('environments')
          .select('primary_asset_id')
          .eq('project_id', projectId)
          .eq('metadata->>source', 'script')
          .range(from, to),
      ),
      fetchAll<EntityRow>((from, to) =>
        supabase.from('props').select('primary_asset_id').eq('project_id', projectId).range(from, to),
      ),
      fetchAll<{ id: string; scene_id: string; status: string; duration_seconds: number | null }>((from, to) =>
        supabase.from('shots').select('id, scene_id, status, duration_seconds').eq('project_id', projectId).range(from, to),
      ),
      fetchAll<{ target_id: string; asset_id: string }>((from, to) =>
        supabase
          .from('asset_links')
          .select('target_id, asset_id')
          .eq('project_id', projectId)
          .eq('target_type', 'shot')
          .eq('role', 'video')
          .range(from, to),
      ),
      // Optional: a missing timeline table only leaves the Edit stage at 0.
      countRows(
        supabase.from('timeline_items').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
      ).catch(() => 0),
      supabase
        .from('exports')
        .select('status')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1),
      loadGenerationJobs(projectId),
      // Optional: without the type list every character counts as on camera.
      loadCharacterTypes(projectId).then(({ types }) => types).catch(() => new Map()),
    ]);
  // Voice-only characters (narrators) are never drawn, so they need no image.
  const characters = characterRows.filter((row) => isCharacterOnCamera(row, characterTypes));

  const sceneList = scenes.map((scene, index) => ({
    id: scene.id,
    title: scene.title || scene.slugline_raw || `Scene ${index + 1}`,
    status: scene.status,
  }));
  const titleById = new Map(sceneList.map((scene) => [scene.id, scene.title]));
  // A shot is marked complete once its storyboard frame is saved.
  const storyboardShots = shots.filter((shot) => shot.status === 'complete');
  const storyboardedSceneIds = new Set(storyboardShots.map((shot) => shot.scene_id));
  const shotsWithVideo = new Set(videoLinks.map((link) => link.target_id));

  const activeJobs: Record<string, number> = {};
  const latestStoryboardJob = new Map<string, GenerationJobRow>();
  const latestVideoJob = new Map<string, GenerationJobRow>();
  for (const job of jobs) {
    if (job.status === 'queued' || job.status === 'running') {
      activeJobs[job.kind] = (activeJobs[job.kind] ?? 0) + 1;
    }
    if (job.kind === 'storyboard' && job.scene_id && !latestStoryboardJob.has(job.scene_id)) {
      latestStoryboardJob.set(job.scene_id, job);
    }
    if (job.kind === 'video' && job.shot_id && !latestVideoJob.has(job.shot_id)) {
      latestVideoJob.set(job.shot_id, job);
    }
  }
  const failedVideoJobs = [...latestVideoJob.entries()]
    .filter(([shotId, job]) => job.status === 'failed' && !shotsWithVideo.has(shotId))
    .map(([, job]) => job);

  const idea = docs.find((doc) => doc.type === 'idea');
  const ideaMetadata = idea?.metadata ?? {};
  const brief = (ideaMetadata.brief as Record<string, unknown> | undefined) ?? {};
  const latestExport = (exports.data?.[0]?.status as string | undefined) ?? null;
  const sum = (values: (number | null)[]): number | null => {
    const known = values.filter((value): value is number => typeof value === 'number' && value > 0);
    return known.length ? known.reduce((a, b) => a + Number(b), 0) : null;
  };

  return {
    hasIdea: Boolean(idea),
    hasOutline: docs.some((doc) => doc.type === 'outline'),
    scenes: sceneList,
    assets: {
      characters: entityCounts(characters),
      environments: entityCounts(environments),
      props: entityCounts(props),
    },
    storyboardedSceneIds,
    storyboardShots: storyboardShots.length,
    videoShots: shotsWithVideo.size,
    timelineItems,
    exportStatus:
      latestExport === 'complete' ? 'complete'
        : latestExport === 'queued' || latestExport === 'running' ? 'running'
          : latestExport === 'failed' ? 'failed'
            : null,
    activeJobs,
    runtime: {
      targetSeconds: parseDurationSeconds(
        (typeof ideaMetadata.duration === 'string' && ideaMetadata.duration)
          || (typeof brief.duration === 'string' ? brief.duration : ''),
      ),
      pacing: isPacing(ideaMetadata.pacing) ? ideaMetadata.pacing : null,
      scriptSeconds: sum(scenes.map((scene) => scene.duration_seconds)),
      shotSeconds: sum(storyboardShots.map((shot) => shot.duration_seconds)),
      storyboardedSceneSeconds: sum(
        scenes.filter((scene) => storyboardedSceneIds.has(scene.id)).map((scene) => scene.duration_seconds),
      ),
      storyboardedSceneCount: scenes.filter((scene) => storyboardedSceneIds.has(scene.id)).length,
      renderedSeconds: await renderedSeconds(videoLinks.map((link) => link.asset_id)),
    },
    failures: {
      scenes: sceneList.filter((scene) => scene.status === 'failed').map(({ id, title }) => ({ id, title })),
      storyboards: [...latestStoryboardJob.entries()]
        .filter(([sceneId, job]) => job.status === 'failed' && !storyboardedSceneIds.has(sceneId))
        .map(([sceneId, job]) => ({
          sceneId,
          title: titleById.get(sceneId) ?? 'Scene',
          error: job.error_message,
        })),
      videos: {
        count: failedVideoJobs.length,
        batchId: failedVideoJobs.find((job) => job.batch_id)?.batch_id ?? null,
        error: failedVideoJobs.find((job) => job.error_message)?.error_message ?? null,
      },
    },
  };
}

interface GenerationJobRow {
  kind: string;
  status: string;
  scene_id: string | null;
  shot_id: string | null;
  batch_id: string | null;
  error_message: string | null;
}

/**
 * The project's generation jobs, newest first (so the first job seen per scene or
 * shot is its latest run). generation_jobs.batch_id only exists once
 * supabase_shot_video_batches.sql has been applied, so the jobs are read without it
 * when it is missing; job status is extra information, so any other error only
 * hides it instead of failing the whole dashboard.
 */
async function loadGenerationJobs(projectId: string): Promise<GenerationJobRow[]> {
  const read = (columns: string) =>
    fetchAll<GenerationJobRow>((from, to) =>
      supabase
        .from('generation_jobs')
        .select(columns)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .range(from, to) as unknown as PromiseLike<{
          data: GenerationJobRow[] | null;
          error: { message: string } | null;
        }>,
    );
  try {
    return await read('kind, status, scene_id, shot_id, batch_id, error_message');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      if (message.includes('batch_id')) {
        const rows = await read('kind, status, scene_id, shot_id, error_message');
        return rows.map((row) => ({ ...row, batch_id: null }));
      }
    } catch {
      // Fall through: show progress without job status.
    }
    console.warn('Could not load generation jobs for the dashboard:', message);
    return [];
  }
}

/** Total length of the rendered clips, read in batches of asset ids. */
async function renderedSeconds(assetIds: string[]): Promise<number | null> {
  const unique = [...new Set(assetIds)];
  let total = 0;
  let found = false;
  for (let start = 0; start < unique.length; start += 200) {
    const { data, error } = await supabase
      .from('assets')
      .select('duration_seconds')
      .in('id', unique.slice(start, start + 200));
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { duration_seconds: number | null }[]) {
      if (row.duration_seconds) {
        total += Number(row.duration_seconds);
        found = true;
      }
    }
  }
  return found ? total : null;
}
