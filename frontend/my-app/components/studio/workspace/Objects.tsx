"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { AlertCircle, Box, CheckCircle2, Clapperboard, Expand, Eye, EyeOff, FileText, Hand, LayoutPanelLeft, Pencil, Plus, RefreshCw, Save, Trash2, Wand2, X } from 'lucide-react';
import {
  createObject,
  deleteObject,
  extractScriptObjects,
  listObjects,
  OBJECT_PROFILE_FIELDS,
  ObjectProfileField,
  ObjectProfileUpdate,
  ObjectRanking,
  ObjectTier,
  StudioObject,
  updateObject,
} from '@/lib/api/story';
import { approveObjectSheet, generateObjectReferenceImage, generateObjectSheet } from '@/lib/api/image-generation';
import { ObjectSheetReference } from '@/lib/types/image-generation';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import ImagePreviewModal, { ImagePreview } from '@/components/ui/ImagePreviewModal';
import { RankingStat, TierBadge } from './ImportanceTier';
import { ReferenceGallery } from './ReferenceGallery';
import { ObjectSheetCreator } from './ObjectSheetCreator';
import { EntityCard, EntityRow, EntityStat, EntityThumb, TierGroups } from './entity/EntityCards';
import { ProfileFact, SectionHeading } from './entity/ProfileFact';
import { PanelTabs } from './entity/PanelTabs';

interface ObjectsProps {
  projectId: string | null;
  onSelect: (item: Record<string, unknown>) => void;
}

type PanelTab = 'profile' | 'sheet';

const FIELD_LABELS: Record<ObjectProfileField, string> = {
  size: 'Size', shape: 'Shape', colors: 'Colours', material: 'Material', branding: 'Label / branding', details: 'Distinctive details',
};
const FIELD_PLACEHOLDERS: Record<ObjectProfileField, string> = {
  size: '330 ml, about 20 cm tall',
  shape: 'Tall bottle with a curved waist',
  colors: 'Green glass, red label',
  material: 'Glass, metal cap',
  branding: 'White "Tamucola" logo on the red label',
  details: 'Silver crown cap, embossed ridges near the base',
};
const MULTILINE_FIELDS: ObjectProfileField[] = ['branding', 'details'];

interface ObjectForm {
  name: string;
  description: string;
  tags: string;
  profile: Record<ObjectProfileField, string>;
}

const emptyProfile = () => Object.fromEntries(OBJECT_PROFILE_FIELDS.map((field) => [field, ''])) as Record<ObjectProfileField, string>;
const EMPTY_FORM: ObjectForm = { name: '', description: '', tags: '', profile: emptyProfile() };

function formFromObject(object: StudioObject): ObjectForm {
  return {
    name: object.name,
    description: object.description ?? '',
    tags: object.tags.join(', '),
    profile: Object.fromEntries(OBJECT_PROFILE_FIELDS.map((field) => [field, object.profile?.[field] ?? ''])) as Record<ObjectProfileField, string>,
  };
}

const tagsFromInput = (value: string): string[] => value.split(',').map((tag) => tag.trim()).filter(Boolean);

/** Only what changed, so untouched fields keep their From-script / Manual source. */
function changesFrom(object: StudioObject, form: ObjectForm): ObjectProfileUpdate {
  const update: ObjectProfileUpdate = {};
  if (form.name.trim() !== object.name) update.name = form.name.trim();
  if (form.description.trim() !== (object.description ?? '')) update.description = form.description.trim() || null;
  const tags = tagsFromInput(form.tags);
  if (tags.join('\u0000') !== object.tags.join('\u0000')) update.tags = tags;
  const profile: Partial<Record<ObjectProfileField, string | null>> = {};
  for (const field of OBJECT_PROFILE_FIELDS) {
    if (form.profile[field].trim() !== (object.profile?.[field] ?? '')) profile[field] = form.profile[field].trim() || null;
  }
  if (Object.keys(profile).length) update.profile = profile;
  return update;
}

const missingFields = (object: StudioObject) => OBJECT_PROFILE_FIELDS.filter((field) => !object.profile?.[field]);
const cardImage = (object: StudioObject) => object.sheet?.url ?? object.primary_image_url;
const formatElapsed = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const TIER_ADVICE: Record<ObjectTier, string> = {
  major: 'Key prop: fill in the profile and approve an object sheet; every shot showing it sends the sheet.',
  medium: 'Approve an object sheet, or add one or two clean reference images.',
  minor: 'A filled-in profile is often enough; shots draw it from the PROPS line.',
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

interface SheetResult { objectId: string; ok: boolean; message: string; seconds: number; }

interface ObjectSheetPanelProps {
  object: StudioObject;
  busy: boolean;
  approvingId: string | null;
  onApprove: (assetId: string) => void;
  onPreview: (url: string, label: string) => void;
}

/** The approved object sheet and every earlier version, any of which can be switched to. */
function ObjectSheetPanel({ object, busy, approvingId, onApprove, onPreview }: ObjectSheetPanelProps) {
  const { sheet, sheet_versions: versions } = object;
  if (!sheet && versions.length === 0) {
    return <div className="mb-3 flex flex-col items-center border border-dashed border-zinc-800 px-4 py-6 text-center">
      <LayoutPanelLeft className="mb-2 h-5 w-5 text-zinc-600" />
      <p className="text-xs font-semibold text-zinc-300">No object sheet yet</p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">One image showing {object.name} from the front, back, side and three-quarter, plus a close-up of its label. Every storyboard shot that shows it receives this sheet.</p>
    </div>;
  }
  return <div className="mb-3">
    {sheet && <button type="button" onClick={() => onPreview(sheet.url, `${object.name} - Object sheet`)} aria-label={`Preview ${object.name} object sheet`} className="relative block aspect-video w-full cursor-zoom-in overflow-hidden border border-zinc-800 bg-zinc-900 hover:border-zinc-600">
      <Image src={sheet.url} alt={`${object.name} object sheet`} fill sizes="416px" unoptimized className="object-contain" />
      <span className="absolute left-2 top-2 inline-flex items-center gap-1 bg-zinc-950/85 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300"><CheckCircle2 className="h-3 w-3" />Used in storyboards</span>
    </button>}
    {(versions.length > 1 || (!sheet && versions.length > 0)) && <div className="mt-3">
      <p className="mb-1.5 text-[10px] uppercase tracking-wide text-zinc-600">Versions</p>
      <div className="grid grid-cols-3 gap-1.5">{versions.map((version, index) => {
        const label = `${object.name} sheet version ${versions.length - index}`;
        return <div key={version.asset_id} className={`border ${version.approved ? 'border-emerald-400/50' : 'border-zinc-800'}`}>
          <button type="button" onClick={() => onPreview(version.url, label)} className="relative block aspect-video w-full cursor-zoom-in overflow-hidden bg-zinc-900"><Image src={version.url} alt={label} fill sizes="128px" unoptimized className="object-cover" /></button>
          {version.approved ? <span className="flex h-6 items-center justify-center text-[10px] font-semibold text-emerald-300">In use</span>
            : <button type="button" onClick={() => onApprove(version.asset_id)} disabled={busy} className="flex h-6 w-full items-center justify-center text-[10px] font-semibold text-violet-200 hover:bg-violet-500/15 disabled:opacity-50">{approvingId === version.asset_id ? 'Approving...' : 'Approve'}</button>}
        </div>;
      })}</div>
    </div>}
  </div>;
}

export function Objects({ projectId, onSelect }: ObjectsProps) {
  const [objects, setObjects] = useState<StudioObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingReference, setIsGeneratingReference] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isPanelVisible, setIsPanelVisible] = useState(true);
  const [panelTab, setPanelTab] = useState<PanelTab>('profile');
  const [form, setForm] = useState<ObjectForm>(EMPTY_FORM);
  const [error, setError] = useState<string | Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [galleryRefreshKey, setGalleryRefreshKey] = useState(0);
  const [isGeneratingSheet, setIsGeneratingSheet] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sheetResult, setSheetResult] = useState<SheetResult | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImagePreview[] | null>(null);
  const startedAt = useRef(0);

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

  useEffect(() => {
    if (!isGeneratingSheet) return;
    const timer = window.setInterval(() => setElapsedSeconds(Math.round((Date.now() - startedAt.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [isGeneratingSheet]);

  const selected = objects.find((object) => object.id === selectedId) ?? null;
  const selectObject = (object: StudioObject) => {
    setSelectedId(object.id); setForm(formFromObject(object)); setIsEditing(false); setIsCreating(false); setIsPanelVisible(true);
    onSelect(object as unknown as Record<string, unknown>);
  };
  const startCreating = () => { setForm(EMPTY_FORM); setIsCreating(true); setIsEditing(false); setSelectedId(null); setIsPanelVisible(true); setPanelTab('profile'); };
  const beginEdit = () => { if (selected) { setForm(formFromObject(selected)); setIsEditing(true); setPanelTab('profile'); } };

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
      const created = await createObject(projectId, { name: form.name, description: form.description.trim() || null, tags: tagsFromInput(form.tags) });
      await loadObjects(); selectObject(created); setIsEditing(true); setNotice(`${created.name} created. Fill in its profile so every shot draws it the same way.`);
    } catch (reason) { setError(reason instanceof Error ? reason : 'Failed to create object.'); }
    finally { setIsSaving(false); }
  };

  const saveObject = async () => {
    if (!projectId || !selected) return;
    if (!form.name.trim()) { setError('Object name is required.'); return; }
    const update = changesFrom(selected, form);
    if (Object.keys(update).length === 0) { setIsEditing(false); return; }
    setIsSaving(true); setError(null);
    try {
      const updated = await updateObject(projectId, selected.id, update);
      await loadObjects(); setForm(formFromObject(updated)); setIsEditing(false); setNotice('Object profile saved.');
    } catch (reason) { setError(reason instanceof Error ? reason : 'Failed to save object.'); }
    finally { setIsSaving(false); }
  };

  const resetField = async (field: ObjectProfileField) => {
    if (!projectId || !selected) return;
    setIsSaving(true); setError(null);
    try { await updateObject(projectId, selected.id, { profile: { [field]: null } }); await loadObjects(); setNotice(`${FIELD_LABELS[field]} cleared.`); }
    catch (reason) { setError(reason instanceof Error ? reason : 'Failed to reset the field.'); }
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
    setIsGeneratingReference(true); setError(null);
    try {
      await generateObjectReferenceImage({ project_id: projectId, object_id: selected.id, model: 'nanobanana', provider: 'wavespeed' });
      await loadObjects(); setGalleryRefreshKey((key) => key + 1); setNotice('Object reference image created.');
    } catch (reason) { setError(reason instanceof Error ? reason : 'Failed to generate object reference image.'); }
    finally { setIsGeneratingReference(false); }
  };

  const generateSheet = async (prompt: string, references: ObjectSheetReference[], model: string): Promise<boolean> => {
    if (!projectId || !selected) return false;
    const objectId = selected.id;
    startedAt.current = Date.now(); setElapsedSeconds(0);
    setIsGeneratingSheet(true); setSheetResult(null); setError(null); setNotice(null);
    const seconds = () => Math.round((Date.now() - startedAt.current) / 1000);
    try {
      const result = await generateObjectSheet({ project_id: projectId, object_id: objectId, prompt, model, references });
      await loadObjects();
      setSheetResult({ objectId, ok: true, seconds: seconds(), message: result.approved ? 'Approved: storyboards now use this sheet.' : 'Kept as a new version. Approve it below to use it in storyboards.' });
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Failed to generate the object sheet.';
      setSheetResult({ objectId, ok: false, seconds: seconds(), message: `${message} Nothing was saved.` });
      return false;
    } finally { setIsGeneratingSheet(false); }
  };

  const approveSheet = async (assetId: string) => {
    if (!projectId || !selected) return;
    setApprovingId(assetId); setError(null); setNotice(null);
    try { await approveObjectSheet(projectId, selected.id, assetId); await loadObjects(); setNotice(`Storyboards now use this sheet for ${selected.name}.`); }
    catch (reason) { setError(reason instanceof Error ? reason : 'Failed to approve the object sheet.'); }
    finally { setApprovingId(null); }
  };

  const openPreview = (url: string, label: string) => setPreview([{ id: url, url, prompt: label, model: 'Object sheet', aspect_ratio: '16:9' }]);

  const stats = (object: StudioObject): EntityStat[] => [
    { icon: <Clapperboard className="h-3 w-3" />, value: object.ranking?.scene_count ?? 0, title: 'Scenes' },
    { icon: <Hand className="h-3 w-3" />, value: object.ranking?.interaction_count ?? 0, title: object.ranking?.interacting_characters.length ? `Handled by ${object.ranking.interacting_characters.join(', ')}` : 'Interactions' },
  ];
  const itemProps = (object: StudioObject) => {
    const missing = missingFields(object).length;
    return {
      name: object.name, imageUrl: cardImage(object), rank: object.ranking?.rank ?? null,
      badge: { label: object.sheet ? 'Sheet' : 'No sheet', ok: Boolean(object.sheet) },
      subtitle: object.description, stats: stats(object), note: missing ? `${missing} to fill` : null,
      selected: object.id === selectedId, onSelect: () => selectObject(object),
    };
  };

  if (!projectId) return <div className="flex h-full items-center justify-center text-sm text-zinc-500">Loading project...</div>;

  const showPanel = isPanelVisible && (selected || isCreating);
  const inputClass = 'w-full border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-400';

  const editForm = (creating: boolean) => <div className="space-y-3">
    <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-600">Name</span><input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className={inputClass} /></label>
    <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-600">Description</span><textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="What it is, in a sentence" className={`${inputClass} min-h-16 resize-y`} /></label>
    {!creating && <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
      <SectionHeading title="Look" hint="stays the same in every shot" />
      {OBJECT_PROFILE_FIELDS.map((field) => <ProfileFact key={field} label={FIELD_LABELS[field]} value={selected?.profile?.[field] ?? null} manual draft={form.profile[field]} placeholder={FIELD_PLACEHOLDERS[field]} multiline={MULTILINE_FIELDS.includes(field)} isEditing busy={isSaving}
        onChange={(value) => setForm((current) => ({ ...current, profile: { ...current.profile, [field]: value } }))} />)}
    </dl>}
    <label className="block"><span className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-zinc-600">Tags / aliases<span className="normal-case tracking-normal">Comma separated; shots match the object by name or tag</span></span><input value={form.tags} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))} placeholder="soda, bottle" className={inputClass} /></label>
    <div className="flex gap-2">
      <button type="button" onClick={() => void (creating ? saveNewObject() : saveObject())} disabled={isSaving} className="inline-flex h-9 flex-1 items-center justify-center gap-2 bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"><Save className="h-3.5 w-3.5" />{isSaving ? 'Saving...' : creating ? 'Create object' : 'Save profile'}</button>
      <button type="button" onClick={() => { setIsCreating(false); setIsEditing(false); if (selected) setForm(formFromObject(selected)); }} className="h-9 border border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-900">Cancel</button>
    </div>
  </div>;

  return <div className="h-full overflow-auto px-6 py-7 lg:px-8"><div className="mx-auto max-w-7xl">
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-5">
      <div><div className="flex items-center gap-2.5"><Box className="h-5 w-5 text-violet-400" /><h1 className="text-xl font-bold text-zinc-100">Objects</h1></div><p className="mt-1 text-sm text-zinc-500">Give key props a profile and an approved sheet so every shot draws them the same way.</p></div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setIsPanelVisible((visible) => !visible)} disabled={!selected} title={isPanelVisible ? 'Hide object panel' : 'Show object panel'} className="inline-flex h-9 w-9 items-center justify-center border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">{isPanelVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
        <button type="button" onClick={startCreating} className="inline-flex h-9 items-center gap-2 border border-zinc-700 bg-zinc-900 px-3 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"><Plus className="h-3.5 w-3.5" />New object</button>
        <button type="button" onClick={() => void extractObjects()} disabled={isExtracting} className="inline-flex h-9 items-center gap-2 bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50">{isExtracting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}{isExtracting ? 'Extracting...' : 'Extract from script'}</button>
        <button type="button" onClick={() => void loadObjects()} disabled={isLoading} title="Refresh objects" className="inline-flex h-9 w-9 items-center justify-center border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} /></button>
      </div>
    </header>
    <ErrorBanner error={error} onDismiss={() => setError(null)} className="mb-5" />
    {notice && <div className="mb-5 border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</div>}
    {isLoading && objects.length === 0 ? <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-zinc-500"><RefreshCw className="h-5 w-5 animate-spin" />Loading objects...</div> : <div className={`grid gap-6 ${showPanel ? 'xl:grid-cols-[minmax(0,1fr)_26rem]' : ''}`}>
      {objects.length === 0 ? <div className="flex min-h-72 flex-col items-center justify-center border border-dashed border-zinc-800 px-6 text-center">
        <Box className="mb-3 h-7 w-7 text-zinc-600" />
        <h2 className="text-sm font-semibold text-zinc-300">No objects yet</h2>
        <p className="mt-1 max-w-sm text-sm text-zinc-500">Extract story-significant physical objects from the saved script, or add one yourself (a product, a weapon, a letter...).</p>
        <div className="mt-4 flex gap-2"><button type="button" onClick={() => void extractObjects()} disabled={isExtracting} className="h-9 bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50">Extract from script</button><button type="button" onClick={startCreating} className="h-9 border border-zinc-700 px-3 text-xs font-semibold text-zinc-300 hover:bg-zinc-900">New object</button></div>
      </div> : <TierGroups
        items={objects}
        tierOf={(object) => object.ranking?.tier ?? null}
        renderCard={(object) => <EntityCard key={object.id} {...itemProps(object)} aspect="square" />}
        renderRow={(object) => <EntityRow key={object.id} {...itemProps(object)} />}
      />}
      {showPanel && <aside className="self-start border border-zinc-800 bg-zinc-950 xl:sticky xl:top-0 xl:max-h-[calc(100vh-9rem)] xl:overflow-y-auto">
        {isCreating ? <div className="p-4"><h2 className="mb-1 text-base font-bold text-zinc-100">New object</h2><p className="mb-4 text-[11px] text-zinc-500">Name it as the script does. You can fill in its look and make a sheet next.</p>{editForm(true)}</div>
          : selected && (() => {
            const missing = missingFields(selected);
            const image = cardImage(selected);
            return <div>
              <div className="flex items-start gap-3 border-b border-zinc-800 p-4">
                <button type="button" onClick={() => image && openPreview(image, `${selected.name}${selected.sheet ? ' - Object sheet' : ''}`)} disabled={!image} className="shrink-0 cursor-zoom-in border border-zinc-800 disabled:cursor-default" aria-label={`Preview ${selected.name}`}><EntityThumb name={selected.name} imageUrl={image} className="h-20 w-20" initialsClassName="text-xl" sizes="80px" fit="contain" /></button>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-bold text-zinc-100">{selected.name}</h2>
                  <p className={`line-clamp-2 text-xs ${selected.description ? 'text-zinc-400' : 'italic text-zinc-600'}`}>{selected.description ?? 'No description yet'}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500"><TierBadge ranking={selected.ranking} emptyLabel="Unranked" />{selected.ranking && <span className="font-mono">#{selected.ranking.rank}</span>}{selected.tags.map((tag) => <span key={tag} className="border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{tag}</span>)}</div>
                  <button type="button" onClick={() => selected.sheet && openPreview(selected.sheet.url, `${selected.name} - Object sheet`)} disabled={!selected.sheet} title={selected.sheet ? 'Open the object sheet' : 'No object sheet yet'} className="mt-2 inline-flex h-7 items-center gap-1.5 border border-violet-400/40 px-2 text-[11px] font-semibold text-violet-300 hover:bg-zinc-900 disabled:opacity-40"><Expand className="h-3.5 w-3.5" />Preview</button>
                </div>
                <button type="button" onClick={beginEdit} className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-zinc-700 text-zinc-300 hover:bg-zinc-900" title="Edit object profile"><Pencil className="h-3.5 w-3.5" /></button>
              </div>
              <PanelTabs<PanelTab> active={panelTab} onChange={setPanelTab} tabs={[
                { key: 'profile', label: 'Profile' },
                { key: 'sheet', label: <>Object sheet {selected.sheet ? <CheckCircle2 className="ml-1 inline h-3 w-3 text-emerald-400" /> : <span className="ml-1 font-normal text-zinc-500">none</span>}</> },
              ]} />
              <div className="p-4">{panelTab === 'profile' ? (isEditing ? editForm(false) : <>
                {missing.length > 0 && <button type="button" onClick={beginEdit} className="mb-4 flex w-full items-center justify-between gap-3 border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-left text-xs text-amber-200 hover:bg-amber-400/10"><span>{missing.length} detail{missing.length === 1 ? '' : 's'} missing</span><span className="shrink-0 font-semibold">Fill in</span></button>}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                  <ProfileFact label="Description" value={selected.description} manual={selected.manual_override_fields.includes('description')} isEditing={false} draft="" placeholder="" multiline busy={isSaving} onChange={() => undefined} />
                  <SectionHeading title="Look" hint="stays the same in every shot" />
                  {OBJECT_PROFILE_FIELDS.map((field) => <ProfileFact key={field} label={FIELD_LABELS[field]} value={selected.profile?.[field] ?? null} manual={selected.manual_override_fields.includes(field)} isEditing={false} draft="" placeholder="" multiline={MULTILINE_FIELDS.includes(field)} busy={isSaving} onChange={() => undefined} onReset={() => void resetField(field)} />)}
                </dl>
                <div className="mt-4 border-t border-zinc-800 pt-1"><RankingDetails ranking={selected.ranking} /></div>
                {selected.source_sluglines.length > 0 && <section className="mt-4"><h3 className="text-xs font-semibold text-zinc-300">Script evidence</h3><div className="mt-2 space-y-2">{selected.source_sluglines.map((slugline) => <p key={slugline} className="border-l-2 border-sky-400/40 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-400">{slugline}</p>)}</div></section>}
                <button type="button" onClick={() => void removeObject()} disabled={isSaving} className="mt-5 inline-flex h-9 w-full items-center justify-center gap-2 border border-red-500/40 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />Delete object</button>
              </>) : <>
                {sheetResult?.objectId === selected.id && <div role={sheetResult.ok ? 'status' : 'alert'} className={`mb-3 flex items-start gap-2 border p-3 ${sheetResult.ok ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-red-500/40 bg-red-500/10'}`}>
                  {sheetResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />}
                  <div className="min-w-0 flex-1"><p className={`text-xs font-semibold ${sheetResult.ok ? 'text-emerald-200' : 'text-red-200'}`}>{sheetResult.ok ? 'Object sheet generated' : 'Object sheet failed'} <span className="font-mono font-normal text-zinc-400">· {formatElapsed(sheetResult.seconds)}</span></p><p className={`mt-0.5 text-[11px] leading-relaxed ${sheetResult.ok ? 'text-emerald-100/80' : 'text-red-100/90'}`}>{sheetResult.message}</p></div>
                  <button type="button" onClick={() => setSheetResult(null)} aria-label="Dismiss" className="shrink-0 text-zinc-500 hover:text-zinc-200"><X className="h-3.5 w-3.5" /></button>
                </div>}
                <ObjectSheetPanel object={selected} busy={isGeneratingSheet || approvingId !== null} approvingId={approvingId} onApprove={(assetId) => void approveSheet(assetId)} onPreview={openPreview} />
                {isGeneratingSheet ? <div className="border border-violet-500/30 bg-violet-500/5 p-3" role="status" aria-live="polite">
                  <div className="flex items-center justify-between text-xs"><span className="flex items-center gap-2 text-zinc-200"><RefreshCw className="h-3.5 w-3.5 animate-spin text-violet-300" />Generating object sheet</span><span className="font-mono text-violet-300">{formatElapsed(elapsedSeconds)}</span></div>
                  <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">This usually takes under a minute. The result appears here.</p>
                </div> : <ObjectSheetCreator key={selected.id} projectId={projectId} objectName={selected.name} hasSheet={Boolean(selected.sheet)} busy={approvingId !== null} onGenerate={generateSheet} />}
                <ReferenceGallery projectId={projectId} entityType="prop" entityId={selected.id} entityName={selected.name} refreshKey={galleryRefreshKey} onChanged={() => void loadObjects()}
                  title="Extra reference images"
                  hint={selected.sheet ? 'Shots send the sheet first, then these when there is room (close-ups take the detail view).' : 'Without a sheet, shots use these images.'} />
                {!selected.primary_image_url && <button type="button" onClick={() => void generateReference()} disabled={isGeneratingReference} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 border border-zinc-700 text-xs font-semibold text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"><Wand2 className="h-3.5 w-3.5" />{isGeneratingReference ? 'Creating main image...' : 'Create a main image from the description'}</button>}
              </>}</div>
            </div>;
          })()}
      </aside>}
    </div>}
  </div>
  {preview && <ImagePreviewModal isOpen onClose={() => setPreview(null)} images={preview} selectedIndex={0} onNavigate={() => undefined} />}
  </div>;
}
