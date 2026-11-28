"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clapperboard, Expand, Eye, EyeOff, FileText, Image as ImageIcon, MountainSnow, Pencil, RefreshCw, Save, Users, Wand2 } from 'lucide-react';
import ImagePreviewModal, { ImagePreview } from '@/components/ui/ImagePreviewModal';
import { generateEnvironmentImageFromUpload, generateScriptEnvironmentImage } from '@/lib/api/image-generation';
import {
  ENVIRONMENT_PROFILE_FIELDS,
  EnvironmentProfileField,
  EnvironmentProfileUpdate,
  EnvironmentRanking,
  ObjectTier,
  StudioEnvironment,
  extractScriptEnvironments,
  listEnvironments,
  rankEnvironments,
  updateEnvironment,
} from '@/lib/api/story';
import { RankingStat, TierBadge } from './ImportanceTier';
import { ReferenceGallery } from './ReferenceGallery';
import { supabase } from '@/lib/supabaseClient';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { EntityCard, EntityRow, EntityStat, EntityThumb, TierGroups } from './entity/EntityCards';
import { ProfileFact, SectionHeading } from './entity/ProfileFact';
import { PanelTabs } from './entity/PanelTabs';

interface EnvironmentsProps { projectId: string | null; onSelect: (item: Record<string, unknown>) => void; }
interface SourceScene { id: string; sceneNumber: number | null; slugline: string; locationType: string | null; timeOfDay: string | null; summary: string | null; }
type GenerationMode = 'text' | 'image';
type PanelTab = 'profile' | 'references';

const FIELD_LABELS: Record<EnvironmentProfileField, string> = {
  look: 'Look / architecture', lighting: 'Lighting & colour palette', fixed_features: 'Fixed features',
};
const FIELD_PLACEHOLDERS: Record<EnvironmentProfileField, string> = {
  look: 'Small wooden kiosk, sky-blue paint peeling at the corners, corrugated tin roof',
  lighting: 'Hard noon sun, warm dusty yellows, deep shade under the awning',
  fixed_features: 'Red Tamucola fridge on the left, hand-painted price board above the counter',
};

interface EnvironmentForm { description: string; profile: Record<EnvironmentProfileField, string>; }

const formFrom = (environment: StudioEnvironment): EnvironmentForm => ({
  description: environment.description ?? '',
  profile: Object.fromEntries(ENVIRONMENT_PROFILE_FIELDS.map((field) => [field, environment.profile?.[field] ?? ''])) as Record<EnvironmentProfileField, string>,
});

/** Only what changed, so untouched fields keep their source. */
function changesFrom(environment: StudioEnvironment, form: EnvironmentForm): EnvironmentProfileUpdate {
  const update: EnvironmentProfileUpdate = {};
  if (form.description.trim() !== (environment.description ?? '')) update.description = form.description.trim() || null;
  const profile: Partial<Record<EnvironmentProfileField, string | null>> = {};
  for (const field of ENVIRONMENT_PROFILE_FIELDS) {
    if (form.profile[field].trim() !== (environment.profile?.[field] ?? '')) profile[field] = form.profile[field].trim() || null;
  }
  if (Object.keys(profile).length) update.profile = profile;
  return update;
}

const displayValues = (values: string[] | undefined) => values?.length ? values.join(', ') : null;
const settingLine = (environment: StudioEnvironment) => [displayValues(environment.location_types), displayValues(environment.time_of_day_values)].filter(Boolean).join(' · ') || null;
const missingCount = (environment: StudioEnvironment) => (environment.description ? 0 : 1) + ENVIRONMENT_PROFILE_FIELDS.filter((field) => !environment.profile?.[field]).length;

const TIER_ADVICE: Record<ObjectTier, string> = {
  major: 'Key location: fill in the profile, then add several reference angles (establishing, reverse, side, detail).',
  medium: 'Fill in the profile and add one or two reference images.',
  minor: 'A description and one establishing image are enough.',
};

/** Why a location got its rank: scenes set there, characters who appear there, screen time. */
function EnvironmentImportance({ ranking }: { ranking: EnvironmentRanking | null }) {
  if (!ranking) return null;
  return <section className="mt-4">
    <div className="flex items-center justify-between"><h3 className="text-xs font-semibold text-zinc-300">Importance</h3><span className="flex items-center gap-2 text-[11px] text-zinc-400">#{ranking.rank}<TierBadge ranking={ranking} /><span className="font-mono text-zinc-500">{ranking.score}/4</span></span></div>
    <dl className="mt-2 grid grid-cols-2 gap-2"><RankingStat label="Scenes" value={ranking.scene_count} score={ranking.scene_score} /><RankingStat label="Characters" value={ranking.character_count} score={ranking.character_score} /></dl>
    <p className="mt-2 text-[11px] leading-5 text-zinc-400">{ranking.characters.length ? <>Appearing here: <span className="text-zinc-200">{ranking.characters.join(', ')}</span>. </> : 'No characters appear here. '}{ranking.line_count} script line{ranking.line_count === 1 ? '' : 's'}.</p>
    <p className="mt-1 text-[11px] leading-5 text-violet-300">{TIER_ADVICE[ranking.tier]}</p>
  </section>;
}

export function Environments({ projectId, onSelect }: EnvironmentsProps) {
  const referenceImageInputRef = useRef<HTMLInputElement>(null);
  const [environments, setEnvironments] = useState<StudioEnvironment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourceScenes, setSourceScenes] = useState<SourceScene[]>([]);
  const [isPanelVisible, setIsPanelVisible] = useState(true);
  const [panelTab, setPanelTab] = useState<PanelTab>('profile');
  const [isLoading, setIsLoading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<EnvironmentForm>({ description: '', profile: { look: '', lighting: '', fixed_features: '' } });
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationMode, setGenerationMode] = useState<GenerationMode | null>(null);
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [referenceGuidance, setReferenceGuidance] = useState('');
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const [galleryRefreshKey, setGalleryRefreshKey] = useState(0);
  const [error, setError] = useState<string | Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadEnvironments = useCallback(async () => {
    if (!projectId) { setEnvironments([]); return; }
    setIsLoading(true); setError(null);
    try {
      const [rows, rankings] = await Promise.all([
        listEnvironments(projectId),
        // Ranking is a bonus: if it fails, the environments still load in name order.
        rankEnvironments(projectId).catch(() => [] as EnvironmentRanking[]),
      ]);
      const rankingById = new Map(rankings.map((ranking) => [ranking.environment_id, ranking]));
      const loaded = rows.map((row) => ({ ...row, ranking: rankingById.get(row.id) ?? null }))
        .sort((a, b) => (a.ranking?.rank ?? Number.MAX_SAFE_INTEGER) - (b.ranking?.rank ?? Number.MAX_SAFE_INTEGER));
      setEnvironments(loaded); setSelectedId((current) => loaded.some((environment) => environment.id === current) ? current : null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError : 'Failed to load script environments.'); }
    finally { setIsLoading(false); }
  }, [projectId]);

  useEffect(() => { void loadEnvironments(); }, [loadEnvironments]);
  useEffect(() => {
    if (!isGenerating) { setGenerationProgress(0); return; }
    let progress = 4; setGenerationProgress(progress);
    const interval = window.setInterval(() => { const remaining = 95 - progress; progress = Math.min(95, progress + Math.max(1, Math.ceil(remaining * 0.08))); setGenerationProgress(progress); }, 650);
    return () => window.clearInterval(interval);
  }, [isGenerating]);

  const selected = environments.find((environment) => environment.id === selectedId) ?? null;
  const sceneIdsKey = selected?.source_scene_ids.join(',') ?? '';
  useEffect(() => {
    const sourceSceneIds = sceneIdsKey ? sceneIdsKey.split(',') : [];
    if (!projectId || sourceSceneIds.length === 0) { setSourceScenes([]); return; }
    let isMounted = true;
    // Scene summaries for "Used in scenes"; the environment itself comes from the API.
    void (async () => {
      try {
        const { data, error: scenesError } = await supabase.from('scenes').select('id, scene_number, slugline_raw, location_type, time_of_day, summary').eq('project_id', projectId).in('id', sourceSceneIds);
        if (scenesError) throw scenesError;
        const scenesById = new Map((data ?? []).map((scene) => [scene.id as string, scene]));
        const ordered = sourceSceneIds.flatMap((sceneId): SourceScene[] => {
          const scene = scenesById.get(sceneId);
          return scene ? [{
            id: scene.id as string,
            sceneNumber: typeof scene.scene_number === 'number' ? scene.scene_number : null,
            slugline: (scene.slugline_raw as string | null) ?? 'Untitled scene',
            locationType: (scene.location_type as string | null) ?? null,
            timeOfDay: (scene.time_of_day as string | null) ?? null,
            summary: (scene.summary as string | null) ?? null,
          }] : [];
        });
        if (isMounted) setSourceScenes(ordered);
      } catch (sceneLoadError) { if (isMounted) setError(sceneLoadError instanceof Error ? sceneLoadError : 'Failed to load source scenes.'); }
    })();
    return () => { isMounted = false; };
  }, [projectId, sceneIdsKey]);

  const selectedPreview: ImagePreview[] = selected?.primary_image_url ? [{
    id: selected.id, url: selected.primary_image_url, prompt: [selected.name, settingLine(selected)].filter(Boolean).join(' - '), model: 'Environment main image', aspect_ratio: '16:9',
  }] : [];

  const extractEnvironments = async () => {
    if (!projectId) return;
    setIsExtracting(true); setError(null);
    try { await extractScriptEnvironments(projectId); await loadEnvironments(); }
    catch (reason) { setError(reason instanceof Error ? reason : 'Failed to extract environments from the current script.'); }
    finally { setIsExtracting(false); }
  };

  const generateEnvironmentImage = async (mode: GenerationMode) => {
    if (!projectId || !selected) return;
    if (mode === 'image' && !referenceImage) { setError('Choose a reference image before generating the environment.'); return; }
    setIsGenerating(true); setError(null);
    try {
      if (mode === 'image' && referenceImage) await generateEnvironmentImageFromUpload(referenceImage, referenceGuidance, 'nanobanana', 'wavespeed', projectId, selected.id);
      else await generateScriptEnvironmentImage({ project_id: projectId, environment_id: selected.id, model: 'nanobanana', provider: 'wavespeed' });
      setGenerationProgress(100); await loadEnvironments(); setGalleryRefreshKey((key) => key + 1); setGenerationMode(null); setReferenceImage(null); setReferenceGuidance('');
    } catch (reason) { setError(reason instanceof Error ? reason : 'Failed to generate the environment reference image.'); }
    finally { setIsGenerating(false); }
  };

  const selectEnvironment = (environment: StudioEnvironment) => {
    setSelectedId(environment.id); setForm(formFrom(environment)); setIsEditing(false); setGenerationMode(null); setReferenceImage(null); setReferenceGuidance(''); setIsPanelVisible(true);
    onSelect(environment as unknown as Record<string, unknown>);
  };
  const beginEdit = () => { if (selected) { setForm(formFrom(selected)); setIsEditing(true); setPanelTab('profile'); } };

  const saveProfile = async () => {
    if (!projectId || !selected) return;
    const update = changesFrom(selected, form);
    if (Object.keys(update).length === 0) { setIsEditing(false); return; }
    setIsSaving(true); setError(null); setNotice(null);
    try { await updateEnvironment(projectId, selected.id, update); await loadEnvironments(); setIsEditing(false); setNotice(`${selected.name} saved. Storyboard shots set here now use this profile.`); }
    catch (reason) { setError(reason instanceof Error ? reason : 'Failed to save the environment.'); }
    finally { setIsSaving(false); }
  };

  const resetField = async (update: EnvironmentProfileUpdate, label: string) => {
    if (!projectId || !selected) return;
    setIsSaving(true); setError(null); setNotice(null);
    try { await updateEnvironment(projectId, selected.id, update); await loadEnvironments(); setNotice(`${label} cleared.`); }
    catch (reason) { setError(reason instanceof Error ? reason : 'Failed to reset the field.'); }
    finally { setIsSaving(false); }
  };

  if (!projectId) return <div className="flex h-full items-center justify-center text-sm text-zinc-500">Loading project...</div>;

  const stats = (environment: StudioEnvironment): EntityStat[] => [
    { icon: <Clapperboard className="h-3 w-3" />, value: environment.ranking?.scene_count ?? environment.scene_count, title: 'Scenes' },
    { icon: <Users className="h-3 w-3" />, value: environment.ranking?.character_count ?? 0, title: environment.ranking?.characters.length ? `Appearing here: ${environment.ranking.characters.join(', ')}` : 'Characters' },
  ];
  const itemProps = (environment: StudioEnvironment) => {
    const missing = missingCount(environment);
    return {
      name: environment.name, imageUrl: environment.primary_image_url, rank: environment.ranking?.rank ?? null,
      badge: { label: environment.primary_image_url ? 'Main image' : 'No image', ok: Boolean(environment.primary_image_url) },
      subtitle: environment.description ?? settingLine(environment), stats: stats(environment), note: missing ? `${missing} to fill` : null,
      selected: environment.id === selectedId, onSelect: () => selectEnvironment(environment),
    };
  };

  const usedInScenes = sourceScenes.length > 0 && <section className="mt-4 border-t border-zinc-800 pt-4">
    <h3 className="text-xs font-semibold text-zinc-300">Used in scenes</h3>
    <div className="mt-2 space-y-2">{sourceScenes.map((scene, index) => <div key={scene.id} className="border-l-2 border-violet-500/40 bg-zinc-900/50 px-3 py-2">
      <div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold text-zinc-200">Scene {scene.sceneNumber ?? index + 1}</span><span className="font-mono text-[10px] text-zinc-500">{[scene.locationType, scene.timeOfDay].filter(Boolean).join(' · ') || 'Not specified'}</span></div>
      <p className="mt-1 text-xs leading-5 text-zinc-400">{scene.slugline}</p>
      {scene.summary && <p className="mt-1 text-[11px] leading-4 text-zinc-500">{scene.summary}</p>}
    </div>)}</div>
  </section>;

  return <div className="h-full overflow-auto px-6 py-7 lg:px-8"><div className="mx-auto max-w-7xl">
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-5">
      <div><div className="flex items-center gap-2.5"><MountainSnow className="h-5 w-5 text-violet-400" /><h1 className="text-xl font-bold text-zinc-100">Script Environments</h1></div><p className="mt-1 text-sm text-zinc-500">Describe each location and pick its main image so every shot set there looks like the same place.</p></div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setIsPanelVisible((visible) => !visible)} disabled={!selected} title={isPanelVisible ? 'Hide environment panel' : 'Show environment panel'} className="inline-flex h-9 w-9 items-center justify-center border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">{isPanelVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
        <button type="button" onClick={() => void extractEnvironments()} disabled={isExtracting} className="inline-flex h-9 items-center gap-2 bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50">{isExtracting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}{isExtracting ? 'Extracting...' : 'Extract from script'}</button>
        <button type="button" onClick={() => void loadEnvironments()} disabled={isLoading} title="Refresh environments" className="inline-flex h-9 w-9 items-center justify-center border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} /></button>
      </div>
    </header>
    <ErrorBanner error={error} onDismiss={() => setError(null)} className="mb-5" />
    {notice && <div className="mb-5 border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</div>}
    {isLoading && environments.length === 0 ? <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-zinc-500"><RefreshCw className="h-5 w-5 animate-spin" />Loading script environments...</div>
      : environments.length === 0 ? <div className="flex min-h-72 flex-col items-center justify-center border border-dashed border-zinc-800 px-6 text-center"><FileText className="mb-3 h-7 w-7 text-zinc-600" /><h2 className="text-sm font-semibold text-zinc-300">No extracted environments yet</h2><p className="mt-1 max-w-sm text-sm text-zinc-500">Locations come from the scene headings of the saved script.</p><button type="button" onClick={() => void extractEnvironments()} disabled={isExtracting} className="mt-4 inline-flex h-9 items-center justify-center gap-2 bg-violet-600 px-3 text-xs font-semibold text-white disabled:opacity-50">{isExtracting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <MountainSnow className="h-3.5 w-3.5" />}{isExtracting ? 'Extracting environments...' : 'Extract from current script'}</button></div>
      : <div className={`grid gap-6 ${isPanelVisible && selected ? 'xl:grid-cols-[minmax(0,1fr)_26rem]' : ''}`}>
        <TierGroups
          items={environments}
          tierOf={(environment) => environment.ranking?.tier ?? null}
          renderCard={(environment) => <EntityCard key={environment.id} {...itemProps(environment)} aspect="video" />}
          renderRow={(environment) => <EntityRow key={environment.id} {...itemProps(environment)} />}
        />
        {isPanelVisible && selected && <aside className="self-start border border-zinc-800 bg-zinc-950 xl:sticky xl:top-0 xl:max-h-[calc(100vh-9rem)] xl:overflow-y-auto">
          <div className="flex items-start gap-3 border-b border-zinc-800 p-4">
            <button type="button" onClick={() => selected.primary_image_url && setIsImagePreviewOpen(true)} disabled={!selected.primary_image_url} aria-label={`Preview ${selected.name}`} className="shrink-0 cursor-zoom-in border border-zinc-800 disabled:cursor-default"><EntityThumb name={selected.name} imageUrl={selected.primary_image_url} className="aspect-video w-28" initialsClassName="text-lg" sizes="112px" /></button>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-bold text-zinc-100">{selected.name}</h2>
              <p className={`truncate text-xs ${settingLine(selected) ? 'text-zinc-400' : 'italic text-zinc-600'}`}>{settingLine(selected) ?? 'Setting and time not in the script'}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500"><TierBadge ranking={selected.ranking} emptyLabel="Unranked" />{selected.ranking && <span className="font-mono">#{selected.ranking.rank}</span>}</div>
              <button type="button" onClick={() => setIsImagePreviewOpen(true)} disabled={!selected.primary_image_url} title={selected.primary_image_url ? 'Open the main image' : 'No main image yet'} className="mt-2 inline-flex h-7 items-center gap-1.5 border border-violet-400/40 px-2 text-[11px] font-semibold text-violet-300 hover:bg-zinc-900 disabled:opacity-40"><Expand className="h-3.5 w-3.5" />Preview</button>
            </div>
            <button type="button" onClick={beginEdit} className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-zinc-700 text-zinc-300 hover:bg-zinc-900" title="Edit environment profile"><Pencil className="h-3.5 w-3.5" /></button>
          </div>
          <PanelTabs<PanelTab> active={panelTab} onChange={setPanelTab} tabs={[
            { key: 'profile', label: 'Profile' },
            { key: 'references', label: <>References {selected.primary_image_url ? <CheckCircle2 className="ml-1 inline h-3 w-3 text-emerald-400" /> : <span className="ml-1 font-normal text-zinc-500">none</span>}</> },
          ]} />
          <div className="p-4">{panelTab === 'profile' ? <>
            {!isEditing && missingCount(selected) > 0 && <button type="button" onClick={beginEdit} className="mb-4 flex w-full items-center justify-between gap-3 border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-left text-xs text-amber-200 hover:bg-amber-400/10"><span>{missingCount(selected)} detail{missingCount(selected) === 1 ? '' : 's'} missing</span><span className="shrink-0 font-semibold">Fill in</span></button>}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              <ProfileFact label="Description" value={selected.description} manual={selected.manual_override_fields.includes('description')} isEditing={isEditing} draft={form.description} placeholder="What the place is, in a sentence or two" multiline busy={isSaving}
                onChange={(value) => setForm((current) => ({ ...current, description: value }))} onReset={() => void resetField({ description: null }, 'Description')} />
              <SectionHeading title="Look" hint="stays the same in every shot" />
              {ENVIRONMENT_PROFILE_FIELDS.map((field) => <ProfileFact key={field} label={FIELD_LABELS[field]} value={selected.profile?.[field] ?? null} manual={selected.manual_override_fields.includes(field)} isEditing={isEditing} draft={form.profile[field]} placeholder={FIELD_PLACEHOLDERS[field]} multiline busy={isSaving}
                onChange={(value) => setForm((current) => ({ ...current, profile: { ...current.profile, [field]: value } }))} onReset={() => void resetField({ profile: { [field]: null } }, FIELD_LABELS[field])} />)}
            </dl>
            {isEditing && <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">Fixed features are things that must look the same every time, like a sign or a fridge in a set place.</p>}
            {isEditing && <div className="mt-3 flex gap-2"><button type="button" onClick={() => void saveProfile()} disabled={isSaving} className="inline-flex h-9 flex-1 items-center justify-center gap-2 bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"><Save className="h-3.5 w-3.5" />{isSaving ? 'Saving...' : 'Save profile'}</button><button type="button" onClick={() => { setIsEditing(false); setForm(formFrom(selected)); }} className="h-9 border border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-900">Cancel</button></div>}
            <div className="mt-4 border-t border-zinc-800 pt-1"><EnvironmentImportance ranking={selected.ranking} /></div>
            {usedInScenes}
          </> : <>
            <input ref={referenceImageInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => setReferenceImage(event.target.files?.[0] ?? null)} />
            {isGenerating ? <div role="status"><div className="mb-1.5 flex items-center justify-between text-xs"><span className="text-zinc-400">Generating reference image</span><span className="font-mono text-violet-300">{generationProgress}%</span></div><div className="h-1.5 overflow-hidden bg-zinc-800"><div className="h-full bg-violet-500 transition-[width] duration-500" style={{ width: `${generationProgress}%` }} /></div></div>
              : generationMode === 'image' ? <div className="border border-zinc-800 bg-zinc-900/50 p-3"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold text-zinc-200">Reference image</span><button type="button" onClick={() => { setGenerationMode(null); setReferenceImage(null); setReferenceGuidance(''); }} className="text-xs text-zinc-500 hover:text-zinc-300">Back</button></div><button type="button" onClick={() => referenceImageInputRef.current?.click()} className="flex h-10 w-full items-center justify-between border border-dashed border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-400"><span className="truncate">{referenceImage?.name ?? 'Choose image'}</span><ImageIcon className="h-4 w-4" /></button><textarea value={referenceGuidance} onChange={(event) => setReferenceGuidance(event.target.value)} placeholder="Optional visual direction" className="mt-2 min-h-20 w-full resize-none border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-200 outline-none focus:border-violet-400" /><button type="button" onClick={() => void generateEnvironmentImage('image')} disabled={!referenceImage} className="mt-2 flex h-10 w-full items-center justify-center gap-2 bg-violet-600 text-sm font-semibold text-white disabled:bg-zinc-800"><ImageIcon className="h-4 w-4" />Generate from image</button></div>
              : <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => void generateEnvironmentImage('text')} className="flex min-h-20 flex-col items-start justify-center border border-violet-400/40 bg-violet-500/10 px-3 text-left text-violet-200 hover:bg-violet-500/15"><Wand2 className="mb-2 h-4 w-4" /><span className="text-xs font-semibold">Create from text</span><span className="mt-0.5 text-[10px] text-violet-300/80">Use the script and profile</span></button><button type="button" onClick={() => setGenerationMode('image')} className="flex min-h-20 flex-col items-start justify-center border border-zinc-700 bg-zinc-900 px-3 text-left text-zinc-200 hover:bg-zinc-800"><ImageIcon className="mb-2 h-4 w-4" /><span className="text-xs font-semibold">Use reference image</span><span className="mt-0.5 text-[10px] text-zinc-500">Preserve visual direction</span></button></div>}
            <ReferenceGallery projectId={projectId} entityType="environment" entityId={selected.id} entityName={selected.name} refreshKey={galleryRefreshKey} onChanged={() => void loadEnvironments()}
              hint="The starred main image is the chosen look of this place; wide shots also take the other angles." />
          </>}</div>
        </aside>}
      </div>}
    <ImagePreviewModal isOpen={isImagePreviewOpen} onClose={() => setIsImagePreviewOpen(false)} images={selectedPreview} selectedIndex={0} onNavigate={() => undefined} />
  </div></div>;
}
