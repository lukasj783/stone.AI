"use client";

import { useEffect, useState } from 'react';
import { AlertTriangle, Cpu } from 'lucide-react';
import { listStoryboardModels } from '@/lib/api/image-generation';
import { StoryboardModelOption } from '@/lib/types/image-generation';

export const DEFAULT_STORYBOARD_MODEL = 'google/nano-banana-2/edit';

interface StoryboardModelPickerProps {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}

/**
 * Choose which WaveSpeed image-edit model renders storyboard frames. Every shot sends its
 * character, location and prop reference images to the chosen model.
 */
export function StoryboardModelPicker({ value, onChange, disabled = false }: StoryboardModelPickerProps) {
  const [models, setModels] = useState<StoryboardModelOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listStoryboardModels()
      .then((loaded) => { if (active) { setModels(loaded); setLoadError(null); } })
      .catch((reason) => { if (active) setLoadError(reason instanceof Error ? reason.message : 'Could not load models.'); });
    return () => { active = false; };
  }, []);

  // A remembered choice that the server no longer offers falls back to the default.
  useEffect(() => {
    if (models.length && !models.some((model) => model.id === value)) {
      onChange(models.find((model) => model.is_default)?.id ?? models[0].id);
    }
  }, [models, value, onChange]);

  const selected = models.find((model) => model.id === value);
  const families = Array.from(new Set(models.map((model) => model.family)));

  return <div className="flex min-w-0 flex-col items-end gap-1">
    <label className="flex items-center gap-2 text-[11px] text-zinc-400">
      <Cpu className="h-3.5 w-3.5 text-violet-400" />
      <span className="whitespace-nowrap">Storyboard model</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || models.length === 0}
        aria-label="Storyboard image model"
        className="max-w-60 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] font-semibold text-zinc-200 outline-none focus:border-violet-400 disabled:opacity-50"
      >
        {models.length === 0 && <option value={value}>{loadError ? 'Default (WaveSpeed)' : 'Loading models...'}</option>}
        {families.map((family) => <optgroup key={family} label={family}>
          {models.filter((model) => model.family === family).map((model) => (
            <option key={model.id} value={model.id}>{model.label}{model.is_default ? ' (default)' : ''}{model.verified ? '' : ' · unverified'}</option>
          ))}
        </optgroup>)}
      </select>
    </label>
    {selected && <p className="max-w-md text-right text-[10px] leading-4 text-zinc-500">
      <span className="font-mono text-zinc-400">{selected.id}</span> · up to {selected.max_images} reference images
      {!selected.verified && <span className="ml-1 inline-flex items-center gap-1 text-amber-300"><AlertTriangle className="h-3 w-3" />settings not confirmed against WaveSpeed docs</span>}
    </p>}
    {loadError && <p className="text-[10px] text-red-300">{loadError}</p>}
  </div>;
}
