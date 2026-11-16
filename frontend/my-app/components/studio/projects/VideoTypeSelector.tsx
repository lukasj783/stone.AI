"use client";

import React from "react";
import {
  BookOpen,
  Check,
  Clapperboard,
  Clock3,
  Film,
  List,
  Megaphone,
  Music,
  Sparkles,
} from "lucide-react";
import {
  STUDIO_VIDEO_TYPES,
  type StudioVideoIcon,
  type StudioVideoTypeConfig,
  type StudioVideoTypeId,
} from "@/lib/studioVideoTypes";
import { cn } from "@/lib/utils";

interface VideoTypeSelectorProps {
  value: StudioVideoTypeId;
  onChange: (type: StudioVideoTypeId) => void;
  disabled?: boolean;
  variant?: "cards" | "pills";
  className?: string;
}

const ICONS: Record<StudioVideoIcon, React.ComponentType<{ size?: number; className?: string }>> = {
  film: Film,
  clapperboard: Clapperboard,
  music: Music,
  bookopen: BookOpen,
  megaphone: Megaphone,
};

export function VideoTypeBadge({
  videoType,
  className,
}: {
  videoType: StudioVideoTypeConfig;
  className?: string;
}) {
  const Icon = ICONS[videoType.icon] ?? Film;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-300",
        className
      )}
    >
      <Icon size={11} className="text-violet-400" />
      {videoType.label}
    </span>
  );
}

export function VideoTypeSelector({
  value,
  onChange,
  disabled = false,
  variant = "cards",
  className,
}: VideoTypeSelectorProps) {
  if (variant === "pills") {
    return (
      <div
        role="radiogroup"
        aria-label="Aina ya video"
        className={cn("flex flex-wrap gap-1.5", className)}
      >
        {STUDIO_VIDEO_TYPES.map((type) => {
          const Icon = ICONS[type.icon] ?? Film;
          const isSelected = value === type.id;
          return (
            <button
              key={type.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => onChange(type.id)}
              title={`${type.description} (${type.duration})`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                isSelected
                  ? "border-violet-500 bg-violet-600/20 text-violet-200"
                  : "border-zinc-800 bg-zinc-900/80 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
              )}
            >
              <Icon size={12} className={isSelected ? "text-violet-300" : "text-zinc-500"} />
              <span>{type.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Chagua aina ya video unayotaka kutengeneza"
      className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}
    >
      {STUDIO_VIDEO_TYPES.map((type) => {
        const Icon = ICONS[type.icon] ?? Film;
        const isSelected = value === type.id;

        return (
          <button
            key={type.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => onChange(type.id)}
            className={cn(
              "group relative flex flex-col justify-between rounded-xl border p-4 text-left transition-all bg-gradient-to-br disabled:cursor-not-allowed disabled:opacity-50",
              type.gradient,
              isSelected
                ? "border-violet-500 ring-2 ring-violet-500/30 shadow-lg shadow-violet-950/30"
                : "border-zinc-800/90 hover:border-zinc-700"
            )}
          >
            <div className="space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors",
                      isSelected
                        ? "border-violet-500/60 bg-violet-600 text-white"
                        : "border-zinc-800 bg-zinc-900/80 text-zinc-300 group-hover:border-zinc-700"
                    )}
                  >
                    <Icon size={17} />
                  </span>
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-100">{type.label}</h4>
                    <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
                      <Clock3 size={10} />
                      {type.duration}
                    </span>
                  </div>
                </div>
                {isSelected && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500 text-white">
                    <Check size={12} strokeWidth={3} />
                  </span>
                )}
              </div>
              <p className="text-xs leading-relaxed text-zinc-300">{type.description}</p>
            </div>

            <div className="mt-3 space-y-2 border-t border-white/5 pt-2.5">
              <div className="flex flex-wrap gap-1">
                {type.examples.map((example) => (
                  <span
                    key={example}
                    className="rounded-md bg-black/40 px-2 py-0.5 text-[10px] font-medium text-zinc-300"
                  >
                    {example}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
                {type.requiresOutline ? (
                  <span className="inline-flex items-center gap-1 text-violet-300">
                    <List size={11} />
                    Idea → Outline → Script
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-emerald-300">
                    <Sparkles size={11} />
                    Brief → Script
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default VideoTypeSelector;
