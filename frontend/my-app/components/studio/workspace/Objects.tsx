"use client";

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { Box, FileText, Pencil, Plus, RefreshCw, Save, Trash2, Wand2, X } from 'lucide-react';
import {
  createObject,
  deleteObject,
  extractScriptObjects,
  listObjects,
  ObjectRanking,
  ObjectTier,
  StudioObject,
  updateObject,
} from '@/lib/api/story';
import { generateObjectReferenceImage } from '@/lib/api/image-generation';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { RankingStat, TierBadge } from './ImportanceTier';
import { ReferenceGallery } from './ReferenceGallery';

interface ObjectsProps {
  projectId: string | null;
  onSelect: (item: Record<string, unknown>) => void;
}

interface ObjectForm {
  name: string;
  description: string;
  tags: string;
}

const EMPTY_FORM: ObjectForm = { name: '', description: '', tags: '' };

function formFromObject(object: StudioObject): ObjectForm {
  return { name: object.name, description: object.description ?? '', tags: object.tags.join(', ') };
}

function tagsFromInput(value: string): string[] {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean);
}

const TIER_ADVICE: Record<ObjectTier, string> = {
  major: 'Key prop: add several reference angles (main, 3/4, side, detail).',
  medium: 'Add one or two clean reference images.',
  minor: 'One image is enough, or let the storyboard draw it from the description.',
};

/** Why an object got its rank: scene and interaction counts, and who handles it. */
function RankingDetails({ ranking }: { ranking: ObjectRanking | null }) {
  if (!ranking) return <p className="mt-4 border border-dashed border-zinc-800 px-3 py-2 text-[11px] text-zinc-500">The saved script never mentions this object by name, so it has no rank.</p>;
  return <section className="mt-4">
    <div className="flex items-center justify-between"><h3 className="text-xs font-semibold text-zinc-300">Importance</h3><span className="flex items-center gap-2 text-[11px] text-zinc-400">#{ranking.rank}<TierBadge ranking={ranking} /><span className="font-mono text-zinc-500">{ranking.score}/4</span></span></div>
    <dl className="mt-2 grid grid-cols-2 gap-2"><RankingStat label="Scenes" value={ranking.scene_count} score={ranking.scene_score} /><RankingStat label="Interactions" value={ranking.interaction_count} score={ranking.interaction_score} /></dl>
    <p className="mt-2 text-[11px] leading-5 text-zinc-400">{ranking.interacting_characters.length ? <>Handled by <span className="text-zinc-200">{ranking.interacting_characters.join(', ')}</span>. </> : 'No character handles it. '}Mentioned {ranking.mention_count} time{ranking.mention_count === 1 ? '' : 's'}{ranking.dialogue_mentions ? `, ${ranking.dialogue_mentions} in dialogue` : ''}.</p>
    <p className="mt-1 text-[11px] leading-5 text-violet-300">{TIER_ADVICE[ranking.tier]}</p>
  </section>;
}

function SourceBadge({ source }: { source: string }) {
  return <span className={`border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${source === 'manual' ? 'border-violet-400/30 text-violet-300' : 'border-sky-400/30 text-sky-300'}`}>{source}</span>;
}

export function Objects({ projectId, onSelect }: ObjectsProps) {
  const [objects, setObjects] = useState<StudioObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isProfileVisible, setIsProfileVisible] = useState(true);
  const [form, setForm] = useState<ObjectForm>(EMPTY_FORM);
  const [error, setError] = useState<string | Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [galleryRefreshKey, setGalleryRefreshKey] = useState(0);

  const loadObjects = useCallback(async () => {
    if (!projectId) { setObjects([]); return; }
    setIsLoading(true); setError(null);
    try {
      const loaded = await listObjects(projectId);
      setObjects(loaded);
      setSelectedId((current) => loaded.some((object) => object.id === current) ? current : null);
    } catch (reason) { setError(reason instanceof Error ? reason : 'Failed to load objects.'); }
    finally { setIsLoading(false); }
  }, [projectId]);

  useEffect(() => { void loadObjects(); }, [loadObjects]);

  const selected = objects.find((object) => object.id === selectedId) ?? null;
  const selectObject = (object: StudioObject) => {
    setSelectedId(object.id); setForm(formFromObject(object)); setIsEditing(false); setIsCreating(false); setIsProfileVisible(true); onSelect(object as unknown as Record<string, unknown>);
  };

  const extractObjects = async () => {
    if (!projectId) return;
    setIsExtracting(true); setError(null); setNotice(null);
    try {
      const count = await extractScriptObjects(projectId);
      await loadObjects();
      setNotice(count === 1 ? 'Extracted 1 object from the current script.' : `Extracted ${count} objects from the current script.`);
    } catch (reason) { setError(reason instanceof Error ? reason : 'Failed to extract objects.'); }
    finally { setIsExtracting(false); }
  };

  const saveNewObject = async () => {
    if (!projectId) return;
    if (!form.name.trim()) { setError('Object name is required.'); return; }
    setIsSaving(true); setError(null);
    try {
      const created = await createObject(projectId, { name: form.name, description: form.description || null, tags: tagsFromInput(form.tags) });
      await loadObjects(); selectObject(created); setNotice('Object created.');
    } catch (reason) { setError(reason instanceof Error ? reason : 'Failed to create object.'); }
    finally { setIsSaving(false); }
  };

  const saveObject = async () => {
    if (!projectId || !selected) return;
    if (!form.name.trim()) { setError('Object name is required.'); return; }
    setIsSaving(true); setError(null);
    try {
      const updated = await updateObject(projectId, selected.id, { name: form.name, description: form.description || null, tags: tagsFromInput(form.tags) });
      await loadObjects(); setForm(formFromObject(updated)); setIsEditing(false); setNotice('Object profile saved.');
    } catch (reason) { setError(reason instanceof Error ? reason : 'Failed to save object.'); }
    finally { setIsSaving(false); }
  };

  const removeObject = async () => {
    if (!projectId || !selected || !window.confirm(`Delete ${selected.name}? Its generated assets will remain in the library.`)) return;
    setIsSaving(true); setError(null);
    try { await deleteObject(projectId, selected.id); setSelectedId(null); setIsEditing(false); await loadObjects(); setNotice('Object deleted.'); }
    catch (reason) { setError(reason instanceof Error ? reason : 'Failed to delete object.'); }
    finally { setIsSaving(false); }
  };

  const generateReference = async () => {
    if (!projectId || !selected) return;
    setIsGenerating(true); setError(null);
    try {
      await generateObjectReferenceImage({ project_id: projectId, object_id: selected.id, model: 'nanobanana', provider: 'wavespeed' });
      await loadObjects(); setGalleryRefreshKey((key) => key + 1); setNotice('Object reference image created.');
    } catch (reason) { setError(reason instanceof Error ? reason : 'Failed to generate object reference image.'); }
    finally { setIsGenerating(false); }
  };

  if (!projectId) return <div className="flex h-full items-center justify-center text-sm text-zinc-500">Loading project...</div>;

  return <div className="h-full overflow-auto px-6 py-7 lg:px-8"><div className="mx-auto max-w-7xl">
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-5"><div><div className="flex items-center gap-2.5"><Box className="h-5 w-5 text-violet-400" /><h1 className="text-xl font-bold text-zinc-100">Objects</h1></div><p className="mt-1 text-sm text-zinc-500">Script evidence stays traceable while manual object decisions remain authoritative.</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => setIsProfileVisible((visible) => !visible)} disabled={!selected} title={isProfileVisible ? 'Conceal object profile' : 'Preview object profile'} className="inline-flex h-9 w-9 items-center justify-center border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">{isProfileVisible ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}</button><button type="button" onClick={() => { setForm(EMPTY_FORM); setIsCreating(true); setIsEditing(false); setSelectedId(null); }} className="inline-flex h-9 items-center gap-2 border border-zinc-700 bg-zinc-900 px-3 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"><Plus className="h-3.5 w-3.5" />New object</button><button type="button" onClick={() => void extractObjects()} disabled={isExtracting} className="inline-flex h-9 items-center gap-2 bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50">{isExtracting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}{isExtracting ? 'Extracting...' : 'Extract from script'}</button><button type="button" onClick={() => void loadObjects()} disabled={isLoading} title="Refresh objects" className="inline-flex h-9 w-9 items-center justify-center border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} /></button></div></header>
    <ErrorBanner error={error} onDismiss={() => setError(null)} className="mb-5" />
    {notice && <div className="mb-5 border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</div>}
    {isLoading ? <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-zinc-500"><RefreshCw className="h-5 w-5 animate-spin" />Loading objects...</div> : <div className={`grid gap-6 ${(isProfileVisible && (selected || isCreating)) ? 'xl:grid-cols-[minmax(0,1fr)_26rem]' : ''}`}><div className="overflow-x-auto border border-zinc-800 bg-zinc-950">{objects.length === 0 ? <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center"><Box className="mb-3 h-7 w-7 text-zinc-600" /><h2 className="text-sm font-semibold text-zinc-300">No objects yet</h2><p className="mt-1 max-w-sm text-sm text-zinc-500">Extract story-significant physical objects from the saved script or add one manually.</p><div className="mt-4 flex gap-2"><button type="button" onClick={() => void extractObjects()} disabled={isExtracting} className="h-9 bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50">Extract from script</button><button type="button" onClick={() => { setForm(EMPTY_FORM); setIsCreating(true); }} className="h-9 border border-zinc-700 px-3 text-xs font-semibold text-zinc-300 hover:bg-zinc-900">New object</button></div></div> : <table className="w-full min-w-200 text-left text-sm"><thead className="border-b border-zinc-800 bg-zinc-900/50 text-xs font-semibold uppercase tracking-wide text-zinc-500"><tr><th className="w-12 px-4 py-3 text-right">#</th><th className="px-4 py-3">Object</th><th className="px-4 py-3">Tier</th><th className="px-4 py-3 text-right" title="Scenes the object appears in">Scenes</th><th className="px-4 py-3 text-right" title="Times a character handles the object">Interactions</th><th className="px-4 py-3">Description</th><th className="px-4 py-3 text-right">Source</th></tr></thead><tbody className="divide-y divide-zinc-800/80">{objects.map((object) => <tr key={object.id} onClick={() => selectObject(object)} className={`cursor-pointer hover:bg-zinc-900/70 ${selectedId === object.id ? 'bg-violet-500/10' : ''}`}><td className="px-4 py-3 text-right font-mono text-xs text-zinc-500">{object.ranking?.rank ?? '–'}</td><td className="px-4 py-3 font-semibold text-zinc-200">{object.name}</td><td className="px-4 py-3"><TierBadge ranking={object.ranking} /></td><td className="px-4 py-3 text-right font-mono text-xs text-zinc-400">{object.ranking?.scene_count ?? 0}</td><td className="px-4 py-3 text-right font-mono text-xs text-zinc-400" title={object.ranking?.interacting_characters.join(', ') || undefined}>{object.ranking?.interaction_count ?? 0}</td><td className="max-w-xs truncate px-4 py-3 text-zinc-400">{object.description || 'Not specified'}</td><td className="px-4 py-3 text-right"><span className="inline-flex flex-wrap justify-end gap-1">{object.sources.map((source) => <SourceBadge key={source} source={source} />)}</span></td></tr>)}</tbody></table>}</div>
      {isProfileVisible && (selected || isCreating) && <aside className="border border-zinc-800 bg-zinc-950"><div className="p-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-bold text-zinc-100">{isCreating ? 'New object' : selected?.name}</h2><p className="mt-0.5 text-sm text-violet-300">{isCreating ? 'Manual profile' : selected?.sources.map((source) => source === 'manual' ? 'Manual' : 'From script').join(' + ')}</p></div>{selected && !isEditing && <button type="button" onClick={() => { setForm(formFromObject(selected)); setIsEditing(true); }} title="Edit object profile" className="inline-flex h-8 w-8 items-center justify-center border border-zinc-700 text-zinc-300 hover:bg-zinc-900"><Pencil className="h-3.5 w-3.5" /></button>}</div>{selected?.primary_image_url && <div className="relative mt-4 aspect-square overflow-hidden border border-zinc-800 bg-zinc-900"><Image src={selected.primary_image_url} alt={selected.name} fill sizes="416px" unoptimized className="object-contain" /></div>}{(isCreating || isEditing) ? <div className="mt-4 space-y-3"><label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-600">Name</span><input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="w-full border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-400" /></label><label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-600">Description</span><textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="min-h-24 w-full resize-y border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-400" /></label><label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-600">Tags</span><input value={form.tags} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))} placeholder="vehicle, artifact" className="w-full border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-400" /></label><div className="flex gap-2"><button type="button" onClick={() => void (isCreating ? saveNewObject() : saveObject())} disabled={isSaving} className="inline-flex h-9 flex-1 items-center justify-center gap-2 bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"><Save className="h-3.5 w-3.5" />{isSaving ? 'Saving...' : 'Save object'}</button><button type="button" onClick={() => { setIsCreating(false); setIsEditing(false); if (selected) setForm(formFromObject(selected)); }} className="h-9 border border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-900">Cancel</button></div></div> : selected && <><dl className="mt-4 space-y-3 border-y border-zinc-800 py-3 text-xs"><div><dt className="text-zinc-600">Description</dt><dd className="mt-1 leading-5 text-zinc-300">{selected.description || 'Not specified'}</dd></div><div><dt className="text-zinc-600">Tags</dt><dd className="mt-1 text-zinc-300">{selected.tags.length ? selected.tags.join(', ') : 'Not specified'}</dd></div><div><dt className="text-zinc-600">Profile ownership</dt><dd className="mt-1 flex flex-wrap gap-1">{selected.manual_override_fields.length ? selected.manual_override_fields.map((field) => <SourceBadge key={field} source="manual" />) : <SourceBadge source="script" />}</dd></div></dl><RankingDetails ranking={selected.ranking} /><button type="button" onClick={() => void generateReference()} disabled={isGenerating} className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"><Wand2 className="h-3.5 w-3.5" />{isGenerating ? 'Creating reference...' : 'Create reference image'}</button>{projectId && <ReferenceGallery projectId={projectId} entityType="prop" entityId={selected.id} entityName={selected.name} refreshKey={galleryRefreshKey} onChanged={() => void loadObjects()} />}{selected.source_sluglines.length > 0 && <section className="mt-4"><h3 className="text-xs font-semibold text-zinc-300">Script evidence</h3><div className="mt-2 space-y-2">{selected.source_sluglines.map((slugline) => <p key={slugline} className="border-l-2 border-sky-400/40 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-400">{slugline}</p>)}</div></section>}<button type="button" onClick={() => void removeObject()} disabled={isSaving} className="mt-5 inline-flex h-9 w-full items-center justify-center gap-2 border border-red-500/40 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />Delete object</button></>}</div></aside>}</div>}
  </div></div>;
}