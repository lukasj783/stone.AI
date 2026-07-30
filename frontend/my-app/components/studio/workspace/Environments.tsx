"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { AlertCircle, Eye, EyeOff, FileText, Image as ImageIcon, MountainSnow, RefreshCw, Wand2 } from 'lucide-react';
import ImagePreviewModal, { ImagePreview } from '@/components/ui/ImagePreviewModal';
import { generateEnvironmentImageFromUpload, generateScriptEnvironmentImage } from '@/lib/api/image-generation';
import { extractScriptEnvironments } from '@/lib/api/story';
import { supabase } from '@/lib/supabaseClient';

interface EnvironmentsProps { projectId: string | null; onSelect: (item: Record<string, unknown>) => void; }
interface EnvironmentMetadata { source_scene_ids?: string[]; source_sluglines?: string[]; location_types?: string[]; time_of_day_values?: string[]; scene_count?: number; }
interface StudioEnvironment { id: string; name: string; description: string | null; tags: string[]; primaryImageUrl: string | null; metadata: EnvironmentMetadata; }
interface SourceScene { id: string; sceneNumber: number | null; slugline: string; locationType: string | null; timeOfDay: string | null; summary: string | null; }
type GenerationMode = 'text' | 'image';
const displayValues = (values: string[] | undefined) => values?.length ? values.join(', ') : 'Not specified';

export function Environments({ projectId, onSelect }: EnvironmentsProps) {
  const referenceImageInputRef = useRef<HTMLInputElement>(null);
  const [environments, setEnvironments] = useState<StudioEnvironment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourceScenes, setSourceScenes] = useState<SourceScene[]>([]);
  const [isProfileVisible, setIsProfileVisible] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationMode, setGenerationMode] = useState<GenerationMode | null>(null);
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [referenceGuidance, setReferenceGuidance] = useState('');
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEnvironments = useCallback(async () => {
    if (!projectId) { setEnvironments([]); return; }
    setIsLoading(true); setError(null);
    try {
      const { data: rows, error: environmentsError } = await supabase.from('environments').select('id, name, description, tags, primary_asset_id, metadata').eq('project_id', projectId).eq('metadata->>source', 'script').order('name');
      if (environmentsError) throw environmentsError;
      const environmentRows = rows ?? [];
      const assetIds = environmentRows.map((row) => row.primary_asset_id as string | null).filter(Boolean) as string[];
      const { data: assets, error: assetsError } = assetIds.length ? await supabase.from('assets').select('id, url').in('id', assetIds) : { data: [], error: null };
      if (assetsError) throw assetsError;
      const urls = new Map((assets ?? []).map((asset) => [asset.id as string, asset.url as string]));
      const loaded = environmentRows.map((row): StudioEnvironment => ({ id: row.id as string, name: row.name as string, description: row.description as string | null, tags: (row.tags as string[] | null) ?? [], primaryImageUrl: urls.get(row.primary_asset_id as string) ?? null, metadata: (row.metadata ?? {}) as EnvironmentMetadata }));
      setEnvironments(loaded); setSelectedId((current) => loaded.some((environment) => environment.id === current) ? current : null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Failed to load script environments.'); }
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
  useEffect(() => {
    const sourceSceneIds = selected?.metadata.source_scene_ids ?? [];
    if (!projectId || sourceSceneIds.length === 0) {
      setSourceScenes([]);
      return;
    }

    let isMounted = true;
    const loadSourceScenes = async () => {
      try {
        const { data, error: scenesError } = await supabase
          .from('scenes')
          .select('id, scene_number, slugline_raw, location_type, time_of_day, summary')
          .eq('project_id', projectId)
          .in('id', sourceSceneIds);
        if (scenesError) throw scenesError;

        const scenesById = new Map((data ?? []).map((scene) => [scene.id as string, scene]));
        const orderedScenes = sourceSceneIds.flatMap((sceneId): SourceScene[] => {
          const scene = scenesById.get(sceneId);
          if (!scene) return [];
          return [{
            id: scene.id as string,
            sceneNumber: typeof scene.scene_number === 'number' ? scene.scene_number : null,
            slugline: (scene.slugline_raw as string | null) ?? 'Untitled scene',
            locationType: (scene.location_type as string | null) ?? null,
            timeOfDay: (scene.time_of_day as string | null) ?? null,
            summary: (scene.summary as string | null) ?? null,
          }];
        });
        if (isMounted) setSourceScenes(orderedScenes);
      } catch (sceneLoadError) {
        if (isMounted) setError(sceneLoadError instanceof Error ? sceneLoadError.message : 'Failed to load source scenes.');
      }
    };

    void loadSourceScenes();
    return () => { isMounted = false; };
  }, [projectId, selected]);
  const selectedPreview: ImagePreview[] = selected?.primaryImageUrl ? [{
    id: selected.id,
    url: selected.primaryImageUrl,
    prompt: [selected.name, displayValues(selected.metadata.location_types), displayValues(selected.metadata.time_of_day_values)].filter((value) => value !== 'Not specified').join(' - '),
    model: 'Environment reference',
    aspect_ratio: '16:9',
  }] : [];
  const continuitySceneList = sourceScenes.length > 0 ? (
    <div className="mt-4">
      <h3 className="text-xs font-semibold text-zinc-300">Used in scenes</h3>
      <div className="mt-2 space-y-2">
        {sourceScenes.map((scene, index) => (
          <div key={scene.id} className="border-l-2 border-violet-500/40 bg-zinc-900/50 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-zinc-200">Scene {scene.sceneNumber ?? index + 1}</span>
              <span className="text-[10px] font-mono text-zinc-500">{[scene.locationType, scene.timeOfDay].filter(Boolean).join(' · ') || 'Not specified'}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-zinc-400">{scene.slugline}</p>
            {scene.summary && <p className="mt-1 text-[11px] leading-4 text-zinc-500">{scene.summary}</p>}
          </div>
        ))}
      </div>
    </div>
  ) : null;
  const extractEnvironments = async () => { if (!projectId) return; setIsExtracting(true); setError(null); try { await extractScriptEnvironments(projectId); await loadEnvironments(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Failed to extract environments from the current script.'); } finally { setIsExtracting(false); } };
  const generateEnvironmentImage = async (mode: GenerationMode) => {
    if (!projectId || !selected) return;
    if (mode === 'image' && !referenceImage) { setError('Choose a reference image before generating the environment.'); return; }
    setIsGenerating(true); setError(null);
    try {
      if (mode === 'image' && referenceImage) await generateEnvironmentImageFromUpload(referenceImage, referenceGuidance, 'nanobanana', 'replicate', projectId, selected.id);
      else await generateScriptEnvironmentImage({ project_id: projectId, environment_id: selected.id, model: 'nanobanana', provider: 'replicate' });
      setGenerationProgress(100); await loadEnvironments(); setGenerationMode(null); setReferenceImage(null); setReferenceGuidance('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Failed to generate the environment reference image.'); }
    finally { setIsGenerating(false); }
  };
  const selectEnvironment = (environment: StudioEnvironment) => { setSelectedId(environment.id); setGenerationMode(null); setReferenceImage(null); setReferenceGuidance(''); setIsProfileVisible(true); onSelect(environment as unknown as Record<string, unknown>); };
  if (!projectId) return <div className="flex h-full items-center justify-center text-sm text-zinc-500">Loading project...</div>;

  return <div className="h-full overflow-auto px-6 py-7 lg:px-8"><div className="mx-auto max-w-7xl">
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-5"><div><div className="flex items-center gap-2.5"><MountainSnow className="h-5 w-5 text-violet-400" /><h1 className="text-xl font-bold text-zinc-100">Script Environments</h1></div><p className="mt-1 text-sm text-zinc-500">Locations explicitly identified in the saved screenplay scene headings.</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => setIsProfileVisible((visible) => !visible)} disabled={!selected} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300 disabled:opacity-50">{isProfileVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button><button type="button" onClick={() => void loadEnvironments()} disabled={isLoading} className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs font-semibold text-zinc-300"><RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />Refresh</button></div></header>
    {error && <div className="mb-5 flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"><AlertCircle className="h-4 w-4" />{error}</div>}
    {isLoading ? <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-zinc-500"><RefreshCw className="h-5 w-5 animate-spin" />Loading script environments...</div> : environments.length === 0 ? <div className="flex min-h-72 flex-col items-center justify-center border border-dashed border-zinc-800 px-6 text-center"><FileText className="mb-3 h-7 w-7 text-zinc-600" /><h2 className="text-sm font-semibold text-zinc-300">No extracted environments yet</h2><button type="button" onClick={() => void extractEnvironments()} disabled={isExtracting} className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-violet-600 px-3 text-xs font-semibold text-white">{isExtracting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <MountainSnow className="h-3.5 w-3.5" />}{isExtracting ? 'Extracting environments...' : 'Extract from current script'}</button></div> : <div className={`grid gap-6 ${isProfileVisible ? 'xl:grid-cols-[minmax(0,1fr)_26rem]' : ''}`}><div className="overflow-x-auto border border-zinc-800 bg-zinc-950"><table className="w-full min-w-180 text-left text-sm"><thead className="border-b border-zinc-800 bg-zinc-900/50 text-xs font-semibold uppercase tracking-wide text-zinc-500"><tr><th className="px-4 py-3">Environment</th><th className="px-4 py-3">Setting</th><th className="px-4 py-3">Time</th><th className="px-4 py-3 text-right">Scenes</th><th className="px-4 py-3 text-right">Reference</th></tr></thead><tbody className="divide-y divide-zinc-800/80">{environments.map((environment) => <tr key={environment.id} onClick={() => selectEnvironment(environment)} className={`cursor-pointer hover:bg-zinc-900/70 ${selectedId === environment.id ? 'bg-violet-500/10' : ''}`}><td className="px-4 py-3 font-semibold text-zinc-200">{environment.name}</td><td className="px-4 py-3 text-zinc-400">{displayValues(environment.metadata.location_types)}</td><td className="px-4 py-3 text-zinc-400">{displayValues(environment.metadata.time_of_day_values)}</td><td className="px-4 py-3 text-right font-mono text-xs text-zinc-400">{environment.metadata.scene_count ?? environment.metadata.source_scene_ids?.length ?? 0}</td><td className="px-4 py-3 text-right">{environment.primaryImageUrl ? <span className="text-xs text-emerald-400">Attached</span> : <span className="text-xs text-zinc-600">None</span>}</td></tr>)}</tbody></table></div>
    {isProfileVisible && <aside className="border border-zinc-800 bg-zinc-950">{selected ? <div><div className="relative aspect-video overflow-hidden border-b border-zinc-800 bg-zinc-900">{selected.primaryImageUrl ? <button type="button" onClick={() => setIsImagePreviewOpen(true)} aria-label={`Preview ${selected.name}`} className="absolute inset-0 block w-full cursor-zoom-in"><Image src={selected.primaryImageUrl} alt={selected.name} fill sizes="416px" unoptimized className="object-cover" /></button> : <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-600"><ImageIcon className="h-7 w-7" /><span className="text-xs">No reference image attached</span></div>}</div><div className="p-4"><h2 className="text-base font-bold text-zinc-100">{selected.name}</h2><dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-zinc-800 py-3 text-xs"><div><dt className="text-zinc-600">Setting</dt><dd className="mt-1 text-zinc-300">{displayValues(selected.metadata.location_types)}</dd></div><div><dt className="text-zinc-600">Time</dt><dd className="mt-1 text-zinc-300">{displayValues(selected.metadata.time_of_day_values)}</dd></div><div className="col-span-2"><dt className="text-zinc-600">Source scenes</dt><dd className="mt-1 text-zinc-300">{selected.metadata.scene_count ?? selected.metadata.source_scene_ids?.length ?? 0}</dd></div></dl><input ref={referenceImageInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => setReferenceImage(event.target.files?.[0] ?? null)} />{isGenerating ? <div className="mt-4" role="status"><div className="mb-1.5 flex items-center justify-between text-xs"><span className="text-zinc-400">Generating reference image</span><span className="font-mono text-violet-300">{generationProgress}%</span></div><div className="h-1.5 overflow-hidden bg-zinc-800"><div className="h-full bg-violet-500 transition-[width] duration-500" style={{ width: `${generationProgress}%` }} /></div></div> : generationMode === 'image' ? <div className="mt-4 border border-zinc-800 bg-zinc-900/50 p-3"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold text-zinc-200">Reference image</span><button type="button" onClick={() => { setGenerationMode(null); setReferenceImage(null); setReferenceGuidance(''); }} className="text-xs text-zinc-500">Back</button></div><button type="button" onClick={() => referenceImageInputRef.current?.click()} className="flex h-10 w-full items-center justify-between border border-dashed border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-400"><span className="truncate">{referenceImage?.name ?? 'Choose image'}</span><ImageIcon className="h-4 w-4" /></button><textarea value={referenceGuidance} onChange={(event) => setReferenceGuidance(event.target.value)} placeholder="Optional visual direction" className="mt-2 min-h-20 w-full resize-none border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-200" /><button type="button" onClick={() => void generateEnvironmentImage('image')} disabled={!referenceImage} className="mt-2 flex h-10 w-full items-center justify-center gap-2 bg-violet-600 text-sm font-semibold text-white disabled:bg-zinc-800"><ImageIcon className="h-4 w-4" />Generate from image</button></div> : <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => void generateEnvironmentImage('text')} className="flex min-h-20 flex-col items-start justify-center border border-violet-400/40 bg-violet-500/10 px-3 text-left text-violet-200"><Wand2 className="mb-2 h-4 w-4" /><span className="text-xs font-semibold">Create from text</span><span className="mt-0.5 text-[10px] text-violet-300/80">Use saved script facts</span></button><button type="button" onClick={() => setGenerationMode('image')} className="flex min-h-20 flex-col items-start justify-center border border-zinc-700 bg-zinc-900 px-3 text-left text-zinc-200"><ImageIcon className="mb-2 h-4 w-4" /><span className="text-xs font-semibold">Use reference image</span><span className="mt-0.5 text-[10px] text-zinc-500">Preserve visual direction</span></button></div>}</div></div> : <div className="flex min-h-96 flex-col items-center justify-center px-6 text-center text-sm text-zinc-600"><MountainSnow className="mb-3 h-6 w-6" />Select an environment to inspect its script profile.</div>}</aside>}</div>}
    {selected && continuitySceneList && <section className="mt-6 border-t border-zinc-800 pt-5">{continuitySceneList}</section>}
    <ImagePreviewModal isOpen={isImagePreviewOpen} onClose={() => setIsImagePreviewOpen(false)} images={selectedPreview} selectedIndex={0} onNavigate={() => undefined} />
  </div></div>;
}