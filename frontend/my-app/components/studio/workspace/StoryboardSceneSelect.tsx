"use client";

import { useEffect, useId, useRef, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import Image from 'next/image';
import { AlertTriangle, Check, ChevronDown, Circle, CircleDashed, Clock, ImageIcon, Loader2 } from 'lucide-react';
import type { StoryboardSceneOption } from '@/lib/storyboardSceneOverview';

/** What is happening to a scene right now, when something is. */
export type SceneActivity = 'queued' | 'generating';

type SceneStatus = SceneActivity | 'done' | 'partial' | 'not-started';

function sceneStatus(scene: StoryboardSceneOption, activity: SceneActivity | undefined): SceneStatus {
  if (activity) return activity;
  if (scene.shotCount === 0) return 'not-started';
  return scene.imageCount >= scene.shotCount ? 'done' : 'partial';
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function sceneDetails(scene: StoryboardSceneOption): string {
  const parts = [
    scene.locationType,
    scene.location,
    scene.timeOfDay,
    formatDuration(scene.durationSeconds),
    scene.shotCount > 0 ? `${scene.shotCount} ${scene.shotCount === 1 ? 'shot' : 'shots'}` : null,
  ];
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(' · ');
}

function sceneTooltip(scene: StoryboardSceneOption): string | undefined {
  const lines = [
    scene.summary?.trim() || null,
    scene.characters.length > 0 ? `Characters: ${scene.characters.join(', ')}` : null,
  ].filter(Boolean);
  return lines.length > 0 ? lines.join('\n') : undefined;
}

const sceneNumberLabel = (scene: StoryboardSceneOption) => String(scene.number).padStart(2, '0');

function StatusBadge({ scene, activity }: { scene: StoryboardSceneOption; activity: SceneActivity | undefined }): JSX.Element {
  const status = sceneStatus(scene, activity);
  const base = 'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold';
  if (status === 'queued') {
    return (
      <span className={`${base} border-sky-500/35 bg-sky-500/10 text-sky-300`}>
        <Clock className="h-3 w-3" aria-hidden />
        Queued
      </span>
    );
  }
  if (status === 'generating') {
    return (
      <span className={`${base} border-violet-500/40 bg-violet-500/15 text-violet-300`}>
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Generating
      </span>
    );
  }
  if (status === 'done') {
    return (
      <span className={`${base} border-emerald-500/35 bg-emerald-500/10 text-emerald-300`}>
        <Check className="h-3 w-3" aria-hidden />
        Done {scene.imageCount}/{scene.shotCount}
      </span>
    );
  }
  if (status === 'partial') {
    return (
      <span className={`${base} border-amber-500/35 bg-amber-500/10 text-amber-300`}>
        <CircleDashed className="h-3 w-3" aria-hidden />
        {scene.imageCount}/{scene.shotCount} images
      </span>
    );
  }
  return (
    <span className={`${base} border-zinc-700 bg-zinc-800/60 text-zinc-400`}>
      <Circle className="h-3 w-3" aria-hidden />
      Not started
    </span>
  );
}

function FailedBadge({ count }: { count: number }): JSX.Element | null {
  if (count <= 0) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-red-500/35 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-300">
      <AlertTriangle className="h-3 w-3" aria-hidden />
      {count} failed
    </span>
  );
}

interface StoryboardSceneSelectProps {
  scenes: StoryboardSceneOption[];
  value: string | null;
  onChange: (sceneId: string) => void;
  disabled?: boolean;
  /** Scenes being generated or waiting their turn, by scene id. */
  sceneActivity?: Record<string, SceneActivity>;
}

const NO_ACTIVITY: Record<string, SceneActivity> = {};

/** Scene picker for the storyboard view: number, name, storyboard status and scene details per row. */
export function StoryboardSceneSelect({
  scenes,
  value,
  onChange,
  disabled = false,
  sceneActivity = NO_ACTIVITY,
}: StoryboardSceneSelectProps): JSX.Element {
  const [openRequested, setOpen] = useState(false);
  // The list is never shown while the picker is locked (for example during generation).
  const open = openRequested && !disabled;
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const spacePickedRef = useRef(false);
  const listId = useId();

  const selectedIndex = Math.max(0, scenes.findIndex((scene) => scene.id === value));
  const selected = scenes[selectedIndex] ?? null;
  const doneCount = scenes.filter((scene) => scene.shotCount > 0 && scene.imageCount >= scene.shotCount).length;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${highlighted}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, highlighted]);

  const openList = () => {
    if (disabled || scenes.length === 0) return;
    setHighlighted(selectedIndex);
    setOpen(true);
  };

  const choose = (index: number) => {
    const scene = scenes[index];
    if (!scene) return;
    setOpen(false);
    triggerRef.current?.focus();
    if (scene.id !== value) onChange(scene.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (disabled) return;
    if (!open) {
      // Enter and Space open the list through the button's own click.
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openList();
      }
      return;
    }
    const last = scenes.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setHighlighted((index) => Math.min(last, index + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setHighlighted((index) => Math.max(0, index - 1));
        break;
      case 'Home':
        event.preventDefault();
        setHighlighted(0);
        break;
      case 'End':
        event.preventDefault();
        setHighlighted(last);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        spacePickedRef.current = event.key === ' ';
        choose(highlighted);
        break;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  return (
    <div
      ref={rootRef}
      className="relative min-w-0"
      onKeyDown={handleKeyDown}
      // Space picks the highlighted scene on key down; stop the button's key-up click from reopening the list.
      onKeyUp={(event) => {
        if (event.key === ' ' && spacePickedRef.current) {
          spacePickedRef.current = false;
          event.preventDefault();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label="Scene"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-option-${highlighted}` : undefined}
        disabled={disabled || scenes.length === 0}
        title={disabled ? 'Wait for the storyboard to finish generating before switching scenes' : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        className="flex min-w-0 max-w-full items-center gap-2.5 rounded-lg border border-zinc-700 bg-zinc-900/90 py-1.5 pl-2 pr-2.5 text-left transition-colors hover:border-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {selected ? (
          <>
            <span className="shrink-0 rounded-md bg-zinc-800 px-1.5 py-0.5 font-mono text-xs font-bold text-zinc-300">
              {sceneNumberLabel(selected)}
            </span>
            <span className="min-w-0 truncate text-base font-bold text-zinc-100">{selected.name}</span>
            <StatusBadge scene={selected} activity={sceneActivity[selected.id]} />
          </>
        ) : (
          <span className="text-base font-bold text-zinc-400">Select a scene</span>
        )}
        <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[34rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl shadow-black/60">
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2 text-[11px] text-zinc-500">
            <span>{scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'}</span>
            <span>{doneCount} of {scenes.length} storyboarded</span>
          </div>
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Scenes"
            className="max-h-[min(26rem,60vh)] overflow-y-auto p-1.5"
            style={{ scrollbarColor: '#3f3f46 transparent', scrollbarWidth: 'thin' }}
          >
            {scenes.map((scene, index) => {
              const isSelected = scene.id === value;
              const isHighlighted = index === highlighted;
              const details = sceneDetails(scene);
              return (
                <li
                  key={scene.id}
                  id={`${listId}-option-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  title={sceneTooltip(scene)}
                  onMouseEnter={() => setHighlighted(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(index)}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors ${
                    isHighlighted ? 'bg-zinc-800/80' : ''
                  } ${isSelected ? 'ring-1 ring-inset ring-violet-500/50' : ''}`}
                >
                  <span className="w-6 shrink-0 text-right font-mono text-xs font-bold text-zinc-500">
                    {sceneNumberLabel(scene)}
                  </span>
                  <span className="relative flex h-9 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-800 bg-zinc-900">
                    {scene.thumbnailUrl ? (
                      <Image src={scene.thumbnailUrl} alt="" fill sizes="64px" className="object-cover" unoptimized />
                    ) : (
                      <ImageIcon className="h-4 w-4 text-zinc-700" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={`truncate text-sm font-semibold ${isSelected ? 'text-violet-200' : 'text-zinc-100'}`}>
                        {scene.name}
                      </span>
                    </span>
                    {details && <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{details}</span>}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge scene={scene} activity={sceneActivity[scene.id]} />
                    <FailedBadge count={scene.failedCount} />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
