"use client";

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Play, RefreshCw, Sparkles, X } from 'lucide-react';
import {
  type AudioCastMember,
  type SavedDesignedVoice,
  type VoicePreview,
  designVoice,
  getVoiceDesignSuggestion,
  saveDesignedVoice,
} from '@/lib/api/audio';
import { errorText } from './shared';

const DESIGN_TEXT_MIN = 100;
const DESIGN_TEXT_MAX = 1000;

/** Voice Design: describe a voice in words, listen to the previews, keep one. */
export function DesignVoiceForm({ projectId, cast, initialAssignTo, onClose, onSaved }: {
  projectId: string;
  cast: AudioCastMember[];
  initialAssignTo: string | null;
  /** Shows a close button when given (Studio opens the form as a panel). */
  onClose?: () => void;
  onSaved: (voice: SavedDesignedVoice) => void;
}) {
  const [assignTo, setAssignTo] = useState<string>(initialAssignTo ?? '');
  const [voiceName, setVoiceName] = useState('');
  const [description, setDescription] = useState('');
  const [sampleText, setSampleText] = useState('');
  const [previews, setPreviews] = useState<VoicePreview[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'suggest' | 'design' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);

  // Prefill from the script whenever the target changes; everything stays editable.
  useEffect(() => {
    if (!assignTo) return;
    let isMounted = true;
    const prefill = async () => {
      setBusy('suggest');
      setError(null);
      try {
        const suggestion = await getVoiceDesignSuggestion(projectId, assignTo);
        if (!isMounted) return;
        setVoiceName(suggestion.voice_name);
        setDescription(suggestion.description);
        setSampleText(suggestion.sample_text);
        setPreviews([]);
        setSelectedId(null);
      } catch (reason) {
        if (isMounted) setError(errorText(reason, 'Failed to prepare the voice design.'));
      } finally {
        if (isMounted) setBusy(null);
      }
    };
    void prefill();
    return () => { isMounted = false; };
  }, [projectId, assignTo]);
  useEffect(() => () => playerRef.current?.pause(), []);

  const play = (preview: VoicePreview) => {
    playerRef.current?.pause();
    playerRef.current = new Audio(`data:${preview.media_type};base64,${preview.audio_base64}`);
    setSelectedId(preview.generated_voice_id);
    void playerRef.current.play().catch(() => setError('The browser blocked audio playback.'));
  };

  const generatePreviews = async () => {
    setBusy('design');
    setError(null);
    playerRef.current?.pause();
    try {
      const results = await designVoice(projectId, description.trim(), sampleText);
      setPreviews(results);
      setSelectedId(results[0]?.generated_voice_id ?? null);
    } catch (reason) {
      setError(errorText(reason, 'Voice design failed.'));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!selectedId) return;
    setBusy('save');
    setError(null);
    try {
      onSaved(await saveDesignedVoice(projectId, {
        generatedVoiceId: selectedId, voiceName: voiceName.trim(), description: description.trim(), assignTo: assignTo || null,
      }));
    } catch (reason) {
      setError(errorText(reason, 'Saving the designed voice failed.'));
    } finally {
      setBusy(null);
    }
  };

  const sampleLength = sampleText.trim().length;
  const sampleInvalid = sampleLength > 0 && (sampleLength < DESIGN_TEXT_MIN || sampleLength > DESIGN_TEXT_MAX);
  const canDesign = description.trim().length > 0 && !sampleInvalid && busy === null;
  return (
    <section className="border border-sky-500/40 bg-sky-500/5 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-sky-300">Design a voice</h2>
        {onClose && <button type="button" onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-zinc-300"><X className="h-4 w-4" /></button>}
      </div>
      <p className="mt-2 text-[11px] leading-5 text-zinc-400">Describe the voice in words; ElevenLabs creates a few new voices to choose from. No recordings needed.</p>

      <label className="mt-3 block text-xs text-zinc-400">For</label>
      <select value={assignTo} onChange={(event) => setAssignTo(event.target.value)} disabled={busy !== null}
        className="mt-1 h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-200">
        <option value="">Only add it to my ElevenLabs voices</option>
        <option value="narrator">Narrator</option>
        {cast.map((member) => <option key={member.character_id} value={member.character_id}>{member.name}</option>)}
      </select>

      <label className="mt-3 block text-xs text-zinc-400">Voice description {busy === 'suggest' && <span className="text-zinc-600">(filling from the script...)</span>}</label>
      <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={4}
        placeholder="e.g. A warm, elderly Swahili storyteller with a slow, gentle pace and a slight rasp"
        className="mt-1 w-full resize-y rounded-md border border-zinc-700 bg-zinc-950 p-2 text-xs leading-5 text-zinc-200 placeholder:text-zinc-600" />

      <label className="mt-3 flex items-baseline justify-between text-xs text-zinc-400">
        <span>Preview text <span className="text-zinc-600">(optional)</span></span>
        <span className={`font-mono text-[10px] ${sampleInvalid ? 'text-amber-300' : 'text-zinc-600'}`}>{sampleLength}/{DESIGN_TEXT_MAX}</span>
      </label>
      <textarea value={sampleText} onChange={(event) => setSampleText(event.target.value)} maxLength={DESIGN_TEXT_MAX} rows={3}
        placeholder="What the previews say. Leave empty and ElevenLabs writes a sample."
        className="mt-1 w-full resize-y rounded-md border border-zinc-700 bg-zinc-950 p-2 text-xs leading-5 text-zinc-200 placeholder:text-zinc-600" />
      {sampleInvalid && <p className="mt-1 text-[11px] text-amber-300">Use {DESIGN_TEXT_MIN}-{DESIGN_TEXT_MAX} characters, or leave it empty.</p>}

      <button type="button" onClick={() => void generatePreviews()} disabled={!canDesign}
        className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md border border-sky-500/50 bg-sky-500/10 text-xs font-semibold text-sky-200 disabled:opacity-40">
        {busy === 'design' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {busy === 'design' ? 'Designing...' : previews.length ? 'Design new previews' : 'Design previews'}
      </button>

      {previews.length > 0 && <div className="mt-3">
        <p className="text-xs text-zinc-400">Listen and pick one</p>
        <ul className="mt-1 space-y-1.5">
          {previews.map((preview, index) => {
            const isSelected = preview.generated_voice_id === selectedId;
            return <li key={preview.generated_voice_id}>
              <button type="button" onClick={() => play(preview)}
                className={`flex h-9 w-full items-center gap-2 rounded-md border px-2 text-left text-xs ${isSelected ? 'border-sky-400 bg-sky-500/15 text-sky-100' : 'border-zinc-700 bg-zinc-950 text-zinc-300'}`}>
                <Play className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">Option {index + 1}</span>
                {preview.duration_seconds != null && <span className="font-mono text-[10px] text-zinc-500">{preview.duration_seconds.toFixed(1)}s</span>}
                {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-sky-300" />}
              </button>
            </li>;
          })}
        </ul>
        <label className="mt-3 block text-xs text-zinc-400">Voice name</label>
        <input value={voiceName} onChange={(event) => setVoiceName(event.target.value)} maxLength={100}
          className="mt-1 h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-200" />
        <button type="button" onClick={() => void save()} disabled={!selectedId || !voiceName.trim() || busy !== null}
          className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-sky-600 text-xs font-semibold text-white disabled:bg-zinc-800 disabled:text-zinc-500">
          {busy === 'save' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {busy === 'save' ? 'Saving...' : assignTo ? 'Keep this voice and use it' : 'Keep this voice'}
        </button>
      </div>}

      {error && <p className="mt-3 text-[11px] text-red-300">{error}</p>}
    </section>
  );
}
