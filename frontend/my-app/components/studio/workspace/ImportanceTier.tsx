import { ObjectTier } from '@/lib/api/story';

export const TIER_STYLES: Record<ObjectTier, string> = {
  major: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
  medium: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  minor: 'border-zinc-700 text-zinc-500',
};

/** Major / medium / minor badge for a ranked object or environment. */
export function TierBadge({ ranking, emptyLabel = 'Not in script' }: { ranking: { tier: ObjectTier; score: number } | null; emptyLabel?: string }) {
  if (!ranking) return <span className="text-[10px] text-zinc-600">{emptyLabel}</span>;
  return <span title={`Score ${ranking.score}/4`} className={`border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${TIER_STYLES[ranking.tier]}`}>{ranking.tier}</span>;
}

/** One counted factor of a ranking, with the points it contributed. */
export function RankingStat({ label, value, score }: { label: string; value: number; score: number }) {
  return <div className="border border-zinc-800 bg-zinc-900/50 px-2 py-1.5"><dt className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</dt><dd className="mt-0.5 flex items-baseline justify-between"><span className="font-mono text-sm text-zinc-200">{value}</span><span className="font-mono text-[10px] text-zinc-500">+{score}</span></dd></div>;
}
