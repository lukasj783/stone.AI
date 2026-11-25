"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Library, Search } from 'lucide-react';
import { type VoiceOption, listVoices } from '@/lib/api/audio';
import { WaveformPlayer } from '@/components/audio/WaveformPlayer';
import { EmptyState, ErrorBanner, NotConfiguredNotice, SkeletonRows, ToolPageHeader } from '@/components/audio/Feedback';
import { categoryLabel, errorText, isNotConfiguredError, voiceDetails } from '@/components/audio/shared';
import { cn } from '@/lib/utils';

const ALL = 'all';

function VoiceCard({ voice }: { voice: VoiceOption }) {
  const details = voiceDetails(voice);
  const extra = Object.entries(voice.labels)
    .filter(([key]) => !['gender', 'accent', 'age'].includes(key))
    .map(([, value]) => value)
    .filter(Boolean);
  return (
    <li className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold text-white">{voice.name}</h3>
          {details && <p className="mt-0.5 text-sm capitalize text-zinc-400">{details}</p>}
        </div>
        <span className="shrink-0 rounded-md border border-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{categoryLabel(voice.category)}</span>
      </div>
      {voice.description && <p className="mt-3 line-clamp-2 text-sm leading-6 text-zinc-400">{voice.description}</p>}
      {extra.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {extra.map((label) => <li key={label} className="rounded-md bg-zinc-900 px-2 py-0.5 text-xs capitalize text-zinc-300">{label}</li>)}
        </ul>
      )}
      <div className="mt-auto pt-5">
        {voice.preview_url
          ? <WaveformPlayer src={voice.preview_url} label={`${voice.name} sample`} lazy />
          : <p className="text-xs text-zinc-400">No sample for this voice. Try it in Text to speech.</p>}
      </div>
    </li>
  );
}

export default function VoiceLibraryPage() {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>(ALL);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setVoices(await listVoices());
    } catch (reason) {
      setError(errorText(reason, 'Failed to load voices.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    voices.forEach((voice) => {
      const label = categoryLabel(voice.category);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [voices]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return voices.filter((voice) => {
      if (category !== ALL && categoryLabel(voice.category) !== category) return false;
      if (!needle) return true;
      const haystack = [voice.name, voice.description, ...Object.values(voice.labels)].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [voices, query, category]);

  const notConfigured = isNotConfiguredError(error);

  return (
    <>
      <ToolPageHeader title="Voice library">
        Every voice you can use: ready-made ones, plus the voices you designed or cloned. Play a sample to hear it.
      </ToolPageHeader>

      {notConfigured && <NotConfiguredNotice />}
      {error && !notConfigured && <ErrorBanner message={error} onRetry={() => void load()} />}

      {!error && (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <label htmlFor="voice-search" className="sr-only">Search voices</label>
            <input
              id="voice-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, accent or mood"
              className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500"
            />
          </div>
          {categories.length > 1 && (
            <div role="group" aria-label="Filter by kind" className="flex flex-wrap gap-2">
              {[[ALL, voices.length] as const, ...categories].map(([label, count]) => {
                const isActive = category === label;
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setCategory(label)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                      isActive ? 'border-purple-500/60 bg-purple-500/15 text-white' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200',
                    )}
                  >
                    {label === ALL ? 'All' : label} <span className="tabular-nums text-zinc-500">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {isLoading ? <SkeletonRows count={4} /> : !error && (
        shown.length > 0 ? (
          <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {shown.map((voice) => <VoiceCard key={voice.voice_id} voice={voice} />)}
          </ul>
        ) : voices.length > 0 ? (
          <EmptyState
            icon={Search}
            title="No voices match"
            action={<button type="button" onClick={() => { setQuery(''); setCategory(ALL); }} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-500">Clear search</button>}
          >
            Try a different word, or show all kinds of voices.
          </EmptyState>
        ) : (
          <EmptyState
            icon={Library}
            title="No voices yet"
            action={<Link href="/audio/voice-design" className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-bold text-white hover:bg-purple-500">Design a voice</Link>}
          >
            Your ElevenLabs account has no voices. Design one from a description to get started.
          </EmptyState>
        )
      )}
    </>
  );
}
