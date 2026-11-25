"use client";

import { useRef, useState } from 'react';
import { Copy, RefreshCw, Upload, X } from 'lucide-react';
import {
  type AudioCastMember,
  type ClonedVoice,
  cloneVoice,
} from '@/lib/api/audio';
import { errorText } from './shared';

const MAX_CLONE_FILES = 10;

/** Instant Voice Clone from recordings of a speaker who agreed to it. */
export function CloneVoiceForm({ projectId, cast, initialAssignTo, initialName, onClose, onCloned }: {
  projectId: string;
  cast: AudioCastMember[];
  initialAssignTo: string | null;
  initialName: string;
  /** Shows a close button when given (Studio opens the form as a panel). */
  onClose?: () => void;
  onCloned: (voice: ClonedVoice) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState('');
  const [assignTo, setAssignTo] = useState<string>(initialAssignTo ?? '');
  const [removeNoise, setRemoveNoise] = useState(false);
  const [consent, setConsent] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = (picked: FileList | null) => {
    if (!picked) return;
    setFiles((current) => [...current, ...Array.from(picked)].slice(0, MAX_CLONE_FILES));
    if (inputRef.current) inputRef.current.value = '';
  };

  const submit = async () => {
    setIsCloning(true);
    setError(null);
    try {
      onCloned(await cloneVoice(projectId, {
        name: name.trim(), files, consentConfirmed: consent, description, removeBackgroundNoise: removeNoise,
        assignTo: assignTo || null,
      }));
    } catch (reason) {
      setError(errorText(reason, 'Voice cloning failed.'));
    } finally {
      setIsCloning(false);
    }
  };

  const canSubmit = consent && files.length > 0 && name.trim().length > 0 && !isCloning;
  return (
    <section className="border border-violet-500/40 bg-violet-500/5 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-violet-300">Clone a voice</h2>
        {onClose && <button type="button" onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-zinc-300"><X className="h-4 w-4" /></button>}
      </div>
      <p className="mt-2 text-[11px] leading-5 text-zinc-400">
        Upload clean recordings of one speaker (no music or other voices). A minute or two of varied, natural speech gives the best clone.
      </p>

      <label className="mt-3 block text-xs text-zinc-400">Voice name</label>
      <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100}
        className="mt-1 h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-200" />

      <label className="mt-3 block text-xs text-zinc-400">Recordings ({files.length}/{MAX_CLONE_FILES})</label>
      <input ref={inputRef} type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.flac,.webm" multiple className="hidden" onChange={(event) => addFiles(event.target.files)} />
      <button type="button" onClick={() => inputRef.current?.click()} disabled={files.length >= MAX_CLONE_FILES}
        className="mt-1 flex h-9 w-full items-center justify-center gap-2 border border-dashed border-zinc-700 bg-zinc-950 text-xs text-zinc-400 disabled:opacity-50">
        <Upload className="h-3.5 w-3.5" />Add audio files
      </button>
      {files.length > 0 && <ul className="mt-2 space-y-1">
        {files.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 text-[11px] text-zinc-300">
          <span className="truncate">{file.name}</span>
          <span className="flex shrink-0 items-center gap-2 text-zinc-500">{(file.size / (1024 * 1024)).toFixed(1)} MB
            <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}><X className="h-3 w-3" /></button>
          </span>
        </li>)}
      </ul>}

      <label className="mt-3 block text-xs text-zinc-400">Description <span className="text-zinc-600">(optional)</span></label>
      <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="e.g. warm Swahili storyteller, middle-aged"
        className="mt-1 h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-200 placeholder:text-zinc-600" />

      <label className="mt-3 block text-xs text-zinc-400">Use for</label>
      <select value={assignTo} onChange={(event) => setAssignTo(event.target.value)}
        className="mt-1 h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-200">
        <option value="">Only add it to my ElevenLabs voices</option>
        <option value="narrator">Narrator</option>
        {cast.map((member) => <option key={member.character_id} value={member.character_id}>{member.name}</option>)}
      </select>

      <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-zinc-300">
        <input type="checkbox" checked={removeNoise} onChange={(event) => setRemoveNoise(event.target.checked)} className="mt-0.5 accent-violet-500" />
        <span>Remove background noise<span className="block text-[11px] text-zinc-500">Only for noisy recordings; it can make clean ones worse.</span></span>
      </label>
      <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-md border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-200">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 accent-violet-500" />
        <span>This is my voice, or the speaker has given me permission to clone it and use it in this project.
          <span className="block text-[11px] text-zinc-500">ElevenLabs may ask the speaker to verify by reading a short text aloud before the voice can be used.</span>
        </span>
      </label>

      {error && <p className="mt-3 text-[11px] text-red-300">{error}</p>}
      <button type="button" onClick={() => void submit()} disabled={!canSubmit}
        className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-violet-600 text-xs font-semibold text-white disabled:bg-zinc-800 disabled:text-zinc-500">
        {isCloning ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
        {isCloning ? 'Cloning...' : 'Clone voice'}
      </button>
    </section>
  );
}
