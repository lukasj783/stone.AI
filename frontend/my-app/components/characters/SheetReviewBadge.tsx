"use client";

import { ShieldCheck } from 'lucide-react';
import { CharacterSheetReview } from '@/lib/types/image-generation';

const PARTS: { key: 'face' | CharacterSheetReview['views'][number]; label: string }[] = [
  { key: 'face', label: 'Face close-up' },
  { key: 'front', label: 'Front' },
  { key: 'three_quarter', label: '3/4' },
  { key: 'profile', label: 'Profile' },
  { key: 'back', label: 'Back' },
];

/** Which parts of the sheet were confirmed in the model's output, and how they were checked. */
export function SheetReviewBadge({ review, className = '' }: { review: CharacterSheetReview | null | undefined; className?: string }) {
  if (!review) return null;
  const found = (key: string) => key === 'face' ? review.face_closeup : review.views.includes(key as CharacterSheetReview['views'][number]);
  return <div className={`flex flex-wrap items-center gap-1 text-[10px] ${className}`} title={review.method === 'vision' ? 'Checked by the vision model' : 'Checked from the sheet layout (vision check unavailable)'}>
    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
    <span className="mr-0.5 text-zinc-500">{review.method === 'vision' ? 'Checked:' : 'Layout checked:'}</span>
    {PARTS.map((part) => <span key={part.key} className={`border px-1 py-px font-semibold ${found(part.key) ? 'border-emerald-400/30 text-emerald-300' : 'border-amber-400/30 text-amber-300 line-through'}`}>{part.label}</span>)}
  </div>;
}
