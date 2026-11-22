"use client";

import { useState } from 'react';
import { Images, Type, Wand2 } from 'lucide-react';
import { CharacterReferencePicker, useReferenceDrafts } from '@/components/characters/CharacterReferencePicker';
import { useSheetModel } from '@/components/characters/useSheetModel';
import { StoryboardModelPicker } from './StoryboardModelPicker';
import { CharacterSheetReference } from '@/lib/types/image-generation';

type CreateMode = 'prompt' | 'references';

interface CharacterSheetCreatorProps {
  projectId: string;
  characterName: string;
  hasSheet: boolean;
  busy: boolean;
  /** Resolve true when the sheet was generated, so the form clears. */
  onGenerate: (prompt: string, references: CharacterSheetReference[], model: string) => Promise<boolean>;
}

/**
 * Inputs for one character model sheet: a prompt only, or up to four reference images
 * (each tagged face, outfit or style) plus a prompt. The script profile is always sent,
 * so the prompt only needs what the script doesn't say.
 */
export function CharacterSheetCreator({ projectId, characterName, hasSheet, busy, onGenerate }: CharacterSheetCreatorProps) {
  const [mode, setMode] = useState<CreateMode>('prompt');
  const [model, setModel] = useSheetModel(projectId);
  const [prompt, setPrompt] = useState('');
  const drafts = useReferenceDrafts();

  const usesReferences = mode === 'references';
  const canSubmit = !busy && (!usesReferences || drafts.references.length > 0);
  const submit = async () => {
    if (!canSubmit) return;
    if (await onGenerate(prompt.trim(), usesReferences ? drafts.toRequest() : [], model)) {
      drafts.clear(); setPrompt('');
    }
  };

  const tabClass = (active: boolean) => `flex h-8 flex-1 items-center justify-center gap-1.5 text-[11px] font-semibold ${active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`;
  return <div className="border border-zinc-800 bg-zinc-900/40 p-3">
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <span className="text-xs font-semibold text-zinc-200">{hasSheet ? 'New version' : 'Create character sheet'}</span>
      <span className="text-[10px] text-zinc-500">Face close-up + turnaround, one image</span>
    </div>
    <div role="tablist" aria-label="How to create the sheet" className="mb-3 flex border border-zinc-800 p-0.5">
      <button type="button" role="tab" aria-selected={!usesReferences} onClick={() => setMode('prompt')} className={tabClass(!usesReferences)}><Type className="h-3.5 w-3.5" />Prompt</button>
      <button type="button" role="tab" aria-selected={usesReferences} onClick={() => setMode('references')} className={tabClass(usesReferences)}><Images className="h-3.5 w-3.5" />Reference images + prompt</button>
    </div>

    {usesReferences && <div className="mb-3"><CharacterReferencePicker drafts={drafts} characterName={characterName} disabled={busy} /></div>}

    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-600">{usesReferences ? 'Prompt' : 'Prompt (optional)'}</span>
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        maxLength={4000}
        disabled={busy}
        placeholder={usesReferences ? 'What to change or add, e.g. "older, grey stubble, wears the coat from image 2 open"' : `Anything the script doesn't say about ${characterName}: build, hair, costume, wear and tear...`}
        className="min-h-20 w-full resize-y border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-400 disabled:opacity-60"
      />
    </label>
    <p className="mt-1 text-[10px] text-zinc-500">The script profile is always included.</p>
    <div className="mt-3"><StoryboardModelPicker value={model} onChange={setModel} disabled={busy} label="Character model" align="start" /></div>
    <button type="button" onClick={() => void submit()} disabled={!canSubmit} className="mt-2 flex h-10 w-full items-center justify-center gap-2 bg-violet-600 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50">
      <Wand2 className="h-4 w-4" />{hasSheet ? 'Generate new version' : 'Generate character sheet'}
    </button>
    {usesReferences && drafts.references.length === 0 && <p className="mt-1.5 text-center text-[10px] text-zinc-500">Add at least one reference image.</p>}
  </div>;
}
