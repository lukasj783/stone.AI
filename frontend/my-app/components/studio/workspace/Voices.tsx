"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AudioLines, CheckCircle2, Copy, Mic2, Play, RefreshCw, Sparkles, Square, Upload, Volume2, Wand2, X } from 'lucide-react';
import {
  type AudioCastMember,
  type AudioLine,
  type AudioOverview,
  type ClonedVoice,
  type SavedDesignedVoice,
  type SceneAudio,
  type VoiceOption,
  type VoicePreview,
  cloneVoice,
  designVoice,
  generateSceneAudio,
  getVoiceDesignSuggestion,
  saveDesignedVoice,
  getAudioOverview,
  getSceneAudio,
  listVoices,
  setCharacterVoice,
  updateAudioSettings,
} from '@/lib/api/audio';

interface VoicesProps { projectId: string | null; }

/** Languages eleven_v4 speaks; '' lets the model detect the language from the text. */
const LANGUAGES: { code: string; label: string }[] = [
  { code: '', label: 'Auto-detect' },
  { code: 'sw', label: 'Swahili' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
  { code: 'ar', label: 'Arabic' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'es', label: 'Spanish' },
  { code: 'hi', label: 'Hindi' },
  { code: 'am', label: 'Amharic' },
  { code: 'so', label: 'Somali' },
  { code: 'zu', label: 'Zulu' },
  { code: 'ha', label: 'Hausa' },
];

const KIND_LABEL: Record<AudioLine['kind'], string> = { dialogue: 'Dialogue', narration: 'Narration', action: 'Action (narrated)' };

const errorText = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback);

function voiceLabel(voice: VoiceOption): string {
  const details = [voice.labels.gender, voice.labels.accent, voice.labels.age].filter(Boolean).join(', ');
  return details ? `${voice.name} (${details})` : voice.name;
}

/** Shows the text sent to ElevenLabs with its [audio tags] highlighted. */
function TaggedText({ text }: { text: string }) {
  return <>{text.split(/(\[[^[\]]+\])/g).map((part, index) => (/^\[[^[\]]+\]$/.test(part)
    ? <span key={index} className="mx-0.5 rounded bg-violet-500/15 px-1 py-0.5 font-mono text-[11px] text-violet-300">{part}</span>
    : <span key={index}>{part}</span>))}</>;
}

function VoiceSelect({ voices, voiceId, voiceName, disabled, onChange, emptyLabel = 'No voice' }: {
  voices: VoiceOption[];
  voiceId: string | null;
  voiceName: string | null;
  disabled?: boolean;
  onChange: (voice: VoiceOption | null) => void;
  emptyLabel?: string;
}) {
  const known = voices.some((voice) => voice.voice_id === voiceId);
  return (
    <select
      value={voiceId ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(voices.find((voice) => voice.voice_id === event.target.value) ?? null)}
      className="h-8 w-full min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-200 disabled:opacity-50"
    >
      <option value="">{emptyLabel}</option>
      {voiceId && !known && <option value={voiceId}>{voiceName ?? voiceId}</option>}
      {voices.map((voice) => <option key={voice.voice_id} value={voice.voice_id}>{voiceLabel(voice)}</option>)}
    </select>
  );
}

const MAX_CLONE_FILES = 10;

/** Instant Voice Clone from recordings of a speaker who agreed to it. */
function CloneVoicePanel({ projectId, cast, initialAssignTo, initialName, onClose, onCloned }: {
  projectId: string;
  cast: AudioCastMember[];
  initialAssignTo: string | null;
  initialName: string;
  onClose: () => void;
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
        <button type="button" onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-zinc-300"><X className="h-4 w-4" /></button>
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

const DESIGN_TEXT_MIN = 100;
const DESIGN_TEXT_MAX = 1000;

/** Voice Design: describe a voice in words, listen to the previews, keep one. */
function DesignVoicePanel({ projectId, cast, initialAssignTo, onClose, onSaved }: {
  projectId: string;
  cast: AudioCastMember[];
  initialAssignTo: string | null;
  onClose: () => void;
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
        <button type="button" onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-zinc-300"><X className="h-4 w-4" /></button>
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

export function Voices({ projectId }: VoicesProps) {
  const [overview, setOverview] = useState<AudioOverview | null>(null);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [sceneAudio, setSceneAudio] = useState<SceneAudio | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSceneLoading, setIsSceneLoading] = useState(false);
  const [generating, setGenerating] = useState<'scene' | string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Which clone form is open: null = closed; assignTo/name prefill it (e.g. from a cast row).
  const [cloneForm, setCloneForm] = useState<{ key: number; assignTo: string | null; name: string } | null>(null);
  const [designForm, setDesignForm] = useState<{ key: number; assignTo: string | null } | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const sceneAudioRef = useRef<HTMLAudioElement | null>(null);

  const loadOverview = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    setError(null);
    try {
      const loaded = await getAudioOverview(projectId);
      setOverview(loaded);
      setSelectedSceneId((current) => (current && loaded.scenes.some((scene) => scene.id === current)
        ? current
        : loaded.scenes.find((scene) => scene.line_count > 0)?.id ?? loaded.scenes[0]?.id ?? null));
      if (loaded.configured) setVoices(await listVoices());
    } catch (reason) {
      setError(errorText(reason, 'Failed to load the audio cast.'));
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  const loadScene = useCallback(async () => {
    if (!projectId || !selectedSceneId) { setSceneAudio(null); return; }
    setIsSceneLoading(true);
    try {
      setSceneAudio(await getSceneAudio(projectId, selectedSceneId));
    } catch (reason) {
      setError(errorText(reason, 'Failed to load the scene lines.'));
    } finally {
      setIsSceneLoading(false);
    }
  }, [projectId, selectedSceneId]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { void loadScene(); }, [loadScene]);
  useEffect(() => () => { previewRef.current?.pause(); sceneAudioRef.current?.pause(); }, []);

  const voicedLines = useMemo(() => (sceneAudio?.lines ?? []).filter((line) => line.audio_url), [sceneAudio]);

  const playPreview = (url: string | null | undefined) => {
    if (!url) return;
    previewRef.current?.pause();
    previewRef.current = new Audio(url);
    void previewRef.current.play().catch(() => setError('The browser blocked audio playback.'));
  };

  const stopScene = () => { sceneAudioRef.current?.pause(); sceneAudioRef.current = null; setPlayingIndex(null); };
  const playSceneFrom = (index: number) => {
    const line = voicedLines[index];
    if (!line?.audio_url) { stopScene(); return; }
    sceneAudioRef.current?.pause();
    const player = new Audio(line.audio_url);
    player.onended = () => playSceneFrom(index + 1);
    sceneAudioRef.current = player;
    setPlayingIndex(index);
    void player.play().catch(() => { setError('The browser blocked audio playback.'); stopScene(); });
  };

  const saveSettings = async (update: Parameters<typeof updateAudioSettings>[1]) => {
    if (!projectId) return;
    setSavingId('settings');
    setError(null);
    try {
      await updateAudioSettings(projectId, update);
      await Promise.all([loadOverview(), loadScene()]);
    } catch (reason) {
      setError(errorText(reason, 'Failed to save audio settings.'));
    } finally {
      setSavingId(null);
    }
  };

  const assignVoice = async (characterId: string, voice: VoiceOption | null) => {
    if (!projectId) return;
    setSavingId(characterId);
    setError(null);
    try {
      await setCharacterVoice(projectId, characterId, voice);
      setOverview((current) => current && {
        ...current,
        cast: current.cast.map((member) => (member.character_id === characterId
          ? { ...member, voice_id: voice?.voice_id ?? null, voice_name: voice?.name ?? null }
          : member)),
      });
      await loadScene();
    } catch (reason) {
      setError(errorText(reason, 'Failed to save the character voice.'));
    } finally {
      setSavingId(null);
    }
  };

  const generate = async (blockId?: string) => {
    if (!projectId || !selectedSceneId) return;
    stopScene();
    setGenerating(blockId ?? 'scene');
    setError(null);
    try {
      const result = await generateSceneAudio(projectId, selectedSceneId, blockId ? [blockId] : undefined);
      setSceneAudio(result);
      if (result.failed) setError(`${result.failed} line${result.failed === 1 ? '' : 's'} failed; see the error on each line and try again.`);
      void getAudioOverview(projectId).then(setOverview).catch(() => undefined);
    } catch (reason) {
      setError(errorText(reason, 'Audio generation failed.'));
    } finally {
      setGenerating(null);
    }
  };

  // One voice-making form at a time.
  const openCloneForm = (assignTo: string | null, name: string) => { setDesignForm(null); setCloneForm({ key: Date.now(), assignTo, name }); };
  const openDesignForm = (assignTo: string | null) => { setCloneForm(null); setDesignForm({ key: Date.now(), assignTo }); };
  const targetName = (assignedTo: string | null) => (assignedTo === 'narrator' ? 'the narrator'
    : overview?.cast.find((member) => member.character_id === assignedTo)?.name);

  const handleDesigned = async (voice: SavedDesignedVoice) => {
    setDesignForm(null);
    const target = targetName(voice.assigned_to);
    setNotice(`Designed "${voice.name}"${target ? ` and gave it to ${target}` : ' and added it to your ElevenLabs voices'}.`);
    await Promise.all([loadOverview(), loadScene()]);
  };

  const handleCloned = async (voice: ClonedVoice) => {
    setCloneForm(null);
    const target = targetName(voice.assigned_to);
    setNotice(`Cloned "${voice.name}"${target ? ` and gave it to ${target}` : ' and added it to your ElevenLabs voices'}.${voice.requires_verification
      ? ' ElevenLabs needs the speaker to verify it before it can speak: on elevenlabs.io open My Voices, select the voice and follow the verification step.'
      : ''}`);
    await Promise.all([loadOverview(), loadScene()]);
  };

  if (!projectId) return <div className="flex h-full items-center justify-center text-sm text-zinc-500">Loading project...</div>;

  const selectedScene = overview?.scenes.find((scene) => scene.id === selectedSceneId) ?? null;
  const missing = sceneAudio?.missing_voices ?? [];
  const busy = generating !== null;
  const speakingCast = overview?.cast.filter((member) => member.line_count > 0) ?? [];
  const silentCast = overview?.cast.filter((member) => member.line_count === 0) ?? [];

  return <div className="h-full overflow-auto px-6 py-7 lg:px-8"><div className="mx-auto max-w-7xl">
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-5">
      <div>
        <div className="flex items-center gap-2.5"><Mic2 className="h-5 w-5 text-violet-400" /><h1 className="text-xl font-bold text-zinc-100">Voices</h1></div>
        <p className="mt-1 text-sm text-zinc-500">
          Narration and character dialogue with ElevenLabs{overview ? <> (<span className="font-mono text-zinc-400">{overview.model}</span>)</> : null}. Parentheticals become audio tags such as <span className="font-mono text-violet-300">[whispers]</span>.
        </p>
      </div>
      <button type="button" onClick={() => void loadOverview()} disabled={isLoading} className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs font-semibold text-zinc-300">
        <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />Refresh
      </button>
    </header>

    {error && <div className="mb-5 flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
    {notice && <div className="mb-5 flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span className="flex-1">{notice}</span>
      <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss"><X className="h-4 w-4" /></button>
    </div>}
    {overview && !overview.configured && <div className="mb-5 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      ElevenLabs is not connected. Add <span className="font-mono">ELEVENLABS_API_KEY=...</span> to <span className="font-mono">backend/.env</span> and restart the API.
    </div>}

    {isLoading && !overview ? <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-zinc-500"><RefreshCw className="h-5 w-5 animate-spin" />Loading voices...</div> : overview && <div className="grid gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
      <aside className="space-y-6">
        <section className="border border-zinc-800 bg-zinc-950 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Narration</h2>
          <label className="mt-3 block text-xs text-zinc-400">Narrator voice
            <span className="ml-1 text-zinc-600">({overview.narrator_line_count} unattributed line{overview.narrator_line_count === 1 ? '' : 's'})</span>
          </label>
          <div className="mt-1 flex gap-2">
            <VoiceSelect voices={voices} voiceId={overview.narrator_voice_id} voiceName={overview.narrator_voice_name} disabled={!overview.configured || savingId === 'settings'}
              onChange={(voice) => void saveSettings({ narrator_voice_id: voice?.voice_id ?? null, narrator_voice_name: voice?.name ?? null })} />
            <button type="button" title="Preview voice" disabled={!overview.narrator_voice_id} onClick={() => playPreview(voices.find((voice) => voice.voice_id === overview.narrator_voice_id)?.preview_url)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-700 text-zinc-400 disabled:opacity-40"><Volume2 className="h-3.5 w-3.5" /></button>
            <button type="button" title="Design a narrator voice" disabled={!overview.configured} onClick={() => openDesignForm('narrator')}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-700 text-zinc-400 disabled:opacity-40"><Sparkles className="h-3.5 w-3.5" /></button>
            <button type="button" title="Clone a narrator voice" disabled={!overview.configured} onClick={() => openCloneForm('narrator', 'Narrator')}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-700 text-zinc-400 disabled:opacity-40"><Copy className="h-3.5 w-3.5" /></button>
          </div>
          <label className="mt-3 block text-xs text-zinc-400">Language</label>
          <select value={overview.language_code ?? ''} disabled={savingId === 'settings'} onChange={(event) => void saveSettings({ language_code: event.target.value || null })}
            className="mt-1 h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-200">
            {LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}{language.code ? ` (${language.code})` : ''}</option>)}
            {overview.language_code && !LANGUAGES.some((language) => language.code === overview.language_code) && <option value={overview.language_code}>{overview.language_code}</option>}
          </select>
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-zinc-300">
            <input type="checkbox" checked={overview.narrate_action} disabled={savingId === 'settings'} onChange={(event) => void saveSettings({ narrate_action: event.target.checked })} className="mt-0.5 accent-violet-500" />
            <span>Narrate action lines<span className="block text-[11px] text-zinc-500">The narrator reads the scene description between dialogue, like an audiobook.</span></span>
          </label>
        </section>

        {cloneForm && <CloneVoicePanel key={cloneForm.key} projectId={projectId} cast={overview.cast}
          initialAssignTo={cloneForm.assignTo} initialName={cloneForm.name}
          onClose={() => setCloneForm(null)} onCloned={(voice) => void handleCloned(voice)} />}
        {designForm && <DesignVoicePanel key={designForm.key} projectId={projectId} cast={overview.cast}
          initialAssignTo={designForm.assignTo} onClose={() => setDesignForm(null)} onSaved={(voice) => void handleDesigned(voice)} />}

        <section className="border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Cast</h2>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => openDesignForm(null)} disabled={!overview.configured}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-sky-300 disabled:opacity-40"><Sparkles className="h-3 w-3" />Design</button>
              <button type="button" onClick={() => openCloneForm(null, '')} disabled={!overview.configured}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-violet-300 disabled:opacity-40"><Copy className="h-3 w-3" />Clone</button>
            </div>
          </div>
          {overview.unmatched_speakers.length > 0 && <p className="mt-2 text-[11px] leading-5 text-amber-300">No character profile for {overview.unmatched_speakers.join(', ')}: extract characters on the Characters page to give them a voice.</p>}
          {speakingCast.length === 0 && <p className="mt-3 text-xs text-zinc-500">No character speaks in the script yet.</p>}
          <ul className="mt-3 space-y-3">
            {[...speakingCast, ...silentCast].map((member) => {
              const profile = Object.values(member.voice_profile).filter(Boolean).join(' · ');
              return <li key={member.character_id} className={member.line_count === 0 ? 'opacity-60' : ''}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-zinc-200">{member.name}</span>
                  <span className="shrink-0 text-[11px] text-zinc-500">{member.line_count} line{member.line_count === 1 ? '' : 's'}</span>
                </div>
                {profile && <p className="truncate text-[11px] text-zinc-500" title={profile}>{profile}</p>}
                {member.voice_is_designed && <p className="mt-0.5 text-[10px] uppercase tracking-wide text-sky-300">Designed voice</p>}
                {member.voice_is_clone && <p className="mt-0.5 flex gap-2 text-[10px] uppercase tracking-wide">
                  <span className="text-violet-300">Cloned voice</span>
                  {member.voice_requires_verification && <span className="text-amber-300" title="The speaker must verify this clone on elevenlabs.io (My Voices) before it can speak">Needs verification</span>}
                </p>}
                <div className="mt-1 flex gap-2">
                  <VoiceSelect voices={voices} voiceId={member.voice_id} voiceName={member.voice_name} disabled={!overview.configured || savingId === member.character_id}
                    onChange={(voice) => void assignVoice(member.character_id, voice)} />
                  <button type="button" title="Preview voice" disabled={!member.voice_id} onClick={() => playPreview(voices.find((voice) => voice.voice_id === member.voice_id)?.preview_url)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-700 text-zinc-400 disabled:opacity-40"><Volume2 className="h-3.5 w-3.5" /></button>
                  <button type="button" title={`Design a voice for ${member.name} from the script`} disabled={!overview.configured} onClick={() => openDesignForm(member.character_id)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-700 text-zinc-400 disabled:opacity-40"><Sparkles className="h-3.5 w-3.5" /></button>
                  <button type="button" title={`Clone a voice for ${member.name}`} disabled={!overview.configured} onClick={() => openCloneForm(member.character_id, member.name)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-700 text-zinc-400 disabled:opacity-40"><Copy className="h-3.5 w-3.5" /></button>
                </div>
              </li>;
            })}
          </ul>
        </section>
      </aside>

      <section className="min-w-0 border border-zinc-800 bg-zinc-950">
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 p-4">
          <select value={selectedSceneId ?? ''} onChange={(event) => { stopScene(); setSelectedSceneId(event.target.value || null); }}
            className="h-9 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-200">
            {overview.scenes.length === 0 && <option value="">No scenes yet</option>}
            {overview.scenes.map((scene, index) => <option key={scene.id} value={scene.id}>
              {index + 1}. {scene.title} — {scene.generated_count}/{scene.line_count} voiced
            </option>)}
          </select>
          {voicedLines.length > 0 && (playingIndex === null
            ? <button type="button" onClick={() => playSceneFrom(0)} className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs font-semibold text-zinc-200"><Play className="h-3.5 w-3.5" />Play scene</button>
            : <button type="button" onClick={stopScene} className="inline-flex h-9 items-center gap-2 rounded-md border border-violet-500/50 bg-violet-500/10 px-3 text-xs font-semibold text-violet-200"><Square className="h-3.5 w-3.5" />Stop</button>)}
          <button type="button" onClick={() => void generate()} disabled={!overview.configured || busy || !sceneAudio?.lines.length || missing.length > 0}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-violet-600 px-3 text-xs font-semibold text-white disabled:bg-zinc-800 disabled:text-zinc-500">
            {generating === 'scene' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            {generating === 'scene' ? 'Generating...' : selectedScene?.generated_count ? 'Regenerate scene' : 'Generate scene audio'}
          </button>
        </div>

        {missing.length > 0 && <div className="border-b border-zinc-800 bg-amber-500/5 px-4 py-2 text-xs text-amber-300">Choose a voice for {missing.join(', ')} before generating.</div>}

        {isSceneLoading && !sceneAudio ? <div className="flex min-h-60 items-center justify-center gap-3 text-sm text-zinc-500"><RefreshCw className="h-4 w-4 animate-spin" />Loading lines...</div>
          : !sceneAudio?.lines.length ? <div className="flex min-h-60 flex-col items-center justify-center px-6 text-center text-sm text-zinc-500"><AudioLines className="mb-3 h-6 w-6 text-zinc-600" />This scene has no narration or dialogue{overview.narrate_action ? '' : '. Turn on "Narrate action lines" to voice its description'}.</div>
          : <ol className="divide-y divide-zinc-800/80">
            {sceneAudio.lines.map((line) => {
              const playIndex = voicedLines.findIndex((voiced) => voiced.block_id === line.block_id);
              const isPlaying = playingIndex !== null && playIndex === playingIndex;
              return <li key={line.block_id} className={`p-4 ${isPlaying ? 'bg-violet-500/5' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-100">{line.speaker}</span>
                  <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">{KIND_LABEL[line.kind]}</span>
                  <span className="text-[11px] text-zinc-500">{line.voice_name ?? (line.voice_id ? 'Voice set' : 'No voice')}</span>
                  {line.audio_url && !line.is_stale && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                  {line.is_stale && <span className="text-[11px] text-amber-300">Script or voice changed: regenerate</span>}
                  <button type="button" onClick={() => void generate(line.block_id)} disabled={!overview.configured || busy || !line.voice_id}
                    className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-700 px-2 text-[11px] font-semibold text-zinc-300 disabled:opacity-40">
                    <RefreshCw className={`h-3 w-3 ${generating === line.block_id ? 'animate-spin' : ''}`} />{line.audio_url ? 'Regenerate' : 'Generate'}
                  </button>
                </div>
                <p className="mt-2 text-xs leading-5 text-zinc-500">
                  {line.parentheticals.length > 0 && <span className="italic text-zinc-400">{line.parentheticals.map((p) => (p.startsWith('(') ? p : `(${p})`)).join(' ')} </span>}
                  {line.source_text}
                </p>
                <p className="mt-1 text-sm leading-6 text-zinc-200"><TaggedText text={line.text} /></p>
                {line.dropped_directions.length > 0 && <p className="mt-1 text-[11px] text-zinc-600">Not sent (not about the voice): {line.dropped_directions.join(', ')}</p>}
                {line.error && <p className="mt-1 text-[11px] text-red-300">{line.error}</p>}
                {line.audio_url && <audio controls preload="none" src={line.audio_url} className="mt-2 h-8 w-full max-w-md" />}
              </li>;
            })}
          </ol>}
      </section>
    </div>}
  </div></div>;
}
