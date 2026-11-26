import { supabase } from '@/lib/supabaseClient';
import { fetchAll } from '@/lib/projectProgress';

/** One storyboardable scene with its storyboard progress, as shown in the scene picker. */
export interface StoryboardSceneOption {
  id: string;
  /** 1-based position among the project's storyboardable scenes. */
  number: number;
  name: string;
  locationType: string | null;
  location: string | null;
  timeOfDay: string | null;
  durationSeconds: number | null;
  summary: string | null;
  shotCount: number;
  imageCount: number;
  failedCount: number;
  thumbnailUrl: string | null;
  characters: string[];
}

interface SceneRow {
  id: string;
  slugline_raw: string | null;
  title: string | null;
  location_type: string | null;
  location: string | null;
  time_of_day: string | null;
  duration_seconds: number | null;
  summary: string | null;
}

interface ShotRow {
  id: string;
  scene_id: string;
  status: string | null;
  metadata: { characters?: { name?: string | null }[] | null } | null;
}

const text = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);

/**
 * Loads every leaf scene of a project (scenes, sections, segments: the units storyboards are made for)
 * with its shot count, how many shots have a storyboard image, failed shots and a first-frame thumbnail.
 */
export async function loadStoryboardSceneOverview(projectId: string): Promise<StoryboardSceneOption[]> {
  const [scenes, shots, imageLinks] = await Promise.all([
    fetchAll<SceneRow>((from, to) =>
      supabase
        .from('scenes')
        .select('id, slugline_raw, title, location_type, location, time_of_day, duration_seconds, summary')
        .eq('project_id', projectId)
        .eq('is_leaf', true)
        .order('sort_order', { ascending: true })
        .range(from, to),
    ),
    fetchAll<ShotRow>((from, to) =>
      supabase
        .from('shots')
        .select('id, scene_id, status, metadata')
        .eq('project_id', projectId)
        .order('sort_order', { ascending: true })
        .range(from, to),
    ),
    fetchAll<{ target_id: string; asset_id: string }>((from, to) =>
      supabase
        .from('asset_links')
        .select('target_id, asset_id')
        .eq('project_id', projectId)
        .eq('target_type', 'shot')
        .eq('role', 'storyboard')
        .range(from, to),
    ),
  ]);

  const imageAssetByShot = new Map(imageLinks.map((link) => [link.target_id, link.asset_id]));
  const shotsByScene = new Map<string, ShotRow[]>();
  for (const shot of shots) {
    const list = shotsByScene.get(shot.scene_id);
    if (list) list.push(shot);
    else shotsByScene.set(shot.scene_id, [shot]);
  }

  // Thumbnail: the first shot (in order) of each scene that has a storyboard image.
  const thumbnailAssetByScene = new Map<string, string>();
  for (const [sceneId, sceneShots] of shotsByScene) {
    const firstWithImage = sceneShots.find((shot) => imageAssetByShot.has(shot.id));
    if (firstWithImage) thumbnailAssetByScene.set(sceneId, imageAssetByShot.get(firstWithImage.id)!);
  }
  const thumbnailAssetIds = [...new Set(thumbnailAssetByScene.values())];
  const urlByAsset = new Map<string, string>();
  if (thumbnailAssetIds.length > 0) {
    const { data, error } = await supabase.from('assets').select('id, url').in('id', thumbnailAssetIds);
    if (error) throw new Error(error.message);
    for (const asset of (data ?? []) as { id: string; url: string | null }[]) {
      if (asset.url) urlByAsset.set(asset.id, asset.url);
    }
  }

  return scenes.map((scene, index) => {
    const sceneShots = shotsByScene.get(scene.id) ?? [];
    const imageCount = sceneShots.filter((shot) => imageAssetByShot.has(shot.id)).length;
    const failedCount = sceneShots.filter((shot) => shot.status === 'failed' && !imageAssetByShot.has(shot.id)).length;
    const characters = [
      ...new Set(
        sceneShots.flatMap((shot) => (shot.metadata?.characters ?? []).map((character) => text(character?.name))),
      ),
    ].filter((name): name is string => Boolean(name));
    const thumbnailAsset = thumbnailAssetByScene.get(scene.id);
    return {
      id: scene.id,
      number: index + 1,
      name: text(scene.slugline_raw) ?? text(scene.title) ?? `Scene ${index + 1}`,
      locationType: text(scene.location_type)?.toUpperCase() ?? null,
      location: text(scene.location),
      timeOfDay: text(scene.time_of_day)?.toUpperCase() ?? null,
      durationSeconds: typeof scene.duration_seconds === 'number' ? scene.duration_seconds : null,
      summary: text(scene.summary),
      shotCount: sceneShots.length,
      imageCount,
      failedCount,
      thumbnailUrl: thumbnailAsset ? urlByAsset.get(thumbnailAsset) ?? null : null,
      characters,
    };
  });
}
