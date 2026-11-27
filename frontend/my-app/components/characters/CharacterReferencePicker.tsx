"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { CharacterReferenceTag } from '@/lib/types/image-generation';

export const MAX_SHEET_REFERENCES = 4;

export interface ReferenceTagOption<T extends string = CharacterReferenceTag> { value: T; label: string; hint: string; }

export const REFERENCE_TAG_OPTIONS: ReferenceTagOption[] = [
  { value: 'face', label: 'Face', hint: 'Copy this face and identity' },
  { value: 'outfit', label: 'Outfit', hint: 'Copy this clothing and accessories' },
  { value: 'style', label: 'Style', hint: 'Copy only the art style' },
];
/** Sensible first guesses: a face, then an outfit, then style references. */
const DEFAULT_TAGS: CharacterReferenceTag[] = ['face', 'outfit', 'style', 'style'];

export interface DraftReference<T extends string = CharacterReferenceTag> { file: File; tag: T; id: string; previewUrl: string; }

/**
 * Up to four tagged reference images with local previews, freed when no longer shown.
 * ``defaultTags`` gives the tag of the 1st, 2nd... image added (characters: face, outfit, style).
 */
export function useReferenceDrafts<T extends string = CharacterReferenceTag>(defaultTags: readonly T[] = DEFAULT_TAGS as unknown as T[]) {
  const [references, setReferences] = useState<DraftReference<T>[]>([]);
  const latest = useRef(references);
  useEffect(() => { latest.current = references; }, [references]);
  useEffect(() => () => latest.current.forEach((reference) => URL.revokeObjectURL(reference.previewUrl)), []);

  const add = useCallback((files: FileList | File[] | null) => {
    const images = Array.from(files ?? []).filter((file) => file.type.startsWith('image/'));
    setReferences((current) => [
      ...current,
      ...images.slice(0, MAX_SHEET_REFERENCES - current.length).map((file, index): DraftReference<T> => ({
        id: `${file.name}-${file.size}-${Date.now()}-${index}`,
        file,
        tag: defaultTags[current.length + index] ?? defaultTags[defaultTags.length - 1],
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  }, [defaultTags]);
  const remove = useCallback((id: string) => setReferences((current) => current.filter((reference) => {
    if (reference.id === id) URL.revokeObjectURL(reference.previewUrl);
    return reference.id !== id;
  })), []);
  const setTag = useCallback((id: string, tag: T) =>
    setReferences((current) => current.map((reference) => reference.id === id ? { ...reference, tag } : reference)), []);
  const clear = useCallback(() => setReferences((current) => {
    current.forEach((reference) => URL.revokeObjectURL(reference.previewUrl));
    return [];
  }), []);
  /** The files and tags to send, without the local preview fields. */
  const toRequest = useCallback((): { file: File; tag: T }[] => latest.current.map(({ file, tag }) => ({ file, tag })), []);

  return { references, add, remove, setTag, clear, toRequest };
}

export interface ReferenceDrafts<T extends string = CharacterReferenceTag> {
  references: DraftReference<T>[];
  add: (files: FileList | File[] | null) => void;
  remove: (id: string) => void;
  setTag: (id: string, tag: T) => void;
  clear: () => void;
  toRequest: () => { file: File; tag: T }[];
}

interface CharacterReferencePickerProps<T extends string> {
  drafts: ReferenceDrafts<T>;
  /** Tags offered per image; characters' face / outfit / style when omitted. */
  tagOptions?: ReferenceTagOption<T>[];
  /** Line under the grid explaining the tags; the characters' wording when omitted. */
  tagHint?: React.ReactNode;
  characterName?: string;
  disabled?: boolean;
  /** Grid columns, e.g. "grid-cols-2" in a side panel or "grid-cols-2 sm:grid-cols-4" on a page. */
  gridClassName?: string;
}

/** Add, drop, tag and remove up to four reference images for a character (or object) sheet. */
export function CharacterReferencePicker<T extends string = CharacterReferenceTag>({ drafts, tagOptions, tagHint, characterName = 'the character', disabled = false, gridClassName = 'grid-cols-2' }: CharacterReferencePickerProps<T>) {
  const options = tagOptions ?? (REFERENCE_TAG_OPTIONS as unknown as ReferenceTagOption<T>[]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { references, add, remove, setTag } = drafts;

  return <div>
    <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" aria-label="Add reference images" onChange={(event) => { add(event.target.files); event.target.value = ''; }} />
    <div className={`grid gap-2 ${gridClassName}`}>
      {references.map((reference, index) => <div key={reference.id} className="border border-zinc-800 bg-zinc-950">
        <div className="relative aspect-square overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview, not an optimizable remote image */}
          <img src={reference.previewUrl} alt={`Reference ${index + 1} for ${characterName}`} className="h-full w-full object-cover" />
          <span className="absolute left-1 top-1 bg-zinc-950/85 px-1 font-mono text-[10px] text-zinc-300">{index + 1}</span>
          <button type="button" onClick={() => remove(reference.id)} disabled={disabled} aria-label={`Remove reference ${index + 1}`} className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center bg-zinc-950/85 text-zinc-300 hover:text-white disabled:opacity-50"><X className="h-3.5 w-3.5" /></button>
        </div>
        <label className="block p-1.5">
          <span className="sr-only">Use reference {index + 1} for</span>
          <select value={reference.tag} onChange={(event) => setTag(reference.id, event.target.value as T)} disabled={disabled} title={options.find((option) => option.value === reference.tag)?.hint} className="h-7 w-full border border-zinc-700 bg-zinc-950 px-1.5 text-[11px] text-zinc-200 outline-none focus:border-violet-400">
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}: {option.hint.toLowerCase()}</option>)}
          </select>
        </label>
      </div>)}
      {references.length < MAX_SHEET_REFERENCES && <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => { event.preventDefault(); setIsDragging(false); add(event.dataTransfer.files); }}
        disabled={disabled}
        className={`flex aspect-square flex-col items-center justify-center gap-1.5 border border-dashed text-center text-[11px] disabled:opacity-50 ${isDragging ? 'border-violet-400 bg-violet-500/10 text-violet-200' : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'}`}
      >
        <ImagePlus className="h-5 w-5" />
        <span>Add or drop image</span>
        <span className="font-mono text-[10px] text-zinc-600">{references.length}/{MAX_SHEET_REFERENCES}</span>
      </button>}
    </div>
    <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">{tagHint ?? <>Tag each image: <span className="text-zinc-300">Face</span> keeps the likeness, <span className="text-zinc-300">Outfit</span> the costume, <span className="text-zinc-300">Style</span> only the look.</>}</p>
  </div>;
}
