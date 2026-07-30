"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { AlertCircle, Eye, EyeOff, FileText, Image as ImageIcon, Pencil, RefreshCw, RotateCcw, Save, Users, Wand2 } from 'lucide-react';
import ImagePreviewModal, { ImagePreview } from '@/components/ui/ImagePreviewModal';
import { generateImageFromUpload, generateScriptCharacterImages } from '@/lib/api/image-generation';
import {
  CharacterProfileUpdate,
  CharacterScriptSyncPreview,
  confirmCharacterScriptSync,
  extractScriptCharacters,
  previewCharacterScriptSync,
  updateCharacterProfile,
} from '@/lib/api/story';
import { supabase } from '@/lib/supabaseClient';

interface CharactersProps {
  projectId: string | null;
  onSelect: (item: Record<string, unknown>) => void;
}

type CharacterView = 'front' | 'left_three_quarter' | 'left_profile' | 'back' | 'right_profile' | 'right_three_quarter';
type GenerationMode = 'text' | 'image';
type EditableField = 'role' | 'age' | 'gender' | 'race' | 'appearance' | 'personality';
type ProfileForm = Record<EditableField, string>;

interface ViewAsset { assetId: string; imageUrl: string; view: CharacterView; }
interface StudioCharacter {
  id: string;
  name: string;
  characterType: 'main' | 'supporting';
  role: string | null;
  age: number | null;
  gender: string | null;
  race: string | null;
  appearance: string | null;
  personality: string | null;
  tags: string[];
  primaryImageUrl: string | null;
  latestGenerationJobId: string | null;
  manualOverrideFields: EditableField[];
  views: ViewAsset[];
}

const VIEWS: CharacterView[] = ['front', 'left_three_quarter', 'left_profile', 'back', 'right_profile', 'right_three_quarter'];
const VIEW_LABELS: Record<CharacterView, string> = {
  front: 'Front', left_three_quarter: 'Left 3/4', left_profile: 'Left profile', back: 'Back', right_profile: 'Right profile', right_three_quarter: 'Right 3/4',
};
const EDITABLE_FIELDS: EditableField[] = ['role', 'age', 'gender', 'race', 'appearance', 'personality'];
const EMPTY_FORM: ProfileForm = { role: '', age: '', gender: '', race: '', appearance: '', personality: '' };
const displayValue = (value: string | number | null) => value === null || value === '' ? 'Not specified' : String(value);

function formFromCharacter(character: StudioCharacter): ProfileForm {
  return {
    role: character.role ?? '', age: character.age === null ? '' : String(character.age), gender: character.gender ?? '', race: character.race ?? '',
    appearance: character.appearance ?? '', personality: character.personality ?? '',
  };
}

interface ProfileFieldProps {
  field: EditableField;
  label: string;
  multiline?: boolean;
  selected: StudioCharacter;
  isEditingProfile: boolean;
  profileForm: ProfileForm;
  isSavingProfile: boolean;
  onChange: (field: EditableField, value: string) => void;
  onReset: (field: EditableField) => void;
}

function ProfileField({ field, label, multiline = false, selected, isEditingProfile, profileForm, isSavingProfile, onChange, onReset }: ProfileFieldProps) {
  const manual = selected.manualOverrideFields.includes(field);
  const value = selected[field];
  if (isEditingProfile) {
    const inputClass = "w-full border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-400";
    return <label className={multiline ? 'col-span-2 block' : 'block'}><span className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-zinc-600">{label}</span>{multiline ? <textarea required value={profileForm[field]} onChange={(event) => onChange(field, event.target.value)} className={`${inputClass} min-h-18 resize-y`} /> : <input required type={field === 'age' ? 'number' : 'text'} min={field === 'age' ? 0 : undefined} step={field === 'age' ? 1 : undefined} value={profileForm[field]} onChange={(event) => onChange(field, event.target.value)} className={`${inputClass} ${field === 'age' ? 'appearance-textfield [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none' : ''}`} />}</label>;
  }
  return <div className={multiline ? 'col-span-2' : ''}><dt className="flex items-center gap-1 text-zinc-600">{label}<span className={`border px-1 text-[9px] font-semibold uppercase ${manual ? 'border-violet-400/30 text-violet-300' : 'border-zinc-700 text-zinc-500'}`}>{manual ? 'Manual' : 'From script'}</span></dt><dd className="mt-1 text-zinc-300">{displayValue(value as string | number | null)}</dd>{manual && <button type="button" onClick={() => onReset(field)} disabled={isSavingProfile} className="mt-1 inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-200"><RotateCcw className="h-3 w-3" />Reset to script</button>}</div>;
}

export function Characters({ projectId, onSelect }: CharactersProps) {
  const referenceImageInputRef = useRef<HTMLInputElement>(null);
  const [characters, setCharacters] = useState<StudioCharacter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isProfileVisible, setIsProfileVisible] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSyncingScript, setIsSyncingScript] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [selectedView, setSelectedView] = useState<CharacterView>('front');
  const [generationMode, setGenerationMode] = useState<GenerationMode | null>(null);
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [referenceGuidance, setReferenceGuidance] = useState('');
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileForm>(EMPTY_FORM);
  const [scriptPreview, setScriptPreview] = useState<CharacterScriptSyncPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadCharacters = useCallback(async () => {
    if (!projectId) { setCharacters([]); return; }
    setIsLoading(true);
    setError(null);
    try {
      const { data: rows, error: charactersError } = await supabase.from('characters')
        .select('id, name, character_type, role, age, gender, race, appearance, personality, tags, primary_asset_id, metadata')
        .eq('project_id', projectId).eq('metadata->>source', 'script').order('name');
      if (charactersError) throw charactersError;
      const characterRows = rows ?? [];
      const primaryIds = characterRows.map((row) => row.primary_asset_id as string | null).filter(Boolean) as string[];
      const { data: primaryAssets, error: primaryError } = primaryIds.length
        ? await supabase.from('assets').select('id, url').in('id', primaryIds) : { data: [], error: null };
      if (primaryError) throw primaryError;
      const primaryUrls = new Map((primaryAssets ?? []).map((asset) => [asset.id as string, asset.url as string]));
      const ids = characterRows.map((row) => row.id as string);
      const { data: links, error: linksError } = ids.length ? await supabase.from('asset_links')
        .select('target_id, asset_id, metadata').eq('project_id', projectId).eq('target_type', 'character').eq('role', 'keyframe').in('target_id', ids) : { data: [], error: null };
      if (linksError) throw linksError;
      const assetIds = (links ?? []).map((link) => link.asset_id as string);
      const { data: assets, error: assetsError } = assetIds.length ? await supabase.from('assets').select('id, url').in('id', assetIds) : { data: [], error: null };
      if (assetsError) throw assetsError;
      const urls = new Map((assets ?? []).map((asset) => [asset.id as string, asset.url as string]));
      const loaded = characterRows.map((row): StudioCharacter => {
        const metadata = (row.metadata ?? {}) as Record<string, unknown>;
        const overrides = (metadata.manual_overrides ?? {}) as Record<string, unknown>;
        const effective = <T,>(field: EditableField, scriptValue: T): T => overrides[field] === undefined ? scriptValue : overrides[field] as T;
        const latestGenerationJobId = typeof metadata.latest_generation_job_id === 'string' ? metadata.latest_generation_job_id : null;
        const manualOverrideFields = EDITABLE_FIELDS.filter((field) => overrides[field] !== undefined);
        const characterLinks = (links ?? []).filter((link) => link.target_id === row.id);
        const latestLinks = latestGenerationJobId ? characterLinks.filter((link) => {
          const linkMetadata = (link.metadata ?? {}) as Record<string, unknown>;
          return linkMetadata.generation_job_id === latestGenerationJobId;
        }) : characterLinks;
        const views = (latestLinks.length > 0 ? latestLinks : characterLinks).flatMap((link): ViewAsset[] => {
          const view = ((link.metadata ?? {}) as Record<string, unknown>).view as CharacterView;
          const imageUrl = urls.get(link.asset_id as string);
          return imageUrl && VIEWS.includes(view) ? [{ assetId: link.asset_id as string, imageUrl, view }] : [];
        });
        return {
          id: row.id as string, name: row.name as string, characterType: row.character_type === 'main' ? 'main' : 'supporting',
          role: effective('role', row.role as string | null), age: effective('age', row.age as number | null), gender: effective('gender', row.gender as string | null),
          race: effective('race', row.race as string | null), appearance: effective('appearance', row.appearance as string | null), personality: effective('personality', row.personality as string | null),
          tags: (row.tags as string[] | null) ?? [], primaryImageUrl: primaryUrls.get(row.primary_asset_id as string) ?? null, latestGenerationJobId, manualOverrideFields, views,
        };
      });
      setCharacters(loaded);
      setSelectedId((current) => loaded.some((character) => character.id === current) ? current : null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load script characters.');
    } finally { setIsLoading(false); }
  }, [projectId]);

  useEffect(() => { void loadCharacters(); }, [loadCharacters]);
  useEffect(() => {
    if (!isGenerating) { setGenerationProgress(0); return; }
    let progress = 4;
    setGenerationProgress(progress);
    const interval = window.setInterval(() => {
      progress = Math.min(95, progress + Math.max(1, Math.ceil((95 - progress) * 0.08)));
      setGenerationProgress(progress);
    }, 650);
    return () => window.clearInterval(interval);
  }, [isGenerating]);

  const selected = characters.find((character) => character.id === selectedId) ?? null;
  const selectedPreviewAsset = selected?.views.find((asset) => asset.view === selectedView) ?? selected?.views.find((asset) => asset.view === 'front');
  const selectedPreview: ImagePreview[] = selected && (selectedPreviewAsset?.imageUrl ?? selected.primaryImageUrl) ? [{
    id: selectedPreviewAsset?.assetId ?? selected.id, url: selectedPreviewAsset?.imageUrl ?? selected.primaryImageUrl!,
    prompt: `${selected.name} - ${VIEW_LABELS[selectedPreviewAsset?.view ?? selectedView]}`, model: 'Character reference', aspect_ratio: '2:3',
  }] : [];

  const selectCharacter = (character: StudioCharacter) => {
    setSelectedId(character.id); setSelectedView('front'); setGenerationMode(null); setReferenceImage(null); setReferenceGuidance('');
    setIsProfileVisible(true); setIsEditingProfile(false); setScriptPreview(null); setProfileForm(formFromCharacter(character)); onSelect(character as unknown as Record<string, unknown>);
  };
  const beginProfileEdit = () => { if (selected) { setProfileForm(formFromCharacter(selected)); setIsEditingProfile(true); setNotice(null); } };
  const updateForm = (field: EditableField, value: string) => setProfileForm((current) => ({ ...current, [field]: value }));

  const saveProfile = async () => {
    if (!projectId || !selected) return;
    const update: CharacterProfileUpdate = {};
    for (const field of EDITABLE_FIELDS) {
      const current = field === 'age' ? (selected.age === null ? '' : String(selected.age)) : String(selected[field] ?? '');
      const next = profileForm[field].trim();
      if (!next) { setError(`${field[0].toUpperCase()}${field.slice(1)} is required. Use Reset to script to remove a manual value.`); return; }
      if (next === current) continue;
      if (field === 'age') {
        const age = Number(next);
        if (!Number.isInteger(age) || age < 0) { setError('Age must be a non-negative whole number.'); return; }
        update.age = age;
      } else update[field] = next;
    }
    if (Object.keys(update).length === 0) { setIsEditingProfile(false); return; }
    setIsSavingProfile(true); setError(null);
    try {
      await updateCharacterProfile(projectId, selected.id, update);
      await loadCharacters();
      setIsEditingProfile(false); setNotice('Character profile saved.');
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Failed to save character profile.'); }
    finally { setIsSavingProfile(false); }
  };

  const resetField = async (field: EditableField) => {
    if (!projectId || !selected) return;
    setIsSavingProfile(true); setError(null);
    try {
      await updateCharacterProfile(projectId, selected.id, { clear_fields: [field] });
      await loadCharacters(); setNotice(`${field[0].toUpperCase()}${field.slice(1)} restored to its script value.`);
    } catch (resetError) { setError(resetError instanceof Error ? resetError.message : 'Failed to reset profile field.'); }
    finally { setIsSavingProfile(false); }
  };

  const generateViews = async (mode: GenerationMode) => {
    if (!projectId || !selected) return;
    if (mode === 'image' && !referenceImage) { setError('Choose a reference image before generating views.'); return; }
    setIsGenerating(true); setError(null);
    try {
      if (mode === 'image' && referenceImage) await generateImageFromUpload(referenceImage, referenceGuidance, 'nanobanana', 'replicate', projectId, selected.id);
      else await generateScriptCharacterImages({ project_id: projectId, character_id: selected.id, model: 'nanobanana', provider: 'replicate' });
      setGenerationProgress(100); await loadCharacters(); setGenerationMode(null); setReferenceImage(null); setReferenceGuidance('');
    } catch (generationError) { setError(generationError instanceof Error ? generationError.message : 'Failed to generate character views.'); }
    finally { setIsGenerating(false); }
  };

  const extractCharacters = async () => {
    if (!projectId) return;
    setIsExtracting(true); setError(null);
    try { await extractScriptCharacters(projectId); await loadCharacters(); }
    catch (extractionError) { setError(extractionError instanceof Error ? extractionError.message : 'Failed to extract characters from the current script.'); }
    finally { setIsExtracting(false); }
  };

  const openScriptPreview = async () => {
    if (!projectId || !selected) return;
    setIsSyncingScript(true); setError(null);
    try { setScriptPreview(await previewCharacterScriptSync(projectId, selected.id)); }
    catch (previewError) { setError(previewError instanceof Error ? previewError.message : 'Failed to preview script update.'); }
    finally { setIsSyncingScript(false); }
  };

  const confirmScriptUpdate = async () => {
    if (!projectId || !scriptPreview) return;
    setIsSyncingScript(true); setError(null);
    try {
      const result = await confirmCharacterScriptSync(projectId, scriptPreview);
      setScriptPreview(null); setNotice(`Script ${result.action === 'insert' ? 'updated' : 'description refreshed'} in ${result.scene_slugline ?? 'the first appearance scene'}.`);
    } catch (syncError) { setError(syncError instanceof Error ? syncError.message : 'Failed to update script.'); }
    finally { setIsSyncingScript(false); }
  };

  if (!projectId) return <div className="flex h-full items-center justify-center text-sm text-zinc-500">Loading project...</div>;

  return <div className="h-full overflow-auto px-6 py-7 lg:px-8"><div className="mx-auto max-w-7xl">
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-5"><div><div className="flex items-center gap-2.5"><Users className="h-5 w-5 text-violet-400" /><h1 className="text-xl font-bold text-zinc-100">Script Characters</h1></div><p className="mt-1 text-sm text-zinc-500">Script facts remain traceable while manual character decisions stay explicit.</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => setIsProfileVisible((visible) => !visible)} disabled={!selected} title={isProfileVisible ? 'Conceal character profile' : 'Preview character profile'} className="inline-flex h-9 w-9 items-center justify-center border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">{isProfileVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button><button type="button" onClick={() => void loadCharacters()} disabled={isLoading} className="inline-flex h-9 items-center gap-2 border border-zinc-700 bg-zinc-900 px-3 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />Refresh</button></div></header>
    {error && <div className="mb-5 flex items-center gap-2 border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"><AlertCircle className="h-4 w-4" />{error}</div>}
    {notice && <div className="mb-5 border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</div>}
    {isLoading ? <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-zinc-500"><RefreshCw className="h-5 w-5 animate-spin" />Loading script characters...</div> : characters.length === 0 ? <div className="flex min-h-72 flex-col items-center justify-center border border-dashed border-zinc-800 px-6 text-center"><FileText className="mb-3 h-7 w-7 text-zinc-600" /><h2 className="text-sm font-semibold text-zinc-300">No extracted characters yet</h2><p className="mt-1 max-w-sm text-sm text-zinc-500">Extract named characters and supported metadata from the script already saved in this project.</p><button type="button" onClick={() => void extractCharacters()} disabled={isExtracting} className="mt-4 inline-flex h-9 items-center justify-center gap-2 bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50">{isExtracting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}{isExtracting ? 'Extracting characters...' : 'Extract from current script'}</button></div> : <div className={`grid gap-6 ${isProfileVisible ? 'xl:grid-cols-[minmax(0,1fr)_26rem]' : ''}`}>
      <div className="overflow-x-auto border border-zinc-800 bg-zinc-950"><table className="w-full min-w-200 text-left text-sm"><thead className="border-b border-zinc-800 bg-zinc-900/50 text-xs font-semibold uppercase tracking-wide text-zinc-500"><tr><th className="px-4 py-3">Character</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Age</th><th className="px-4 py-3">Gender</th><th className="px-4 py-3">Race</th><th className="px-4 py-3 text-right">Views</th></tr></thead><tbody className="divide-y divide-zinc-800/80">{characters.map((character) => { const cell = (field: EditableField) => character[field] === null || character[field] === '' ? <button type="button" onClick={(event) => { event.stopPropagation(); selectCharacter(character); setProfileForm(formFromCharacter(character)); setIsEditingProfile(true); }} className="text-xs text-violet-300 hover:text-violet-200">Add value</button> : <span className="text-zinc-400">{String(character[field])}</span>; return <tr key={character.id} onClick={() => selectCharacter(character)} className={`cursor-pointer hover:bg-zinc-900/70 ${selectedId === character.id ? 'bg-violet-500/10' : ''}`}><td className="px-4 py-3"><div className="flex items-center gap-3"><div className="relative h-10 w-8 overflow-hidden bg-zinc-900">{character.primaryImageUrl ? <Image src={character.primaryImageUrl} alt="" fill sizes="32px" unoptimized className="object-cover" /> : <ImageIcon className="m-2 h-4 w-4 text-zinc-700" />}</div><span className="font-semibold text-zinc-200">{character.name}</span></div></td><td className="px-4 py-3">{cell('role')}</td><td className="px-4 py-3">{cell('age')}</td><td className="px-4 py-3">{cell('gender')}</td><td className="px-4 py-3">{cell('race')}</td><td className="px-4 py-3 text-right font-mono text-xs text-zinc-400">{character.views.length}/6</td></tr>; })}</tbody></table></div>
      {isProfileVisible && <aside className="border border-zinc-800 bg-zinc-950">{selected ? <div><div className="relative aspect-[2/3] overflow-hidden border-b border-zinc-800 bg-zinc-900">{selectedPreview.length ? <button type="button" onClick={() => setIsImagePreviewOpen(true)} aria-label={`Preview ${selected.name}`} className="absolute inset-0 block w-full cursor-zoom-in"><Image src={selectedPreview[0].url} alt={selectedPreview[0].prompt} fill sizes="416px" unoptimized className="object-contain" /></button> : <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-600"><ImageIcon className="h-7 w-7" /><span className="text-xs">Views not generated</span></div>}<div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-zinc-950/85 px-3 py-2 text-xs"><span className="font-semibold text-zinc-200">{VIEW_LABELS[selectedPreviewAsset?.view ?? selectedView]}</span><span className="font-mono text-zinc-500">{selected.views.length}/6</span></div></div><div className="p-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-bold text-zinc-100">{selected.name}</h2><p className="mt-0.5 text-sm text-violet-300">{displayValue(selected.role)}</p></div><button type="button" onClick={beginProfileEdit} className="inline-flex h-8 w-8 items-center justify-center border border-zinc-700 text-zinc-300 hover:bg-zinc-900" title="Edit character profile"><Pencil className="h-3.5 w-3.5" /></button></div><dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-zinc-800 py-3 text-xs"><ProfileField field="age" label="Age" selected={selected} isEditingProfile={isEditingProfile} profileForm={profileForm} isSavingProfile={isSavingProfile} onChange={updateForm} onReset={(field) => void resetField(field)} /><ProfileField field="gender" label="Gender" selected={selected} isEditingProfile={isEditingProfile} profileForm={profileForm} isSavingProfile={isSavingProfile} onChange={updateForm} onReset={(field) => void resetField(field)} /><ProfileField field="race" label="Race" selected={selected} isEditingProfile={isEditingProfile} profileForm={profileForm} isSavingProfile={isSavingProfile} onChange={updateForm} onReset={(field) => void resetField(field)} /><ProfileField field="role" label="Role" selected={selected} isEditingProfile={isEditingProfile} profileForm={profileForm} isSavingProfile={isSavingProfile} onChange={updateForm} onReset={(field) => void resetField(field)} /><ProfileField field="appearance" label="Appearance" multiline selected={selected} isEditingProfile={isEditingProfile} profileForm={profileForm} isSavingProfile={isSavingProfile} onChange={updateForm} onReset={(field) => void resetField(field)} /><ProfileField field="personality" label="Personality" multiline selected={selected} isEditingProfile={isEditingProfile} profileForm={profileForm} isSavingProfile={isSavingProfile} onChange={updateForm} onReset={(field) => void resetField(field)} /></dl>{isEditingProfile && <div className="mt-3 flex gap-2"><button type="button" onClick={() => void saveProfile()} disabled={isSavingProfile} className="inline-flex h-9 flex-1 items-center justify-center gap-2 bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"><Save className="h-3.5 w-3.5" />{isSavingProfile ? 'Saving...' : 'Save profile'}</button><button type="button" onClick={() => setIsEditingProfile(false)} className="h-9 border border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-900">Cancel</button></div>}<div className="mt-4"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold text-zinc-300">Turnaround views</span><span className="font-mono text-[10px] text-zinc-600">Select an angle</span></div><div className="grid grid-cols-3 gap-2">{VIEWS.map((view) => { const asset = selected.views.find((candidate) => candidate.view === view); const active = selectedView === view; return <button key={view} type="button" onClick={() => { setSelectedView(view); if (asset) setIsImagePreviewOpen(true); }} aria-pressed={active} className={`relative aspect-[2/3] overflow-hidden border text-left ${active ? 'border-violet-400 ring-1 ring-violet-400/50' : 'border-zinc-800 hover:border-zinc-600'}`}>{asset ? <Image src={asset.imageUrl} alt={`${selected.name} ${VIEW_LABELS[view]}`} fill sizes="128px" unoptimized className="object-contain bg-zinc-900" /> : <div className="absolute inset-0 flex items-center justify-center bg-zinc-900 text-zinc-600"><ImageIcon className="h-4 w-4" /></div>}<span className="absolute bottom-0 left-0 right-0 bg-zinc-950/85 px-1.5 py-1 text-center text-[10px] font-medium text-zinc-300">{VIEW_LABELS[view]}</span></button>; })}</div></div><div className="mt-4 border-t border-zinc-800 pt-4"><button type="button" onClick={() => void openScriptPreview()} disabled={isSyncingScript || selected.manualOverrideFields.length === 0} title={selected.manualOverrideFields.length ? 'Preview a controlled update to the first character appearance' : 'Save a manual profile value before updating the script'} className="flex h-9 w-full items-center justify-center gap-2 border border-zinc-700 text-xs font-semibold text-zinc-200 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"><FileText className="h-3.5 w-3.5" />{isSyncingScript ? 'Preparing script update...' : 'Update script'}</button></div><input ref={referenceImageInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => setReferenceImage(event.target.files?.[0] ?? null)} />{isGenerating ? <div className="mt-4" role="status" aria-live="polite"><div className="mb-1.5 flex items-center justify-between text-xs"><span className="text-zinc-400">Generating views</span><span className="font-mono text-violet-300">{generationProgress}%</span></div><div className="h-1.5 overflow-hidden bg-zinc-800"><div className="h-full bg-violet-500 transition-[width] duration-500" style={{ width: `${generationProgress}%` }} /></div></div> : generationMode === 'image' ? <div className="mt-4 border border-zinc-800 bg-zinc-900/50 p-3"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold text-zinc-200">Reference image</span><button type="button" onClick={() => { setGenerationMode(null); setReferenceImage(null); setReferenceGuidance(''); }} className="text-xs text-zinc-500 hover:text-zinc-200">Back</button></div><button type="button" onClick={() => referenceImageInputRef.current?.click()} className="flex h-10 w-full items-center justify-between border border-dashed border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-400 hover:border-zinc-500"><span className="truncate">{referenceImage?.name ?? 'Choose image'}</span><ImageIcon className="h-4 w-4 shrink-0" /></button><textarea value={referenceGuidance} onChange={(event) => setReferenceGuidance(event.target.value)} placeholder="Optional visual direction" className="mt-2 min-h-20 w-full resize-none border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-400" /><button type="button" onClick={() => void generateViews('image')} disabled={!referenceImage} className="mt-2 flex h-10 w-full items-center justify-center gap-2 bg-violet-600 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"><ImageIcon className="h-4 w-4" />Generate from image</button></div> : <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => void generateViews('text')} className="flex min-h-20 flex-col items-start justify-center border border-violet-400/40 bg-violet-500/10 px-3 text-left text-violet-200 hover:bg-violet-500/20"><Wand2 className="mb-2 h-4 w-4" /><span className="text-xs font-semibold">Create from text</span><span className="mt-0.5 text-[10px] text-violet-300/80">Use effective character profile</span></button><button type="button" onClick={() => setGenerationMode('image')} className="flex min-h-20 flex-col items-start justify-center border border-zinc-700 bg-zinc-900 px-3 text-left text-zinc-200 hover:border-zinc-500"><ImageIcon className="mb-2 h-4 w-4" /><span className="text-xs font-semibold">Use reference image</span><span className="mt-0.5 text-[10px] text-zinc-500">Preserve visual likeness</span></button></div>}</div></div> : <div className="flex min-h-96 flex-col items-center justify-center px-6 text-center text-sm text-zinc-600"><Users className="mb-3 h-6 w-6" />Select a character to inspect its script profile.</div>}</aside>}</div>}
  </div>{scriptPreview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><div role="dialog" aria-modal="true" aria-labelledby="script-sync-title" className="w-full max-w-lg border border-zinc-700 bg-zinc-950 p-5 shadow-2xl"><h2 id="script-sync-title" className="text-base font-semibold text-zinc-100">Review script update</h2><p className="mt-2 text-sm text-zinc-400">{scriptPreview.action === 'insert' ? 'Insert' : 'Replace'} one managed action line before the first appearance in <span className="text-zinc-200">{scriptPreview.scene_slugline ?? 'the selected scene'}</span>.</p><pre className="mt-4 whitespace-pre-wrap border border-zinc-800 bg-zinc-900/50 p-3 font-sans text-sm leading-6 text-zinc-200">{scriptPreview.content}</pre><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setScriptPreview(null)} disabled={isSyncingScript} className="h-9 border border-zinc-700 px-3 text-xs font-semibold text-zinc-300 hover:bg-zinc-900">Cancel</button><button type="button" onClick={() => void confirmScriptUpdate()} disabled={isSyncingScript} className="h-9 bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50">{isSyncingScript ? 'Updating...' : 'Confirm update'}</button></div></div></div>}<ImagePreviewModal isOpen={isImagePreviewOpen} onClose={() => setIsImagePreviewOpen(false)} images={selectedPreview} selectedIndex={0} onNavigate={() => undefined} /></div>;
}