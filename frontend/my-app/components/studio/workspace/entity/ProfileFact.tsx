"use client";

import { RotateCcw } from 'lucide-react';

interface ProfileFactProps {
  label: string;
  value: string | null;
  /** The user typed this value (shows "Manual" and a Reset link). */
  manual: boolean;
  isEditing: boolean;
  draft: string;
  placeholder: string;
  multiline?: boolean;
  busy: boolean;
  onChange: (value: string) => void;
  /** Clear the manual value (the field goes back to what the script says, often nothing); no Reset link when omitted. */
  onReset?: () => void;
}

/** One profile field: read-only with its source badge, or an input while editing. */
export function ProfileFact({ label, value, manual, isEditing, draft, placeholder, multiline = false, busy, onChange, onReset }: ProfileFactProps) {
  if (isEditing) {
    const inputClass = 'w-full border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-400';
    return <label className={multiline ? 'col-span-2 block' : 'block'}>
      <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-600">{label}</span>
      {multiline
        ? <textarea value={draft} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className={`${inputClass} min-h-16 resize-y`} />
        : <input value={draft} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className={inputClass} />}
    </label>;
  }
  return <div className={multiline ? 'col-span-2' : ''}>
    <dt className="flex items-center gap-1 text-zinc-600">{label}{value && <span className={`border px-1 text-[9px] font-semibold uppercase ${manual ? 'border-violet-400/30 text-violet-300' : 'border-zinc-700 text-zinc-500'}`}>{manual ? 'Manual' : 'From script'}</span>}</dt>
    <dd className={`mt-1 ${value ? 'text-zinc-300' : 'italic text-zinc-600'}`}>{value || 'Not specified'}</dd>
    {manual && onReset && <button type="button" onClick={onReset} disabled={busy} className="mt-1 inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-200 disabled:opacity-50"><RotateCcw className="h-3 w-3" />Reset</button>}
  </div>;
}

/** A divider heading inside a two-column profile grid. */
export const SectionHeading = ({ title, hint }: { title: string; hint?: string }) => <p className="col-span-2 -mb-1 mt-1 border-t border-zinc-800 pt-3 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{title}{hint && <span className="font-normal normal-case tracking-normal text-zinc-600"> · {hint}</span>}</p>;
