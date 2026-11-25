"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Mic2, RefreshCw, Volume2 } from 'lucide-react';
import { SPEECH_TEXT_MAX_CHARS, type VoiceOption, listVoices, speakText } from '@/lib/api/audio';
import { WaveformPlayer } from '@/components/audio/WaveformPlayer';
import { EmptyState, ErrorBanner, HelpHint, NotConfiguredNotice, ToolPageHeader } from '@/components/audio/Feedback';
import { LANGUAGES, TaggedText, VoiceSelect, errorText, isNotConfiguredError } from '@/components/audio/shared';
import { cn } from '@/lib/utils';

/** Delivery tags ElevenLabs v3/v4 understand inline. */
const QUICK_TAGS = ['whispers', 'laughs', 'sighs', 'excited', 'sarcastic', 'short pause', 'long pause'];

interface Clip {
  id: string;
  src: string;
  voiceName: string;
  text: string;
  fileName: string;
}

function clipFileName(voiceName: string, extension: string): string {
  const slug = voiceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'speech';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${slug}-${stamp}.${extension}`;
}

export default function TextToSpeechPage() {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [isLoadingVoices, setIsLoadingVoices] = useState(true);
  const [voice, setVoice] = useState<VoiceOption | null>(null);
  const [language, setLanguage] = useState('');
  const [text, setText] = useState('');
  const [clips, setClips] = useState<Clip[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  const loadVoices = useCallback(async () => {
    setIsLoadingVoices(true);
    setVoicesError(null);
    try {
      const loaded = await listVoices();
      setVoices(loaded);
      setVoice((current) => current ?? loaded[0] ?? null);
    } catch (reason) {
      setVoicesError(errorText(reason, 'Failed to load voices.'));
    } finally {
      setIsLoadingVoices(false);
    }
  }, []);

  useEffect(() => { void loadVoices(); }, [loadVoices]);
  useEffect(() => () => previewRef.current?.pause(), []);

  const insertTag = (tag: string) => {
    const field = textRef.current;
    const insert = `[${tag}] `;
    const start = field?.selectionStart ?? text.length;
    const end = field?.selectionEnd ?? text.length;
    const next = (text.slice(0, start) + insert + text.slice(end)).slice(0, SPEECH_TEXT_MAX_CHARS);
    setText(next);
    setTextError(null);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + insert.length, start + insert.length);
    });
  };

  const previewVoice = () => {
    if (!voice?.preview_url) return;
    previewRef.current?.pause();
    previewRef.current = new Audio(voice.preview_url);
    void previewRef.current.play().catch(() => setError('The browser blocked audio playback. Click the page, then try again.'));
  };

  const generate = async () => {
    if (!voice) return;
    if (!text.trim()) { setTextError('Enter the text you want to hear.'); textRef.current?.focus(); return; }
    setIsGenerating(true);
    setError(null);
    try {
      const result = await speakText(voice.voice_id, text, language);
      setClips((current) => [{
        id: `${Date.now()}`,
        src: `data:${result.media_type};base64,${result.audio_base64}`,
        voiceName: voice.name,
        text: text.trim(),
        fileName: clipFileName(voice.name, result.file_extension),
      }, ...current]);
    } catch (reason) {
      setError(errorText(reason, 'Speech generation failed.'));
    } finally {
      setIsGenerating(false);
    }
  };

  const notConfigured = isNotConfiguredError(voicesError);
  const [latest, ...earlier] = clips;
  const count = text.length;

  return (
    <>
      <ToolPageHeader title="Text to speech">
        Type a line, pick a voice, and hear it. Use it to test voices before you give them to your characters.
      </ToolPageHeader>

      {notConfigured && <NotConfiguredNotice />}
      {voicesError && !notConfigured && <ErrorBanner message={voicesError} onRetry={() => void loadVoices()} />}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <form
          className="space-y-5"
          onSubmit={(event) => { event.preventDefault(); void generate(); }}
          aria-busy={isGenerating}
        >
          <div>
            <label htmlFor="tts-voice" className="block text-sm font-medium text-zinc-300">Voice</label>
            <div className="mt-1.5 flex gap-2">
              <VoiceSelect
                id="tts-voice"
                voices={voices}
                voiceId={voice?.voice_id ?? null}
                voiceName={voice?.name ?? null}
                disabled={isLoadingVoices || notConfigured}
                emptyLabel={isLoadingVoices ? 'Loading voices...' : 'Choose a voice'}
                onChange={setVoice}
                className="h-10 w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={previewVoice}
                disabled={!voice?.preview_url}
                title="Hear this voice"
                aria-label="Hear this voice"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-40"
              >
                <Volume2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="tts-language" className="block text-sm font-medium text-zinc-300">Language</label>
            <select
              id="tts-language"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100"
            >
              {LANGUAGES.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
            </select>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="tts-text" className="block text-sm font-medium text-zinc-300">Text</label>
              <span
                aria-live="polite"
                className={cn('text-xs tabular-nums', count >= SPEECH_TEXT_MAX_CHARS ? 'text-amber-300' : 'text-zinc-400')}
              >
                {count.toLocaleString()} / {SPEECH_TEXT_MAX_CHARS.toLocaleString()}
              </span>
            </div>
            <textarea
              id="tts-text"
              ref={textRef}
              value={text}
              onChange={(event) => { setText(event.target.value); setTextError(null); }}
              maxLength={SPEECH_TEXT_MAX_CHARS}
              rows={8}
              aria-invalid={Boolean(textError)}
              aria-describedby={textError ? 'tts-text-error' : 'tts-tags'}
              placeholder="Habari za asubuhi. [laughs] Umepata usingizi mzuri?"
              className={cn(
                'mt-1.5 w-full resize-y rounded-lg border bg-zinc-950 p-3 text-sm leading-6 text-zinc-100 placeholder:text-zinc-600',
                textError ? 'border-red-500/60' : 'border-zinc-700',
              )}
            />
            {textError && <p id="tts-text-error" className="mt-1.5 text-xs text-red-300">{textError}</p>}
            <div id="tts-tags" className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-zinc-400">Add a direction:</span>
              {QUICK_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => insertTag(tag)}
                  className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-[11px] text-violet-300 hover:border-violet-500/50 hover:text-violet-200"
                >
                  [{tag}]
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={!voice || isGenerating || notConfigured}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-purple-600 text-sm font-bold text-white transition-colors hover:bg-purple-500 disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            {isGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Mic2 className="h-4 w-4" />}
            {isGenerating ? 'Generating speech...' : 'Generate speech'}
          </button>
        </form>

        <section aria-label="Your clips" className="min-w-0 space-y-6">
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} onRetry={voice ? () => void generate() : undefined} />}

          {latest ? (
            <article className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">
              <p className="text-sm text-zinc-400"><span className="font-semibold text-zinc-100">{latest.voiceName}</span></p>
              <p className="mt-2 line-clamp-3 text-lg leading-7 text-zinc-200"><TaggedText text={latest.text} /></p>
              <WaveformPlayer key={latest.id} src={latest.src} label={`${latest.voiceName} clip`} downloadName={latest.fileName} size="lg" className="mt-6" />
            </article>
          ) : (
            <EmptyState icon={AudioLines} title="Your clips appear here">
              Generate speech to hear it. Clips stay on this page until you leave it, so download the ones you want to keep.
            </EmptyState>
          )}

          {earlier.length > 0 && (
            <div>
              <h2 className="text-base font-semibold text-zinc-200">Earlier clips</h2>
              <ul className="mt-3 divide-y divide-zinc-900 rounded-2xl border border-zinc-900">
                {earlier.map((clip) => (
                  <li key={clip.id} className="space-y-2 p-4">
                    <p className="truncate text-sm text-zinc-400"><span className="font-semibold text-zinc-200">{clip.voiceName}</span> {clip.text}</p>
                    <WaveformPlayer src={clip.src} label={`${clip.voiceName} clip`} downloadName={clip.fileName} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!latest && (
            <HelpHint title="Directing the delivery">
              <p>Put a direction in square brackets right before the words it changes, like <span className="font-mono text-violet-300">[whispers]</span> or <span className="font-mono text-violet-300">[short pause]</span>.</p>
              <p>Nothing is saved to your projects from this page.</p>
            </HelpHint>
          )}
        </section>
      </div>
    </>
  );
}
