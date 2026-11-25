"use client";

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { AlertCircle, CheckCircle2, Clapperboard, X, Download, Expand, Eye, EyeOff, FileText, LayoutPanelLeft, MessageSquare, Mic, Pencil, RefreshCw, RotateCcw, Save, Users, Video } from 'lucide-react';
import { CharacterFact, CharacterSheetModal, downloadImage } from '@/components/characters/CharacterSheetModal';
import { characterTags, characterTheme } from '@/lib/characterTheme';
import { approveCharacterSheet, generateCharacterSheet } from '@/lib/api/image-generation';
import { CharacterSheetReference, CharacterSheetReview } from '@/lib/types/image-generation';
import { SheetReviewBadge } from '@/components/characters/SheetReviewBadge';
import {
  CharacterProfileUpdate,
  CharacterRanking,
  CoreProfileField,
  PHYSICAL_FIELDS,
  PhysicalField,
  ProfileField as ProfileFieldName,
  ProfileOverrideKey,
  ObjectTier,
  VOICE_FIELDS,
  VoiceField,
  rankCharacters,
  CharacterScriptSyncPreview,
  confirmCharacterScriptSync,
  extractScriptCharacters,
  previewCharacterScriptSync,
  updateCharacterProfile,
} from '@/lib/api/story';
import { CharacterDetailField, CharacterTypeInfo, CharacterTypeMap, effectiveCharacterType, isCharacterOnCamera, loadCharacterTypes } from '@/lib/characterTypes';
import { supabase } from '@/lib/supabaseClient';
import { CharacterSheetCreator } from './CharacterSheetCreator';
import { RankingStat, TierBadge } from './ImportanceTier';
import { ErrorBanner } from '@/components/ui/ErrorBanner';

interface CharactersProps {
  projectId: string | null;
  onSelect: (item: Record<string, unknown>) => void;
}

type EditableField = ProfileFieldName;
type ProfileForm = Record<EditableField, string>;

/** Physical facts are flattened onto the character, script value with manual override applied. */
interface StudioCharacter extends Record<PhysicalField, string | null> {
  id: string;
  name: string;
  /** A character_types key (main, supporting, narrator, spokesperson...), manual choice applied. */
  characterType: string;
  /** False for voice-only characters (narrators): heard, never drawn, no character sheet. */
  onCamera: boolean;
  /** How they sound; script value with manual override applied. */
  voice: Record<VoiceField, string | null>;
  /** The type's own details (a spokesperson's brand...), manual overrides applied. */
  typeDetails: Record<string, string>;
  role: string | null;
  age: number | null;
  gender: string | null;
  race: string | null;
  appearance: string | null;
  personality: string | null;
  tags: string[];
  metadata: Record<string, unknown> | null;
  primaryImageUrl: string | null;
  /** Every manual key: profile fields, character_type, on_camera, voice.*, type_details.* */
  manualOverrideFields: string[];
  /** The approved model sheet storyboards use. */
  sheet: CharacterSheetInfo | null;
  /** Every generated sheet version, newest first (includes the approved one). */
  sheetVersions: SheetVersion[];
  ranking: CharacterRanking | null;
}
interface CharacterSheetInfo {
  assetId: string;
  url: string;
  /** Face close-up cut from the sheet's face panel. */
  faceUrl: string | null;
  approvedAt: string | null;
  review: CharacterSheetReview | null;
}
interface SheetVersion { assetId: string; url: string; createdAt: string | null; }
/** Outcome of the last sheet generation, shown in the panel where the user clicked. */
interface SheetResult {
  characterId: string;
  status: 'success' | 'error';
  message: string;
  url?: string;
  approved?: boolean;
  review?: CharacterSheetReview | null;
  seconds: number;
}

const formatElapsed = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Success with the produced image, or the failure reason; stays until dismissed or regenerated. */
function SheetResultCard({ result, characterName, onPreview, onDismiss }: { result: SheetResult; characterName: string; onPreview: (url: string, label: string) => void; onDismiss: () => void }) {
  const success = result.status === 'success';
  return <div role={success ? 'status' : 'alert'} className={`mb-3 border p-3 ${success ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-red-500/40 bg-red-500/10'}`}>
    <div className="flex items-start gap-2">
      {success ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />}
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-semibold ${success ? 'text-emerald-200' : 'text-red-200'}`}>{success ? 'Character sheet generated' : 'Character sheet failed'} <span className="font-mono font-normal text-zinc-400">· {formatElapsed(result.seconds)}</span></p>
        <p className={`mt-0.5 text-[11px] leading-relaxed ${success ? 'text-emerald-100/80' : 'text-red-100/90'}`}>{result.message}</p>
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-zinc-500 hover:text-zinc-200"><X className="h-3.5 w-3.5" /></button>
    </div>
    {success && result.url && <>
      <button type="button" onClick={() => onPreview(result.url!, `${characterName} - New character sheet`)} aria-label={`Preview the new ${characterName} character sheet`} className="relative mt-2 block aspect-video w-full cursor-zoom-in overflow-hidden border border-emerald-500/30 bg-zinc-900">
        <Image src={result.url} alt={`New ${characterName} character sheet`} fill sizes="416px" unoptimized className="object-contain" />
      </button>
      <SheetReviewBadge review={result.review} className="mt-2" />
    </>}
  </div>;
}

const TIER_ADVICE: Record<ObjectTier, string> = {
  major: 'Major: shots send the character sheet and its face close-up, so it is worth refining the sheet until it is right.',
  medium: 'Medium: shots send the sheet and face close-up when there is room for both.',
  minor: 'Minor: shots send one image (the sheet, or the face in close-ups); a quick prompt-only sheet is enough.',
};

/** Why a character got its rank: scenes, dialogue lines, and who they share scenes with. */
function CharacterImportance({ ranking }: { ranking: CharacterRanking | null }) {
  if (!ranking) return null;
  return <section className="mt-4">
    <div className="flex items-center justify-between"><h3 className="text-xs font-semibold text-zinc-300">Importance</h3><span className="flex items-center gap-2 text-[11px] text-zinc-400">#{ranking.rank}<TierBadge ranking={ranking} /><span className="font-mono text-zinc-500">{ranking.score}/4</span></span></div>
    <dl className="mt-2 grid grid-cols-2 gap-2"><RankingStat label="Scenes" value={ranking.scene_count} score={ranking.scene_score} /><RankingStat label="Dialogue lines" value={ranking.dialogue_lines} score={ranking.dialogue_score} /></dl>
    <p className="mt-2 text-[11px] leading-5 text-zinc-400">{ranking.scene_partners.length ? <>Shares scenes with <span className="text-zinc-200">{ranking.scene_partners.join(', ')}</span>. </> : 'Never shares a scene with another character. '}{ranking.mentioned_by_others ? `Mentioned ${ranking.mentioned_by_others} time${ranking.mentioned_by_others === 1 ? '' : 's'} in others' lines.` : ''}</p>
    <p className="mt-1 text-[11px] leading-5 text-violet-300">{TIER_ADVICE[ranking.tier]}</p>
  </section>;
}

/** Read the approved model sheet recorded in character metadata by the approve endpoint. */
const sheetFromMetadata = (metadata: Record<string, unknown>): CharacterSheetInfo | null => {
  const sheet = metadata.model_sheet as Record<string, unknown> | undefined;
  if (!sheet || typeof sheet.url !== 'string' || typeof sheet.asset_id !== 'string') return null;
  return {
    assetId: sheet.asset_id,
    url: sheet.url,
    faceUrl: typeof sheet.face_url === 'string' ? sheet.face_url : null,
    approvedAt: typeof sheet.approved_at === 'string' ? sheet.approved_at : null,
    review: sheet.review && typeof sheet.review === 'object' && Array.isArray((sheet.review as CharacterSheetReview).views) ? sheet.review as CharacterSheetReview : null,
  };
};

/** Core identity; the "details aren't in the script yet" prompt counts only these. */
const CORE_FIELDS: CoreProfileField[] = ['role', 'age', 'gender', 'race', 'appearance', 'personality'];
const EDITABLE_FIELDS: EditableField[] = [...CORE_FIELDS, ...PHYSICAL_FIELDS];
const isPhysicalField = (field: EditableField): field is PhysicalField => (PHYSICAL_FIELDS as readonly string[]).includes(field);
const FIELD_LABELS: Record<EditableField, string> = {
  role: 'Role', age: 'Age', gender: 'Gender', race: 'Race', appearance: 'Other appearance', personality: 'Personality',
  height: 'Height', build: 'Build', skin_tone: 'Skin tone', face: 'Face', eyes: 'Eyes', hair: 'Hair',
  facial_hair: 'Facial hair', distinguishing_marks: 'Distinguishing marks', glasses: 'Glasses', demeanor: 'Demeanor',
};
/** Multi-line inputs; everything else is a single line. */
const MULTILINE_FIELDS: EditableField[] = ['appearance', 'personality', 'face', 'distinguishing_marks', 'demeanor'];
/** Hints in empty fields: what helps the character sheet and storyboard most. All optional. */
const PROFILE_PLACEHOLDERS: Record<EditableField, string> = {
  role: 'Optional, e.g. station engineer',
  age: 'Optional',
  gender: 'Optional',
  race: 'Optional',
  appearance: 'Anything not covered above, e.g. usual clothing',
  personality: 'Optional; barely changes the image',
  height: 'e.g. tall, about 180 cm',
  build: 'e.g. athletic, broad shoulders',
  skin_tone: 'e.g. dark brown, warm undertone',
  face: 'e.g. oval face, high cheekbones, wide nose',
  eyes: 'e.g. dark brown, heavy-lidded',
  hair: 'e.g. short black hair, tight fade',
  facial_hair: 'e.g. trimmed beard, or none',
  distinguishing_marks: 'Scars, tattoos, birthmarks, jewelry always worn',
  glasses: 'e.g. thin gold frames, or none',
  demeanor: 'How they carry themselves, e.g. guarded, slight slouch',
};
const EMPTY_FORM = Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, ''])) as ProfileForm;

const VOICE_LABELS: Record<VoiceField, string> = { tone: 'Tone', accent: 'Accent', pace: 'Pace', pitch: 'Pitch / vocal age', delivery: 'Delivery notes' };
const VOICE_PLACEHOLDERS: Record<VoiceField, string> = {
  tone: 'e.g. warm, upbeat, authoritative',
  accent: 'e.g. Kenyan English, neutral American',
  pace: 'e.g. brisk, slow and deliberate',
  pitch: 'e.g. deep baritone, young and bright',
  delivery: 'e.g. smiles through the lines, whispers the tagline',
};
/** Profile gaps worth flagging: voice-only characters need no look, only who they are. */
const VOICE_ONLY_CORE_FIELDS: CoreProfileField[] = ['role', 'age', 'gender', 'personality'];

/** Type, presence, voice and type details while editing. */
interface RoleDraft { characterType: string; onCamera: boolean; voice: Record<VoiceField, string>; details: Record<string, string>; }
const roleDraftFrom = (character: StudioCharacter): RoleDraft => ({
  characterType: character.characterType,
  onCamera: character.onCamera,
  voice: Object.fromEntries(VOICE_FIELDS.map((field) => [field, character.voice[field] ?? ''])) as Record<VoiceField, string>,
  details: { ...character.typeDetails },
});
const EMPTY_ROLE_DRAFT: RoleDraft = { characterType: 'supporting', onCamera: true, voice: Object.fromEntries(VOICE_FIELDS.map((field) => [field, ''])) as Record<VoiceField, string>, details: {} };
const typeLabel = (types: CharacterTypeMap, key: string) => types.get(key)?.label ?? key.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
const displayValue = (value: string | number | null) => value === null || value === '' ? 'Not specified' : String(value);

/** Split a comma or newline separated tag draft into unique, trimmed tags. */
const parseTagList = (value: string): string[] => {
  const tags: string[] = [];
  for (const raw of value.split(/[,\n]/)) {
    const tag = raw.trim();
    if (tag && !tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) tags.push(tag);
  }
  return tags;
};

/** True when the tag draft differs from the persisted tags (order-insensitive per index). */
const tagsDiffer = (current: string[], draft: string): boolean => {
  const next = parseTagList(draft);
  return next.length !== current.length
    || next.some((tag, index) => tag.toLowerCase() !== (current[index] ?? '').toLowerCase());
};

/** Tag aliases rendered in the character's accent color. */
function TagBadges({ character }: { character: StudioCharacter }) {
  const theme = characterTheme(character);
  const tags = characterTags(character);
  if (tags.length === 0) return null;
  return <div className="mt-1 flex flex-wrap items-center gap-1">{tags.map((tag) => (
    <span key={tag} className="border px-1 py-px text-[9px] font-semibold uppercase tracking-wide" style={{ borderColor: theme.border, backgroundColor: theme.soft, color: theme.accent }}>{tag}</span>
  ))}</div>;
}

function formFromCharacter(character: StudioCharacter): ProfileForm {
  return Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, String(character[field] ?? '')])) as ProfileForm;
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
  // Ten physical slots would mostly read "Not specified"; show only the known ones until editing.
  if (!isEditingProfile && isPhysicalField(field) && !value) return null;
  if (isEditingProfile) {
    const inputClass = "w-full border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-400";
    return <label className={multiline ? 'col-span-2 block' : 'block'}><span className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-zinc-600">{label}</span>{multiline ? <textarea value={profileForm[field]} placeholder={PROFILE_PLACEHOLDERS[field]} onChange={(event) => onChange(field, event.target.value)} className={`${inputClass} min-h-18 resize-y`} /> : <input placeholder={PROFILE_PLACEHOLDERS[field]} type={field === 'age' ? 'number' : 'text'} min={field === 'age' ? 0 : undefined} step={field === 'age' ? 1 : undefined} value={profileForm[field]} onChange={(event) => onChange(field, event.target.value)} className={`${inputClass} ${field === 'age' ? 'appearance-textfield [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none' : ''}`} />}</label>;
  }
  return <div className={multiline ? 'col-span-2' : ''}><dt className="flex items-center gap-1 text-zinc-600">{label}<span className={`border px-1 text-[9px] font-semibold uppercase ${manual ? 'border-violet-400/30 text-violet-300' : 'border-zinc-700 text-zinc-500'}`}>{manual ? 'Manual' : 'From script'}</span></dt><dd className="mt-1 text-zinc-300">{displayValue(value as string | number | null)}</dd>{manual && <button type="button" onClick={() => onReset(field)} disabled={isSavingProfile} className="mt-1 inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-200"><RotateCcw className="h-3 w-3" />Reset to script</button>}</div>;
}

interface TextFactProps {
  label: string;
  value: string | null;
  manual: boolean;
  isEditing: boolean;
  draft: string;
  placeholder: string;
  multiline?: boolean;
  /** Hide the read-only row when there is no value yet. */
  hideWhenEmpty?: boolean;
  busy: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
}

/** A voice or type-detail field: read-only with its source, or an input while editing. */
function TextFact({ label, value, manual, isEditing, draft, placeholder, multiline = false, hideWhenEmpty = true, busy, onChange, onReset }: TextFactProps) {
  if (!isEditing && hideWhenEmpty && !value) return null;
  if (isEditing) {
    const inputClass = "w-full border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-400";
    return <label className={multiline ? 'col-span-2 block' : 'block'}><span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-600">{label}</span>{multiline
      ? <textarea value={draft} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className={`${inputClass} min-h-16 resize-y`} />
      : <input value={draft} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className={inputClass} />}</label>;
  }
  return <div className={multiline ? 'col-span-2' : ''}><dt className="flex items-center gap-1 text-zinc-600">{label}{value && <span className={`border px-1 text-[9px] font-semibold uppercase ${manual ? 'border-violet-400/30 text-violet-300' : 'border-zinc-700 text-zinc-500'}`}>{manual ? 'Manual' : 'From script'}</span>}</dt><dd className="mt-1 text-zinc-300">{displayValue(value)}</dd>{manual && <button type="button" onClick={onReset} disabled={busy} className="mt-1 inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-200"><RotateCcw className="h-3 w-3" />Reset to script</button>}</div>;
}

const SectionHeading = ({ title, hint }: { title: string; hint?: string }) => <p className="col-span-2 -mb-1 mt-1 border-t border-zinc-800 pt-3 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{title}{hint && <span className="font-normal normal-case tracking-normal text-zinc-600"> · {hint}</span>}</p>;

/** "Narrator · Voice only" or "Spokesperson · Speaks to camera". */
function PresenceBadge({ character, type }: { character: StudioCharacter; type: CharacterTypeInfo | undefined }) {
  return <span className="inline-flex flex-wrap items-center gap-1">
    <span className="border border-zinc-700 px-1.5 py-px text-[10px] font-semibold text-zinc-300">{type?.label ?? character.characterType}</span>
    {character.onCamera
      ? type?.addressesCamera && <span className="inline-flex items-center gap-1 border border-sky-400/30 px-1.5 py-px text-[10px] font-semibold text-sky-300"><Video className="h-3 w-3" />Speaks to camera</span>
      : <span className="inline-flex items-center gap-1 border border-amber-400/30 px-1.5 py-px text-[10px] font-semibold text-amber-300"><Mic className="h-3 w-3" />Voice only</span>}
  </span>;
}

interface RoleEditorProps {
  draft: RoleDraft;
  types: CharacterTypeMap;
  offered: string[];
  manual: string[];
  onChange: (draft: RoleDraft) => void;
}

/** Character type and whether the character is seen, while editing the profile. */
function RoleEditor({ draft, types, offered, manual, onChange }: RoleEditorProps) {
  const options = offered.includes(draft.characterType) ? offered : [draft.characterType, ...offered];
  const type = types.get(draft.characterType);
  const typeDefault = type?.presence !== 'voice_only';
  return <div className="mb-3 space-y-2 border border-zinc-800 bg-zinc-900/40 p-3">
    <label className="block"><span className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-zinc-600">Character type{manual.includes('character_type') && <span className="normal-case tracking-normal text-violet-300">Manual</span>}</span>
      <select value={draft.characterType} onChange={(event) => {
        const next = types.get(event.target.value);
        // A new type brings its own presence; the checkbox can still override it.
        onChange({ ...draft, characterType: event.target.value, onCamera: next?.presence !== 'voice_only' });
      }} className="w-full border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-400">
        {options.map((key) => <option key={key} value={key}>{typeLabel(types, key)}{types.get(key)?.presence === 'voice_only' ? ' (voice only)' : ''}</option>)}
      </select></label>
    {type?.description && <p className="text-[11px] leading-relaxed text-zinc-500">{type.description}</p>}
    <label className="flex items-start gap-2 text-xs text-zinc-300">
      <input type="checkbox" checked={draft.onCamera} onChange={(event) => onChange({ ...draft, onCamera: event.target.checked })} className="mt-0.5 accent-violet-500" />
      <span>Appears on screen<span className="block text-[11px] leading-relaxed text-zinc-500">{draft.onCamera
        ? 'Gets a character sheet and is drawn in storyboard frames.'
        : 'Heard only: no character sheet, and storyboards never draw them.'}{draft.onCamera !== typeDefault ? ` Overrides the ${typeLabel(types, draft.characterType)} default.` : ''}</span></span>
    </label>
  </div>;
}

/** Shown on the sheet tab for narrators and other voice-only characters. */
function VoiceOnlySheetNotice({ character, type }: { character: StudioCharacter; type: CharacterTypeInfo | undefined }) {
  return <div className="flex flex-col items-center border border-dashed border-amber-400/25 px-4 py-6 text-center">
    <Mic className="mb-2 h-5 w-5 text-amber-300" />
    <p className="text-xs font-semibold text-zinc-200">{character.name} is voice only</p>
    <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{type?.label ?? 'This character'} is heard, never seen, so there is no character sheet and storyboards never draw them. Describe how they sound in the profile instead.</p>
    <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">On screen after all? Edit the profile and tick <span className="text-zinc-300">Appears on screen</span>, or change the type.</p>
  </div>;
}

interface CharacterSheetPanelProps {
  character: StudioCharacter;
  busy: boolean;
  approvingId: string | null;
  onApprove: (assetId: string) => void;
  onPreview: (url: string, label: string) => void;
  onDownload: () => void;
}

/** The approved model sheet, its face crop, and earlier versions to switch between. */
function CharacterSheetPanel({ character, busy, approvingId, onApprove, onPreview, onDownload }: CharacterSheetPanelProps) {
  const { sheet, sheetVersions } = character;
  if (!sheet && sheetVersions.length === 0) {
    return <div className="mb-3 flex flex-col items-center border border-dashed border-zinc-800 px-4 py-6 text-center">
      <LayoutPanelLeft className="mb-2 h-5 w-5 text-zinc-600" />
      <p className="text-xs font-semibold text-zinc-300">No character sheet yet</p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">One image with a face close-up and a full-body turnaround. Storyboards use it as {character.name}&apos;s reference in every shot.</p>
      {character.primaryImageUrl && <p className="mt-2 text-[11px] leading-relaxed text-amber-300/80">Storyboards still use the older separate views until a sheet is generated.</p>}
    </div>;
  }
  return <div className="mb-3">
    {sheet && <>
      <button type="button" onClick={() => onPreview(sheet.url, `${character.name} - Character sheet`)} aria-label={`Preview ${character.name} character sheet`} className="relative block aspect-video w-full cursor-zoom-in overflow-hidden border border-zinc-800 bg-zinc-900 hover:border-zinc-600">
        <Image src={sheet.url} alt={`${character.name} character sheet`} fill sizes="416px" unoptimized className="object-contain" />
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 bg-zinc-950/85 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300"><CheckCircle2 className="h-3 w-3" />Used in storyboards</span>
      </button>
      <SheetReviewBadge review={sheet.review} className="mt-2" />
      <div className="mt-2 flex items-stretch gap-2">
        {sheet.faceUrl && <button type="button" onClick={() => onPreview(sheet.faceUrl!, `${character.name} - Face close-up`)} title="Face close-up cut from the sheet; close-up shots send it with the sheet" className="relative aspect-3/4 w-14 shrink-0 cursor-zoom-in overflow-hidden border border-zinc-800 bg-zinc-900 hover:border-zinc-600"><Image src={sheet.faceUrl} alt={`${character.name} face close-up`} fill sizes="56px" unoptimized className="object-cover" /></button>}
        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <p className="text-[11px] leading-relaxed text-zinc-500">Shots send this sheet{sheet.faceUrl ? ' and the face close-up cut from it' : ''}.{sheet.approvedAt ? ` Approved ${new Date(sheet.approvedAt).toLocaleDateString()}.` : ''}</p>
          <button type="button" onClick={onDownload} className="inline-flex h-7 items-center justify-center gap-1.5 self-start border border-zinc-700 px-2 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-900"><Download className="h-3.5 w-3.5" />Download</button>
        </div>
      </div>
    </>}
    {(sheetVersions.length > 1 || (!sheet && sheetVersions.length > 0)) && <div className="mt-3">
      <p className="mb-1.5 text-[10px] uppercase tracking-wide text-zinc-600">Versions</p>
      <div className="grid grid-cols-3 gap-1.5">{sheetVersions.map((version, index) => {
        const active = version.assetId === sheet?.assetId;
        const label = `${character.name} sheet version ${sheetVersions.length - index}`;
        return <div key={version.assetId} className={`border ${active ? 'border-emerald-400/50' : 'border-zinc-800'}`}>
          <button type="button" onClick={() => onPreview(version.url, label)} className="relative block aspect-video w-full cursor-zoom-in overflow-hidden bg-zinc-900"><Image src={version.url} alt={label} fill sizes="128px" unoptimized className="object-cover" /></button>
          {active ? <span className="flex h-6 items-center justify-center text-[10px] font-semibold text-emerald-300">In use</span>
            : <button type="button" onClick={() => onApprove(version.assetId)} disabled={busy} className="flex h-6 w-full items-center justify-center text-[10px] font-semibold text-violet-200 hover:bg-violet-500/15 disabled:opacity-50">{approvingId === version.assetId ? 'Switching...' : 'Use this'}</button>}
        </div>;
      })}</div>
    </div>}
  </div>;
}

type PanelTab = 'profile' | 'sheet';

const TIER_GROUPS: { key: ObjectTier | 'unranked'; label: string; hint: string }[] = [
  { key: 'major', label: 'Major', hint: 'Carry the story' },
  { key: 'medium', label: 'Medium', hint: 'Recurring presence' },
  { key: 'minor', label: 'Minor', hint: 'Brief appearances' },
  { key: 'unranked', label: 'Unranked', hint: 'Not found in the current script' },
];

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || '?';
const portraitUrl = (character: StudioCharacter) => character.sheet?.faceUrl ?? character.primaryImageUrl;
const missingFields = (character: StudioCharacter) => (character.onCamera ? CORE_FIELDS : VOICE_ONLY_CORE_FIELDS)
  .filter((field) => character[field] === null || character[field] === '');
/** Profile lines for the preview modal, skipping anything not known yet. */
const characterFacts = (character: StudioCharacter, type: CharacterTypeInfo | undefined): CharacterFact[] => (
  [
    ['Type', `${type?.label ?? character.characterType}${character.onCamera ? '' : ' (voice only)'}`],
    ['Role', character.role], ['Age', character.age === null ? null : String(character.age)], ['Gender', character.gender],
    ...(character.onCamera ? [
      ['Race', character.race] as const,
      ...PHYSICAL_FIELDS.map((field) => [FIELD_LABELS[field], character[field]] as const),
      ['Appearance', character.appearance] as const,
    ] : []),
    ['Personality', character.personality],
    ...(type?.detailFields ?? []).map((field) => [field.label, character.typeDetails[field.key] ?? null] as const),
    ...VOICE_FIELDS.map((field) => [`Voice: ${VOICE_LABELS[field].toLowerCase()}`, character.voice[field]] as const),
  ] as const
).flatMap(([label, value]) => value ? [{ label, value: String(value) }] : []);
const quickFacts = (character: StudioCharacter) => [character.age === null ? null : `${character.age} yrs`, character.gender, character.race].filter(Boolean).join(' · ');

/** Generated portrait, or the character's initials on an accent glow when nothing is generated yet. */
function Portrait({ character, className, initialsClassName, sizes }: { character: StudioCharacter; className: string; initialsClassName: string; sizes: string }) {
  const { accent } = characterTheme(character);
  const url = portraitUrl(character);
  return <div className={`relative overflow-hidden bg-zinc-900 ${className}`} style={url ? undefined : { background: `radial-gradient(circle at 50% 38%, ${accent}33, transparent 70%), #18181b` }}>
    {url ? <Image src={url} alt="" fill sizes={sizes} unoptimized className="object-cover object-top" />
      : <span className={`absolute inset-0 flex items-center justify-center font-bold tracking-wide ${initialsClassName}`} style={{ color: accent }}>{initials(character.name)}</span>}
  </div>;
}

interface CastItemProps { character: StudioCharacter; selected: boolean; onSelect: () => void; }

/** Portrait card for major and medium characters. */
function CastCard({ character, selected, onSelect }: CastItemProps) {
  const { accent } = characterTheme(character);
  const facts = quickFacts(character);
  const missing = missingFields(character).length;
  return <button type="button" onClick={onSelect} aria-pressed={selected} className={`group flex flex-col overflow-hidden border bg-zinc-900/40 text-left transition hover:-translate-y-0.5 hover:bg-zinc-900 ${selected ? '' : 'border-zinc-800 hover:border-zinc-600'}`} style={selected ? { borderColor: accent, boxShadow: `0 0 0 1px ${accent}` } : undefined}>
    <div className="relative">
      <Portrait character={character} className="aspect-4/5 w-full" initialsClassName="text-4xl" sizes="240px" />
      <span className="absolute left-2 top-2 bg-zinc-950/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">#{character.ranking?.rank ?? '–'}</span>
      <span className={`absolute right-2 top-2 bg-zinc-950/80 px-1.5 py-0.5 text-[10px] font-semibold ${character.sheet ? 'text-emerald-300' : 'text-zinc-500'}`} title={character.sheet ? 'Character sheet approved' : 'No character sheet yet'}>{character.sheet ? 'Sheet' : 'No sheet'}</span>
      <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: character.sheet ? accent : '#27272a' }} />
    </div>
    <div className="flex flex-1 flex-col p-3">
      <span className="truncate text-sm font-semibold" style={{ color: accent }}>{character.name}</span>
      <span className={`mt-0.5 truncate text-xs ${character.role ? 'text-zinc-400' : 'italic text-zinc-600'}`}>{character.role ?? 'No role yet'}</span>
      {facts && <span className="mt-1 truncate text-[11px] text-zinc-500">{facts}</span>}
      <div className="mt-auto flex items-center gap-3 pt-3 text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1" title="Scenes"><Clapperboard className="h-3 w-3" />{character.ranking?.scene_count ?? 0}</span>
        <span className="inline-flex items-center gap-1" title="Dialogue lines"><MessageSquare className="h-3 w-3" />{character.ranking?.dialogue_lines ?? 0}</span>
        {missing > 0 && <span className="ml-auto text-amber-400/80" title="Profile details not in the script">{missing} to fill</span>}
      </div>
    </div>
  </button>;
}

/** Compact row for minor and voice-only characters, so brief roles don't take as much room as major ones. */
function CastRow({ character, selected, onSelect, typeName }: CastItemProps & { typeName?: string }) {
  const { accent } = characterTheme(character);
  const subtitle = character.onCamera ? character.role : [typeName, character.role].filter(Boolean).join(' · ') || null;
  return <button type="button" onClick={onSelect} aria-pressed={selected} className={`flex items-center gap-3 border bg-zinc-900/40 p-2 text-left transition hover:bg-zinc-900 ${selected ? '' : 'border-zinc-800 hover:border-zinc-600'}`} style={selected ? { borderColor: accent, boxShadow: `0 0 0 1px ${accent}` } : undefined}>
    {character.onCamera
      ? <Portrait character={character} className="h-12 w-10 shrink-0" initialsClassName="text-sm" sizes="40px" />
      : <span className="flex h-12 w-10 shrink-0 items-center justify-center bg-zinc-900" style={{ color: accent }} title="Voice only"><Mic className="h-4 w-4" /></span>}
    <div className="min-w-0 flex-1">
      <span className="block truncate text-sm font-semibold" style={{ color: accent }}>{character.name}</span>
      <span className={`block truncate text-[11px] ${subtitle ? 'text-zinc-500' : 'italic text-zinc-600'}`}>{subtitle ?? 'No role yet'}</span>
    </div>
    <div className="flex shrink-0 items-center gap-2.5 font-mono text-[11px] text-zinc-500">
      <span className="inline-flex items-center gap-1" title="Scenes"><Clapperboard className="h-3 w-3" />{character.ranking?.scene_count ?? 0}</span>
      <span className="inline-flex items-center gap-1" title="Dialogue lines"><MessageSquare className="h-3 w-3" />{character.ranking?.dialogue_lines ?? 0}</span>
    </div>
  </button>;
}

export function Characters({ projectId, onSelect }: CharactersProps) {
  const [characters, setCharacters] = useState<StudioCharacter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isProfileVisible, setIsProfileVisible] = useState(true);
  const [panelTab, setPanelTab] = useState<PanelTab>('profile');
  const [isLoading, setIsLoading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSyncingScript, setIsSyncingScript] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  /** The character preview modal; ``initialUrl`` is the sheet version (or face) to open on. */
  const [sheetModal, setSheetModal] = useState<{ initialUrl: string | null } | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [sheetResult, setSheetResult] = useState<SheetResult | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [generatingModel, setGeneratingModel] = useState<string | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileForm>(EMPTY_FORM);
  const [roleDraft, setRoleDraft] = useState<RoleDraft>(EMPTY_ROLE_DRAFT);
  const [characterTypes, setCharacterTypes] = useState<CharacterTypeMap>(() => new Map());
  /** Character types the project's type offers, in display order. */
  const [offeredTypes, setOfferedTypes] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [scriptPreview, setScriptPreview] = useState<CharacterScriptSyncPreview | null>(null);
  const [error, setError] = useState<string | Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadCharacters = useCallback(async () => {
    if (!projectId) { setCharacters([]); return; }
    setIsLoading(true);
    setError(null);
    try {
      const { data: rows, error: charactersError } = await supabase.from('characters')
        .select('id, name, character_type, on_camera, role, age, gender, race, appearance, personality, physical, voice, type_details, tags, primary_asset_id, metadata')
        .eq('project_id', projectId).eq('metadata->>source', 'script').order('name');
      if (charactersError) throw charactersError;
      // Without the type list every character is treated as on camera, as before types had a presence.
      const typeConfig = await loadCharacterTypes(projectId).catch(() => ({ types: new Map() as CharacterTypeMap, offered: [] as string[] }));
      setCharacterTypes(typeConfig.types); setOfferedTypes(typeConfig.offered);
      const characterRows = rows ?? [];
      const primaryIds = characterRows.map((row) => row.primary_asset_id as string | null).filter(Boolean) as string[];
      const { data: primaryAssets, error: primaryError } = primaryIds.length
        ? await supabase.from('assets').select('id, url').in('id', primaryIds) : { data: [], error: null };
      if (primaryError) throw primaryError;
      const primaryUrls = new Map((primaryAssets ?? []).map((asset) => [asset.id as string, asset.url as string]));
      const ids = characterRows.map((row) => row.id as string);
      const { data: links, error: linksError } = ids.length ? await supabase.from('asset_links')
        .select('target_id, asset_id, created_at').eq('project_id', projectId).eq('target_type', 'character').eq('role', 'model_sheet_candidate')
        .in('target_id', ids).order('created_at', { ascending: false }) : { data: [], error: null };
      if (linksError) throw linksError;
      const assetIds = (links ?? []).map((link) => link.asset_id as string);
      const { data: assets, error: assetsError } = assetIds.length ? await supabase.from('assets').select('id, url').in('id', assetIds) : { data: [], error: null };
      if (assetsError) throw assetsError;
      const urls = new Map((assets ?? []).map((asset) => [asset.id as string, asset.url as string]));
      // Ranking is a bonus: if it fails, characters still load in name order.
      const rankings = await rankCharacters(projectId).catch(() => [] as CharacterRanking[]);
      const rankingById = new Map(rankings.map((ranking) => [ranking.character_id, ranking]));
      const loaded = characterRows.map((row): StudioCharacter => {
        const metadata = (row.metadata ?? {}) as Record<string, unknown>;
        const overrides = (metadata.manual_overrides ?? {}) as Record<string, unknown>;
        const effective = <T,>(field: EditableField, scriptValue: T): T => overrides[field] === undefined ? scriptValue : overrides[field] as T;
        const manualOverrideFields = Object.keys(overrides).filter((field) => overrides[field] !== undefined && overrides[field] !== null);
        const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
        const scriptVoice = (row.voice ?? {}) as Record<string, unknown>;
        const voice = Object.fromEntries(VOICE_FIELDS.map((field) => [field, text(overrides[`voice.${field}`]) ?? text(scriptVoice[field])])) as Record<VoiceField, string | null>;
        const typeDetails: Record<string, string> = {};
        for (const [key, value] of Object.entries((row.type_details ?? {}) as Record<string, unknown>)) { const known = text(value); if (known) typeDetails[key] = known; }
        for (const [key, value] of Object.entries(overrides)) { const known = text(value); if (key.startsWith('type_details.') && known) typeDetails[key.slice('type_details.'.length)] = known; }
        const presenceRow = { character_type: row.character_type as string | null, on_camera: row.on_camera as boolean | null, metadata };
        const scriptPhysical = (row.physical ?? {}) as Partial<Record<PhysicalField, unknown>>;
        const physical = Object.fromEntries(PHYSICAL_FIELDS.map((field) => {
          const raw = scriptPhysical[field];
          return [field, effective(field, typeof raw === 'string' && raw.trim() ? raw.trim() : null)];
        })) as Record<PhysicalField, string | null>;
        const sheetVersions = (links ?? []).filter((link) => link.target_id === row.id).flatMap((link): SheetVersion[] => {
          const url = urls.get(link.asset_id as string);
          return url ? [{ assetId: link.asset_id as string, url, createdAt: (link.created_at as string | null) ?? null }] : [];
        });
        return {
          id: row.id as string, name: row.name as string, characterType: effectiveCharacterType(presenceRow),
          onCamera: isCharacterOnCamera(presenceRow, typeConfig.types), voice, typeDetails,
          role: effective('role', row.role as string | null), age: effective('age', row.age as number | null), gender: effective('gender', row.gender as string | null),
          race: effective('race', row.race as string | null), appearance: effective('appearance', row.appearance as string | null), personality: effective('personality', row.personality as string | null),
          ...physical,
          tags: (row.tags as string[] | null) ?? [], metadata, primaryImageUrl: primaryUrls.get(row.primary_asset_id as string) ?? null, manualOverrideFields,
          sheet: sheetFromMetadata(metadata), sheetVersions,
          ranking: rankingById.get(row.id as string) ?? null,
        };
      }).sort((a, b) => (a.ranking?.rank ?? Number.MAX_SAFE_INTEGER) - (b.ranking?.rank ?? Number.MAX_SAFE_INTEGER));
      setCharacters(loaded);
      // Keep the current pick; otherwise open the top-ranked character so the panel is never blank.
      setSelectedId((current) => loaded.some((character) => character.id === current) ? current : loaded[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError : 'Failed to load script characters.');
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

  useEffect(() => {
    if (!isGenerating) return;
    const started = Date.now();
    const interval = window.setInterval(() => setElapsedSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(interval);
  }, [isGenerating]);

  const selected = characters.find((character) => character.id === selectedId) ?? null;
  const selectCharacter = (character: StudioCharacter) => {
    setSelectedId(character.id);
    setIsProfileVisible(true); setIsEditingProfile(false); setScriptPreview(null); setProfileForm(formFromCharacter(character)); setRoleDraft(roleDraftFrom(character)); setTagDraft(character.tags.join(', ')); onSelect(character as unknown as Record<string, unknown>);
  };
  const beginProfileEdit = () => { if (selected) { setPanelTab('profile'); setProfileForm(formFromCharacter(selected)); setRoleDraft(roleDraftFrom(selected)); setTagDraft(selected.tags.join(', ')); setIsEditingProfile(true); setNotice(null); } };
  const updateForm = (field: EditableField, value: string) => setProfileForm((current) => ({ ...current, [field]: value }));

  const saveProfile = async () => {
    if (!projectId || !selected) return;
    const update: CharacterProfileUpdate = {};
    const clearFields: ProfileOverrideKey[] = [];
    for (const field of EDITABLE_FIELDS) {
      const current = field === 'age' ? (selected.age === null ? '' : String(selected.age)) : String(selected[field] ?? '');
      const next = profileForm[field].trim();
      if (next === current) continue;
      if (!next) {
        // Every field is optional. Emptying your own value removes it (the script value, if any,
        // returns); a value that comes from the script can be replaced but not blanked here.
        if (selected.manualOverrideFields.includes(field)) { clearFields.push(field); continue; }
        setError(`${FIELD_LABELS[field]} comes from the script. Replace it with another value, or leave it as it is.`);
        return;
      }
      if (field === 'age') {
        const age = Number(next);
        if (!Number.isInteger(age) || age < 0) { setError('Age must be a non-negative whole number.'); return; }
        update.age = age;
      } else update[field] = next;
    }
    // Type and presence: the backend stores no override when a choice matches the script or the type.
    const typeChanged = roleDraft.characterType !== selected.characterType;
    if (typeChanged) update.character_type = roleDraft.characterType;
    if (typeChanged || roleDraft.onCamera !== selected.onCamera) update.on_camera = roleDraft.onCamera;
    // Voice and type details follow the same rule as the fields above.
    const textChanges = (
      entries: { key: string; label: string; current: string | null; next: string }[],
      prefix: 'voice.' | 'type_details.',
    ): Record<string, string> | null => {
      const changed: Record<string, string> = {};
      for (const { key, label, current, next } of entries) {
        const value = next.trim();
        if (value === (current ?? '')) continue;
        if (!value) {
          if (selected.manualOverrideFields.includes(`${prefix}${key}`)) { clearFields.push(`${prefix}${key}` as ProfileOverrideKey); continue; }
          setError(`${label} comes from the script. Replace it with another value, or leave it as it is.`);
          return null;
        }
        changed[key] = value;
      }
      return changed;
    };
    const voiceChanges = textChanges(VOICE_FIELDS.map((field) => ({ key: field, label: VOICE_LABELS[field], current: selected.voice[field], next: roleDraft.voice[field] })), 'voice.');
    if (!voiceChanges) return;
    if (Object.keys(voiceChanges).length) update.voice = voiceChanges;
    const detailChanges = textChanges((characterTypes.get(roleDraft.characterType)?.detailFields ?? []).map((field) => ({
      key: field.key, label: field.label, current: selected.typeDetails[field.key] ?? null, next: roleDraft.details[field.key] ?? '',
    })), 'type_details.');
    if (!detailChanges) return;
    if (Object.keys(detailChanges).length) update.type_details = detailChanges;
    if (clearFields.length) update.clear_fields = clearFields;
    if (Object.keys(update).length === 0) {
      if (!tagsDiffer(selected.tags, tagDraft)) { setIsEditingProfile(false); return; }
      setIsSavingProfile(true); setError(null);
      try {
        const { error: tagsError } = await supabase.from('characters').update({ tags: parseTagList(tagDraft) })
          .eq('id', selected.id).eq('project_id', projectId);
        if (tagsError) throw tagsError;
        await loadCharacters();
        setIsEditingProfile(false); setNotice('Character tags saved.');
      } catch (tagsSaveError) { setError(tagsSaveError instanceof Error ? tagsSaveError : 'Failed to save character tags.'); }
      finally { setIsSavingProfile(false); }
      return;
    }
    setIsSavingProfile(true); setError(null);
    try {
      await updateCharacterProfile(projectId, selected.id, update);
      if (tagsDiffer(selected.tags, tagDraft)) {
        const { error: tagsError } = await supabase.from('characters').update({ tags: parseTagList(tagDraft) })
          .eq('id', selected.id).eq('project_id', projectId);
        if (tagsError) throw tagsError;
      }
      await loadCharacters();
      setIsEditingProfile(false); setNotice('Character profile saved.');
    } catch (saveError) { setError(saveError instanceof Error ? saveError : 'Failed to save character profile.'); }
    finally { setIsSavingProfile(false); }
  };

  const resetField = async (field: ProfileOverrideKey, label: string) => {
    if (!projectId || !selected) return;
    setIsSavingProfile(true); setError(null);
    try {
      await updateCharacterProfile(projectId, selected.id, { clear_fields: [field] });
      await loadCharacters(); setNotice(`${label} restored to its script value.`);
    } catch (resetError) { setError(resetError instanceof Error ? resetError : 'Failed to reset profile field.'); }
    finally { setIsSavingProfile(false); }
  };

  const generateSheet = async (prompt: string, references: CharacterSheetReference[], model: string): Promise<boolean> => {
    if (!projectId || !selected) return false;
    const { id: characterId, name } = selected;
    const started = Date.now();
    const seconds = () => Math.round((Date.now() - started) / 1000);
    setIsGenerating(true); setElapsedSeconds(0); setGeneratingModel(model); setSheetResult(null); setError(null); setNotice(null);
    try {
      const result = await generateCharacterSheet({ project_id: projectId, character_id: characterId, prompt, references, model });
      setGenerationProgress(100);
      setSheetResult({
        characterId, status: 'success', url: result.sheet_url, approved: result.approved, review: result.review, seconds: seconds(),
        message: result.approved ? `Storyboards now use this sheet for ${name}.` : `Saved as a new version. Choose "Use this" under Versions to make storyboards use it.`,
      });
      await loadCharacters();
      return true;
    } catch (generationError) {
      const reason = generationError instanceof Error ? generationError.message : 'Failed to generate the character sheet.';
      setSheetResult({ characterId, status: 'error', message: `${reason} Nothing was saved; adjust the inputs below and try again.`, seconds: seconds() });
      return false;
    } finally { setIsGenerating(false); setGeneratingModel(null); }
  };

  const approveSheet = async (assetId: string) => {
    if (!projectId || !selected) return;
    setApprovingId(assetId); setError(null); setNotice(null);
    try {
      await approveCharacterSheet(projectId, selected.id, assetId);
      await loadCharacters(); setNotice(`Storyboards now use this sheet for ${selected.name}.`);
    } catch (approveError) { setError(approveError instanceof Error ? approveError : 'Failed to switch the character sheet.'); }
    finally { setApprovingId(null); }
  };

  const openPreview = (url: string | null = null) => setSheetModal({ initialUrl: url });

  const downloadSheet = async (character: StudioCharacter) => {
    if (!character.sheet) return;
    await downloadImage(character.sheet.url, `${character.name.trim().replace(/[^\w-]+/g, '_') || 'character'}_sheet.jpg`);
  };

  const extractCharacters = async () => {
    if (!projectId) return;
    setIsExtracting(true); setError(null);
    try { await extractScriptCharacters(projectId); await loadCharacters(); }
    catch (extractionError) { setError(extractionError instanceof Error ? extractionError : 'Failed to extract characters from the current script.'); }
    finally { setIsExtracting(false); }
  };

  const openScriptPreview = async () => {
    if (!projectId || !selected) return;
    setIsSyncingScript(true); setError(null);
    try { setScriptPreview(await previewCharacterScriptSync(projectId, selected.id)); }
    catch (previewError) { setError(previewError instanceof Error ? previewError : 'Failed to preview script update.'); }
    finally { setIsSyncingScript(false); }
  };

  const confirmScriptUpdate = async () => {
    if (!projectId || !scriptPreview) return;
    setIsSyncingScript(true); setError(null);
    try {
      const result = await confirmCharacterScriptSync(projectId, scriptPreview);
      setScriptPreview(null); setNotice(`Script ${result.action === 'insert' ? 'updated' : 'description refreshed'} in ${result.scene_slugline ?? 'the first appearance scene'}.`);
    } catch (syncError) { setError(syncError instanceof Error ? syncError : 'Failed to update script.'); }
    finally { setIsSyncingScript(false); }
  };

  if (!projectId) return <div className="flex h-full items-center justify-center text-sm text-zinc-500">Loading project...</div>;

  return <div className="h-full overflow-auto px-6 py-7 lg:px-8"><div className="mx-auto max-w-7xl">
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-5"><div><div className="flex items-center gap-2.5"><Users className="h-5 w-5 text-violet-400" /><h1 className="text-xl font-bold text-zinc-100">Script Characters</h1></div><p className="mt-1 text-sm text-zinc-500">Script facts remain traceable while manual character decisions stay explicit.</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => setIsProfileVisible((visible) => !visible)} disabled={!selected} title={isProfileVisible ? 'Conceal character profile' : 'Preview character profile'} className="inline-flex h-9 w-9 items-center justify-center border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">{isProfileVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button><button type="button" onClick={() => void loadCharacters()} disabled={isLoading} className="inline-flex h-9 items-center gap-2 border border-zinc-700 bg-zinc-900 px-3 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />Refresh</button></div></header>
    <ErrorBanner error={error} onDismiss={() => setError(null)} className="mb-5" />
    {notice && <div className="mb-5 border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</div>}
    {isLoading ? <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-zinc-500"><RefreshCw className="h-5 w-5 animate-spin" />Loading script characters...</div> : characters.length === 0 ? <div className="flex min-h-72 flex-col items-center justify-center border border-dashed border-zinc-800 px-6 text-center"><FileText className="mb-3 h-7 w-7 text-zinc-600" /><h2 className="text-sm font-semibold text-zinc-300">No extracted characters yet</h2><p className="mt-1 max-w-sm text-sm text-zinc-500">Extract named characters and supported metadata from the script already saved in this project.</p><button type="button" onClick={() => void extractCharacters()} disabled={isExtracting} className="mt-4 inline-flex h-9 items-center justify-center gap-2 bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50">{isExtracting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}{isExtracting ? 'Extracting characters...' : 'Extract from current script'}</button></div> : <div className={`grid gap-6 ${isProfileVisible ? 'xl:grid-cols-[minmax(0,1fr)_26rem]' : ''}`}>
      <div className="space-y-7">
        {TIER_GROUPS.map((group) => {
          const members = characters.filter((character) => character.onCamera && (character.ranking?.tier ?? 'unranked') === group.key);
          if (members.length === 0) return null;
          const compact = group.key === 'minor' || group.key === 'unranked';
          return <section key={group.key}>
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">{group.label}</h2>
              <span className="font-mono text-xs text-zinc-500">{members.length}</span>
              <span className="text-xs text-zinc-600">· {group.hint}</span>
            </div>
            {compact
              ? <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">{members.map((character) => <CastRow key={character.id} character={character} selected={character.id === selectedId} onSelect={() => selectCharacter(character)} />)}</div>
              : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">{members.map((character) => <CastCard key={character.id} character={character} selected={character.id === selectedId} onSelect={() => selectCharacter(character)} />)}</div>}
          </section>;
        })}
        {(() => {
          const voices = characters.filter((character) => !character.onCamera);
          if (voices.length === 0) return null;
          return <section>
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-300"><Mic className="h-3.5 w-3.5 text-amber-300" />Voices</h2>
              <span className="font-mono text-xs text-zinc-500">{voices.length}</span>
              <span className="text-xs text-zinc-600">· Heard, never seen: no character sheet, never drawn in storyboards</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">{voices.map((character) => <CastRow key={character.id} character={character} typeName={typeLabel(characterTypes, character.characterType)} selected={character.id === selectedId} onSelect={() => selectCharacter(character)} />)}</div>
          </section>;
        })()}
      </div>
      {isProfileVisible && <aside className="self-start border border-zinc-800 bg-zinc-950 xl:sticky xl:top-0 xl:max-h-[calc(100vh-9rem)] xl:overflow-y-auto">{selected ? (() => {
        const theme = characterTheme(selected);
        const missing = missingFields(selected);
        const fieldProps = { selected, isEditingProfile, profileForm, isSavingProfile, onChange: updateForm, onReset: (field: EditableField) => void resetField(field, FIELD_LABELS[field]) };
        const selectedType = characterTypes.get(selected.characterType);
        // While editing, the form follows the draft type and presence so the right fields appear.
        const shownType = isEditingProfile ? characterTypes.get(roleDraft.characterType) : selectedType;
        const shownOnCamera = isEditingProfile ? roleDraft.onCamera : selected.onCamera;
        const detailFields: CharacterDetailField[] = shownType?.detailFields ?? [];
        const hasVoice = VOICE_FIELDS.some((field) => selected.voice[field]);
        const syncable = selected.manualOverrideFields.some((field) => (EDITABLE_FIELDS as string[]).includes(field));
        const textFact = (key: ProfileOverrideKey, label: string, value: string | null, draft: string, placeholder: string, onChange: (value: string) => void, multiline = false) => (
          <TextFact key={key} label={label} value={value} manual={selected.manualOverrideFields.includes(key)} isEditing={isEditingProfile} draft={draft} placeholder={placeholder} multiline={multiline}
            busy={isSavingProfile} onChange={onChange} onReset={() => void resetField(key, label)} />
        );
        return <div>
          <div className="flex items-start gap-3 border-b border-zinc-800 p-4">
            {selected.onCamera
              ? <Portrait character={selected} className="h-20 w-16 shrink-0 border border-zinc-800" initialsClassName="text-xl" sizes="64px" />
              : <span className="flex h-20 w-16 shrink-0 items-center justify-center border border-zinc-800 bg-zinc-900" style={{ color: theme.accent }} title="Voice only"><Mic className="h-6 w-6" /></span>}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-bold" style={{ color: theme.accent }}>{selected.name}</h2>
              <p className={`truncate text-sm ${selected.role ? 'text-zinc-300' : 'italic text-zinc-600'}`}>{selected.role ?? 'Role not set'}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500"><PresenceBadge character={selected} type={selectedType} />{selected.onCamera && <><TierBadge ranking={selected.ranking} emptyLabel="Unranked" />{selected.ranking && <span className="font-mono">#{selected.ranking.rank}</span>}</>}</div>
              <TagBadges character={selected} />
              <button type="button" onClick={() => openPreview()} className="mt-2 inline-flex h-7 items-center gap-1.5 border px-2 text-[11px] font-semibold hover:bg-zinc-900" style={{ borderColor: theme.border, color: theme.accent }} title={!selected.onCamera ? 'Voice only: profile and voice' : selected.sheet || selected.sheetVersions.length ? 'Open the character sheet' : 'No character sheet yet'}><Expand className="h-3.5 w-3.5" />Preview character</button>
            </div>
            <button type="button" onClick={beginProfileEdit} className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-zinc-700 text-zinc-300 hover:bg-zinc-900" title="Edit character profile"><Pencil className="h-3.5 w-3.5" /></button>
          </div>
          <div role="tablist" className="grid grid-cols-2 border-b border-zinc-800 text-xs font-semibold">
            {(['profile', 'sheet'] as PanelTab[]).map((tab) => <button key={tab} type="button" role="tab" aria-selected={panelTab === tab} onClick={() => setPanelTab(tab)} className={`-mb-px border-b-2 py-2.5 ${panelTab === tab ? 'text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`} style={panelTab === tab ? { borderColor: theme.accent } : undefined}>
              {tab === 'profile' ? 'Profile' : <>Character sheet {!selected.onCamera ? <span className="ml-1 font-normal text-amber-300/80">voice only</span> : selected.sheet ? <CheckCircle2 className="ml-1 inline h-3 w-3 text-emerald-400" /> : <span className="ml-1 font-normal text-zinc-500">none</span>}</>}
            </button>)}
          </div>
          <div className="p-4">{panelTab === 'profile' ? <>
            {!isEditingProfile && missing.length > 0 && <button type="button" onClick={beginProfileEdit} className="mb-4 flex w-full items-center justify-between gap-3 border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-left text-xs text-amber-200 hover:bg-amber-400/10"><span>{missing.length} detail{missing.length === 1 ? ' isn’t' : 's aren’t'} in the script yet</span><span className="shrink-0 font-semibold">Fill in</span></button>}
            {isEditingProfile && <label className="mb-3 block"><span className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-zinc-600">Tags / aliases<span className="normal-case tracking-normal text-zinc-600">Comma separated</span></span><input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} placeholder="VOSS, Detective" className="w-full border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-400" /></label>}
            {isEditingProfile && <RoleEditor draft={roleDraft} types={characterTypes} offered={offeredTypes} manual={selected.manualOverrideFields} onChange={setRoleDraft} />}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              <ProfileField field="role" label="Role" {...fieldProps} />
              <ProfileField field="age" label="Age" {...fieldProps} />
              <ProfileField field="gender" label="Gender" {...fieldProps} />
              {shownOnCamera && <>
                <ProfileField field="race" label="Race" {...fieldProps} />
                {(isEditingProfile || PHYSICAL_FIELDS.some((field) => selected[field])) && <SectionHeading title="Look & build" hint="stays the same in every shot" />}
                {PHYSICAL_FIELDS.map((field) => <ProfileField key={field} field={field} label={FIELD_LABELS[field]} multiline={MULTILINE_FIELDS.includes(field)} {...fieldProps} />)}
                <ProfileField field="appearance" label={FIELD_LABELS.appearance} multiline {...fieldProps} />
              </>}
              {detailFields.length > 0 && (isEditingProfile || detailFields.some((field) => selected.typeDetails[field.key])) && <SectionHeading title={`${shownType?.label ?? 'Type'} details`} />}
              {detailFields.map((field) => textFact(
                `type_details.${field.key}`, field.label, selected.typeDetails[field.key] ?? null, roleDraft.details[field.key] ?? '', field.hint,
                (value) => setRoleDraft((draft) => ({ ...draft, details: { ...draft.details, [field.key]: value } })),
              ))}
              {(isEditingProfile || hasVoice || !shownOnCamera) && <SectionHeading title="Voice" hint={shownOnCamera ? 'how they sound' : 'all the audience gets of them'} />}
              {VOICE_FIELDS.map((field) => (isEditingProfile || selected.voice[field] || !shownOnCamera) && textFact(
                `voice.${field}`, VOICE_LABELS[field], selected.voice[field], roleDraft.voice[field], VOICE_PLACEHOLDERS[field],
                (value) => setRoleDraft((draft) => ({ ...draft, voice: { ...draft.voice, [field]: value } })), field === 'delivery',
              ))}
              <ProfileField field="personality" label="Personality" multiline {...fieldProps} />
            </dl>
            {isEditingProfile && <div className="mt-3 flex gap-2"><button type="button" onClick={() => void saveProfile()} disabled={isSavingProfile} className="inline-flex h-9 flex-1 items-center justify-center gap-2 bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"><Save className="h-3.5 w-3.5" />{isSavingProfile ? 'Saving...' : 'Save profile'}</button><button type="button" onClick={() => setIsEditingProfile(false)} className="h-9 border border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-900">Cancel</button></div>}
            {selected.onCamera && <div className="mt-4 border-t border-zinc-800 pt-1"><CharacterImportance ranking={selected.ranking} /></div>}
            {selected.onCamera && <div className="mt-4 border-t border-zinc-800 pt-4"><button type="button" onClick={() => void openScriptPreview()} disabled={isSyncingScript || !syncable} title={syncable ? 'Preview a controlled update to the first character appearance' : 'Save a manual profile value before updating the script'} className="flex h-9 w-full items-center justify-center gap-2 border border-zinc-700 text-xs font-semibold text-zinc-200 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"><FileText className="h-3.5 w-3.5" />{isSyncingScript ? 'Preparing script update...' : 'Update script'}</button></div>}
          </> : !selected.onCamera ? <VoiceOnlySheetNotice character={selected} type={selectedType} /> : <>
            {sheetResult?.characterId === selected.id && <SheetResultCard result={sheetResult} characterName={selected.name} onPreview={openPreview} onDismiss={() => setSheetResult(null)} />}
            <CharacterSheetPanel character={selected} busy={isGenerating || approvingId !== null} approvingId={approvingId} onApprove={(assetId) => void approveSheet(assetId)} onPreview={openPreview} onDownload={() => void downloadSheet(selected)} />
            {isGenerating ? <div className="border border-violet-500/30 bg-violet-500/5 p-3" role="status" aria-live="polite"><div className="mb-1.5 flex items-center justify-between text-xs"><span className="flex items-center gap-2 text-zinc-200"><RefreshCw className="h-3.5 w-3.5 animate-spin text-violet-300" />Generating character sheet</span><span className="font-mono text-violet-300">{formatElapsed(elapsedSeconds)}</span></div><div className="h-1.5 overflow-hidden bg-zinc-800"><div className="h-full bg-violet-500 transition-[width] duration-500" style={{ width: `${generationProgress}%` }} /></div><p className="mt-2 text-[10px] leading-relaxed text-zinc-500">{generatingModel && <span className="font-mono text-zinc-400">{generatingModel}</span>}{generatingModel ? ' · ' : ''}Each result is checked for the face close-up and all four views and redrawn if one is missing (up to 3 tries), so this can take a few minutes. The result appears here.</p></div>
              : <CharacterSheetCreator key={selected.id} projectId={projectId} characterName={selected.name} hasSheet={Boolean(selected.sheet)} busy={approvingId !== null} onGenerate={generateSheet} />}
          </>}</div>
        </div>;
      })() : <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center text-sm text-zinc-600"><Users className="mb-3 h-6 w-6" />Select a character to inspect its script profile.</div>}</aside>}</div>}
  </div>{scriptPreview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><div role="dialog" aria-modal="true" aria-labelledby="script-sync-title" className="w-full max-w-lg border border-zinc-700 bg-zinc-950 p-5 shadow-2xl"><h2 id="script-sync-title" className="text-base font-semibold text-zinc-100">Review script update</h2><p className="mt-2 text-sm text-zinc-400">{scriptPreview.action === 'insert' ? 'Insert' : 'Replace'} one managed action line before the first appearance in <span className="text-zinc-200">{scriptPreview.scene_slugline ?? 'the selected scene'}</span>.</p><pre className="mt-4 whitespace-pre-wrap border border-zinc-800 bg-zinc-900/50 p-3 font-sans text-sm leading-6 text-zinc-200">{scriptPreview.content}</pre><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setScriptPreview(null)} disabled={isSyncingScript} className="h-9 border border-zinc-700 px-3 text-xs font-semibold text-zinc-300 hover:bg-zinc-900">Cancel</button><button type="button" onClick={() => void confirmScriptUpdate()} disabled={isSyncingScript} className="h-9 bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50">{isSyncingScript ? 'Updating...' : 'Confirm update'}</button></div></div></div>}{selected && <CharacterSheetModal
      open={sheetModal !== null}
      onClose={() => setSheetModal(null)}
      name={selected.name}
      subtitle={selected.role}
      accent={characterTheme(selected).accent}
      badges={[
        typeLabel(characterTypes, selected.characterType),
        ...(!selected.onCamera ? ['Voice only'] : []),
        ...(selected.onCamera && selected.ranking ? [TIER_GROUPS.find((group) => group.key === selected.ranking?.tier)?.label ?? selected.ranking.tier] : []),
        ...(selected.sheet ? ['Used in storyboards'] : []),
      ]}
      sheetUrl={selected.sheet?.url ?? selected.sheetVersions[0]?.url ?? null}
      faceUrl={selected.sheet?.faceUrl}
      review={selected.sheet?.review}
      initialUrl={sheetModal?.initialUrl}
      facts={characterFacts(selected, characterTypes.get(selected.characterType))}
      versions={selected.sheetVersions.map((version, index) => ({
        id: version.assetId, url: version.url, label: `v${selected.sheetVersions.length - index}`, active: version.assetId === selected.sheet?.assetId,
      }))}
      emptyMessage={selected.onCamera ? `Open the Character sheet tab to generate ${selected.name}'s sheet from a prompt or reference images.` : `${selected.name} is voice only, so there is no character sheet.`}
    />}</div>;
}