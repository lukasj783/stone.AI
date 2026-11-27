"use client";

import type { ReactNode } from 'react';
import Image from 'next/image';
import { ObjectTier } from '@/lib/api/story';

/** Same groups, labels and hints as the Characters page. */
export const TIER_GROUPS: { key: ObjectTier | 'unranked'; label: string; hint: string }[] = [
  { key: 'major', label: 'Major', hint: 'Carry the story' },
  { key: 'medium', label: 'Medium', hint: 'Recurring presence' },
  { key: 'minor', label: 'Minor', hint: 'Brief appearances' },
  { key: 'unranked', label: 'Unranked', hint: 'Not found in the current script' },
];

export const tierLabel = (tier: ObjectTier | null | undefined) => TIER_GROUPS.find((group) => group.key === (tier ?? 'unranked'))?.label ?? 'Unranked';

const ACCENT = '#a78bfa';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || '?';

interface TierGroupsProps<T> {
  items: T[];
  tierOf: (item: T) => ObjectTier | null;
  renderCard: (item: T) => ReactNode;
  renderRow: (item: T) => ReactNode;
}

/** Major and medium items as big cards, minor and unranked ones as compact rows. */
export function TierGroups<T>({ items, tierOf, renderCard, renderRow }: TierGroupsProps<T>) {
  return <div className="space-y-7">
    {TIER_GROUPS.map((group) => {
      const members = items.filter((item) => (tierOf(item) ?? 'unranked') === group.key);
      if (members.length === 0) return null;
      const compact = group.key === 'minor' || group.key === 'unranked';
      return <section key={group.key}>
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">{group.label}</h2>
          <span className="font-mono text-xs text-zinc-500">{members.length}</span>
          <span className="text-xs text-zinc-600">· {group.hint}</span>
        </div>
        {compact
          ? <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">{members.map(renderRow)}</div>
          : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">{members.map(renderCard)}</div>}
      </section>;
    })}
  </div>;
}

export interface EntityStat { icon: ReactNode; value: ReactNode; title: string; }

interface EntityItemProps {
  name: string;
  imageUrl: string | null;
  rank: number | null;
  /** Corner badge: "Sheet" / "No sheet", "Main image" / "No image". */
  badge: { label: string; ok: boolean };
  subtitle: string | null;
  /** Shown in italics when there is no subtitle. */
  emptySubtitle?: string;
  stats: EntityStat[];
  /** e.g. "3 to fill", shown in amber on the right of the stats. */
  note?: string | null;
  selected: boolean;
  onSelect: () => void;
}

/** The item's image, or its initials on a soft glow when there is none yet. */
export function EntityThumb({ name, imageUrl, className, initialsClassName, sizes, fit = 'cover' }: { name: string; imageUrl: string | null; className: string; initialsClassName: string; sizes: string; fit?: 'cover' | 'contain' }) {
  return <div className={`relative overflow-hidden bg-zinc-900 ${className}`} style={imageUrl ? undefined : { background: `radial-gradient(circle at 50% 40%, ${ACCENT}26, transparent 70%), #18181b` }}>
    {imageUrl ? <Image src={imageUrl} alt="" fill sizes={sizes} unoptimized className={fit === 'contain' ? 'object-contain' : 'object-cover'} />
      : <span className={`absolute inset-0 flex items-center justify-center font-bold tracking-wide text-violet-300/70 ${initialsClassName}`}>{initials(name)}</span>}
  </div>;
}

const selectedStyle = (selected: boolean) => selected ? { borderColor: ACCENT, boxShadow: `0 0 0 1px ${ACCENT}` } : undefined;

/** Image card for major and medium objects or environments. */
export function EntityCard({ name, imageUrl, rank, badge, subtitle, emptySubtitle = 'No description yet', stats, note, selected, onSelect, aspect }: EntityItemProps & { aspect: 'square' | 'video' }) {
  return <button type="button" onClick={onSelect} aria-pressed={selected} className={`group flex flex-col overflow-hidden border bg-zinc-900/40 text-left transition hover:-translate-y-0.5 hover:bg-zinc-900 ${selected ? '' : 'border-zinc-800 hover:border-zinc-600'}`} style={selectedStyle(selected)}>
    <div className="relative">
      <EntityThumb name={name} imageUrl={imageUrl} className={`${aspect === 'square' ? 'aspect-square' : 'aspect-video'} w-full`} initialsClassName="text-4xl" sizes="240px" fit={aspect === 'square' ? 'contain' : 'cover'} />
      <span className="absolute left-2 top-2 bg-zinc-950/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">#{rank ?? '–'}</span>
      <span className={`absolute right-2 top-2 bg-zinc-950/80 px-1.5 py-0.5 text-[10px] font-semibold ${badge.ok ? 'text-emerald-300' : 'text-zinc-500'}`}>{badge.label}</span>
      <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: badge.ok ? ACCENT : '#27272a' }} />
    </div>
    <div className="flex flex-1 flex-col p-3">
      <span className="truncate text-sm font-semibold text-zinc-100">{name}</span>
      <span className={`mt-0.5 line-clamp-2 text-xs ${subtitle ? 'text-zinc-400' : 'italic text-zinc-600'}`}>{subtitle ?? emptySubtitle}</span>
      <div className="mt-auto flex items-center gap-3 pt-3 text-[11px] text-zinc-500">
        {stats.map((stat) => <span key={stat.title} className="inline-flex items-center gap-1" title={stat.title}>{stat.icon}{stat.value}</span>)}
        {note && <span className="ml-auto text-amber-400/80">{note}</span>}
      </div>
    </div>
  </button>;
}

/** Compact row for minor and unranked objects or environments. */
export function EntityRow({ name, imageUrl, badge, subtitle, emptySubtitle = 'No description yet', stats, selected, onSelect }: EntityItemProps) {
  return <button type="button" onClick={onSelect} aria-pressed={selected} className={`flex items-center gap-3 border bg-zinc-900/40 p-2 text-left transition hover:bg-zinc-900 ${selected ? '' : 'border-zinc-800 hover:border-zinc-600'}`} style={selectedStyle(selected)}>
    <EntityThumb name={name} imageUrl={imageUrl} className="h-12 w-12 shrink-0" initialsClassName="text-sm" sizes="48px" />
    <div className="min-w-0 flex-1">
      <span className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold text-zinc-100">{name}</span><span className={`shrink-0 text-[9px] font-semibold uppercase ${badge.ok ? 'text-emerald-300' : 'text-zinc-600'}`}>{badge.label}</span></span>
      <span className={`block truncate text-[11px] ${subtitle ? 'text-zinc-500' : 'italic text-zinc-600'}`}>{subtitle ?? emptySubtitle}</span>
    </div>
    <div className="flex shrink-0 items-center gap-2.5 font-mono text-[11px] text-zinc-500">
      {stats.map((stat) => <span key={stat.title} className="inline-flex items-center gap-1" title={stat.title}>{stat.icon}{stat.value}</span>)}
    </div>
  </button>;
}
