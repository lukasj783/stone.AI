"use client";

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, ExternalLink, LayoutPanelLeft, Maximize2, Minimize2, ScanFace, X } from 'lucide-react';
import { SheetReviewBadge } from '@/components/characters/SheetReviewBadge';
import { CharacterSheetReview } from '@/lib/types/image-generation';

export interface CharacterSheetVersion {
  id: string;
  url: string;
  label: string;
  /** The version storyboards use. */
  active?: boolean;
}

export interface CharacterFact {
  label: string;
  value: string;
}

interface CharacterSheetModalProps {
  open: boolean;
  onClose: () => void;
  name: string;
  /** Role or one-line description under the name. */
  subtitle?: string | null;
  /** Short chips beside the name, e.g. the importance tier. */
  badges?: string[];
  /** Character accent color for the name. */
  accent?: string;
  sheetUrl: string | null;
  /** Face close-up cut from the sheet, when the sheet is approved. */
  faceUrl?: string | null;
  review?: CharacterSheetReview | null;
  /** Profile details shown beside the sheet. */
  facts?: CharacterFact[];
  /** Other sheet versions to compare; the shown one starts at ``initialUrl`` or ``sheetUrl``. */
  versions?: CharacterSheetVersion[];
  initialUrl?: string | null;
  /** Text when there is no sheet yet. */
  emptyMessage?: string;
}

type ViewMode = 'sheet' | 'face';

const safeFileName = (name: string) => name.trim().replace(/[^\w-]+/g, '_') || 'character';

/** Save an image to disk; opens it in a new tab when the browser blocks the download. */
export async function downloadImage(url: string, filename: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed with status ${response.status}`);
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = Object.assign(document.createElement('a'), { href: objectUrl, download: filename });
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

/**
 * Full-screen preview of one character: the character sheet (face close-up and
 * turnaround), the face crop on its own, earlier versions, and the profile.
 */
export function CharacterSheetModal(props: CharacterSheetModalProps) {
  // Mount only while open, so each opening starts on the right version and view.
  if (!props.open || typeof document === 'undefined') return null;
  return createPortal(<CharacterSheetDialog {...props} />, document.body);
}

function CharacterSheetDialog({
  onClose, name, subtitle, badges = [], accent, sheetUrl, faceUrl, review, facts = [], versions = [], initialUrl, emptyMessage,
}: CharacterSheetModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<ViewMode>(initialUrl && initialUrl === faceUrl ? 'face' : 'sheet');
  const [actualSize, setActualSize] = useState(false);
  const [shownUrl, setShownUrl] = useState<string | null>(initialUrl && initialUrl !== faceUrl ? initialUrl : sheetUrl);

  // Focus the dialog, keep Tab inside it, close on Escape, and freeze the page behind it.
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [onClose]);

  const imageUrl = mode === 'face' ? faceUrl ?? null : shownUrl;
  const shownVersion = versions.find((version) => version.url === shownUrl);
  const imageLabel = mode === 'face' ? `${name} face close-up` : `${name} character sheet${shownVersion ? `, ${shownVersion.label}` : ''}`;
  const tabClass = (active: boolean) => `inline-flex h-8 items-center gap-1.5 px-3 text-xs font-semibold ${active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`;
  const toolClass = 'inline-flex h-8 items-center gap-1.5 border border-zinc-700 px-2.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40';

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-2 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex h-full max-h-[56rem] w-full max-w-7xl flex-col overflow-hidden border border-zinc-800 bg-zinc-950 shadow-2xl">
      <header className="flex items-start gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={titleId} className="truncate text-lg font-bold" style={accent ? { color: accent } : undefined}>{name}</h2>
            {badges.map((badge) => <span key={badge} className="border border-zinc-700 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{badge}</span>)}
          </div>
          {subtitle && <p className="truncate text-sm text-zinc-400">{subtitle}</p>}
        </div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close character preview" className="inline-flex h-9 w-9 shrink-0 items-center justify-center border border-zinc-700 text-zinc-300 hover:bg-zinc-900 hover:text-white"><X className="h-4 w-4" /></button>
      </header>

      {sheetUrl ? <>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2">
          <div role="tablist" aria-label="What to show" className="flex border border-zinc-800 p-0.5">
            <button type="button" role="tab" aria-selected={mode === 'sheet'} onClick={() => setMode('sheet')} className={tabClass(mode === 'sheet')}><LayoutPanelLeft className="h-3.5 w-3.5" />Character sheet</button>
            <button type="button" role="tab" aria-selected={mode === 'face'} onClick={() => setMode('face')} disabled={!faceUrl} title={faceUrl ? undefined : 'The face close-up is cut from the sheet once it is approved'} className={`${tabClass(mode === 'face')} disabled:cursor-not-allowed disabled:opacity-40`}><ScanFace className="h-3.5 w-3.5" />Face close-up</button>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setActualSize((value) => !value)} className={toolClass} aria-pressed={actualSize}>{actualSize ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}{actualSize ? 'Fit' : 'Actual size'}</button>
            {imageUrl && <a href={imageUrl} target="_blank" rel="noopener noreferrer" className={toolClass}><ExternalLink className="h-3.5 w-3.5" />Open original</a>}
            <button type="button" disabled={!imageUrl} onClick={() => imageUrl && void downloadImage(imageUrl, `${safeFileName(name)}_${mode === 'face' ? 'face' : 'sheet'}.jpg`)} className={toolClass}><Download className="h-3.5 w-3.5" />Download</button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className={`relative min-h-0 flex-1 bg-[#111113] ${actualSize ? 'overflow-auto' : 'flex items-center justify-center overflow-hidden p-3'}`}>
            {imageUrl && <button type="button" onClick={() => setActualSize((value) => !value)} aria-label={actualSize ? 'Fit image to the window' : 'Show image at actual size'} className={actualSize ? 'block cursor-zoom-out' : 'flex h-full w-full cursor-zoom-in items-center justify-center'}>
              {/* eslint-disable-next-line @next/next/no-img-element -- natural-size zoom needs the image's own dimensions */}
              <img src={imageUrl} alt={imageLabel} className={actualSize ? 'max-w-none' : 'max-h-full max-w-full object-contain'} />
            </button>}
          </div>

          {(facts.length > 0 || review) && <aside className="max-h-48 shrink-0 overflow-y-auto border-t border-zinc-800 p-4 lg:max-h-none lg:w-72 lg:border-l lg:border-t-0">
            {review && <SheetReviewBadge review={review} className="mb-4" />}
            {facts.length > 0 && <dl className="space-y-3 text-xs">
              {facts.map((fact) => <div key={fact.label}><dt className="text-[10px] uppercase tracking-wide text-zinc-600">{fact.label}</dt><dd className="mt-0.5 leading-relaxed text-zinc-300">{fact.value}</dd></div>)}
            </dl>}
          </aside>}
        </div>

        {versions.length > 1 && mode === 'sheet' && <div className="border-t border-zinc-800 px-4 py-2">
          <div className="flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="Sheet versions">
            {versions.map((version) => {
              const shown = version.url === shownUrl;
              return <button key={version.id} type="button" role="option" aria-selected={shown} onClick={() => setShownUrl(version.url)} className={`relative aspect-video w-32 shrink-0 overflow-hidden border-2 bg-zinc-900 ${shown ? 'border-violet-400' : 'border-transparent hover:border-zinc-600'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- small thumbnail of a stored sheet */}
                <img src={version.url} alt={`${name} ${version.label}`} className="h-full w-full object-cover" />
                <span className={`absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[10px] font-semibold ${version.active ? 'bg-emerald-950/90 text-emerald-300' : 'bg-zinc-950/85 text-zinc-300'}`}>{version.label}{version.active ? ' · in use' : ''}</span>
              </button>;
            })}
          </div>
        </div>}
      </> : <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <LayoutPanelLeft className="h-7 w-7 text-zinc-600" />
        <p className="text-sm font-semibold text-zinc-300">No character sheet yet</p>
        <p className="max-w-sm text-xs leading-relaxed text-zinc-500">{emptyMessage ?? `Generate a character sheet for ${name} to preview the face close-up and turnaround here.`}</p>
      </div>}
    </div>
  </div>;
}
