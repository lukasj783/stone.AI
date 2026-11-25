"use client";

import type { VoiceOption } from '@/lib/api/audio';

/** Languages eleven_v4 speaks; '' lets the model detect the language from the text. */
export const LANGUAGES: { code: string; label: string }[] = [
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

export const errorText = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback);

/** True when the backend says ElevenLabs has no API key, so the page can show setup help instead. */
export const isNotConfiguredError = (message: string | null) => Boolean(message && /not configured/i.test(message));

export function voiceDetails(voice: VoiceOption): string {
  return [voice.labels.gender, voice.labels.accent, voice.labels.age].filter(Boolean).join(', ');
}

export function voiceLabel(voice: VoiceOption): string {
  const details = voiceDetails(voice);
  return details ? `${voice.name} (${details})` : voice.name;
}

/** ElevenLabs voice categories in the words people use for them. */
export function categoryLabel(category: string | null): string {
  switch (category) {
    case 'premade': return 'Ready-made';
    case 'cloned': return 'Cloned';
    case 'generated': return 'Designed';
    case 'professional': return 'Professional';
    default: return 'Other';
  }
}

/** Shows text sent to ElevenLabs with its [audio tags] highlighted. */
export function TaggedText({ text }: { text: string }) {
  return <>{text.split(/(\[[^[\]]+\])/g).map((part, index) => (/^\[[^[\]]+\]$/.test(part)
    ? <span key={index} className="mx-0.5 rounded bg-violet-500/15 px-1 py-0.5 font-mono text-[11px] text-violet-300">{part}</span>
    : <span key={index}>{part}</span>))}</>;
}

export function VoiceSelect({ voices, voiceId, voiceName, disabled, onChange, emptyLabel = 'No voice', className, id }: {
  voices: VoiceOption[];
  voiceId: string | null;
  voiceName: string | null;
  disabled?: boolean;
  onChange: (voice: VoiceOption | null) => void;
  emptyLabel?: string;
  className?: string;
  id?: string;
}) {
  const known = voices.some((voice) => voice.voice_id === voiceId);
  return (
    <select
      id={id}
      value={voiceId ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(voices.find((voice) => voice.voice_id === event.target.value) ?? null)}
      className={className ?? 'h-8 w-full min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-200 disabled:opacity-50'}
    >
      <option value="">{emptyLabel}</option>
      {voiceId && !known && <option value={voiceId}>{voiceName ?? voiceId}</option>}
      {voices.map((voice) => <option key={voice.voice_id} value={voice.voice_id}>{voiceLabel(voice)}</option>)}
    </select>
  );
}
