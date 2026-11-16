"use client";

import React, { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import {
  DEFAULT_STUDIO_VIDEO_TYPE,
  getVideoTypeConfig,
  type StudioVideoTypeId,
} from "@/lib/studioVideoTypes";
import { VideoTypeSelector } from "@/components/studio/projects/VideoTypeSelector";
import { cn } from "@/lib/utils";

interface NewProjectFormProps {
  /** Shared create handler used by the dropdown, the gallery card and the empty state. */
  onCreate: (name: string, videoType: StudioVideoTypeId) => Promise<void> | void;
  isSubmitting?: boolean;
  variant?: "inline" | "card" | "wizard";
  placeholder?: string;
  className?: string;
}

export function NewProjectForm({
  onCreate,
  isSubmitting = false,
  variant = "inline",
  placeholder,
  className,
}: NewProjectFormProps) {
  const [name, setName] = useState("");
  const [videoType, setVideoType] = useState<StudioVideoTypeId>(DEFAULT_STUDIO_VIDEO_TYPE);
  const trimmedName = name.trim();
  const isDisabled = isSubmitting || trimmedName.length === 0;
  const activeTypeConfig = getVideoTypeConfig(videoType);
  const resolvedPlaceholder =
    placeholder ?? `Jina la ${activeTypeConfig.label.toLowerCase()}...`;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isDisabled) return;

    await onCreate(trimmedName, videoType);
    setName("");
  };

  const input = (
    <input
      type="text"
      value={name}
      onChange={(event) => setName(event.target.value)}
      placeholder={resolvedPlaceholder}
      aria-label="New project title"
      disabled={isSubmitting}
      className={cn(
        "min-w-0 flex-1 rounded-lg border border-zinc-800 bg-[#0A0A0B] px-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors focus:border-violet-500 disabled:opacity-60",
        variant === "inline" ? "h-9" : "h-11"
      )}
    />
  );

  const button = (
    <button
      type="submit"
      disabled={isDisabled}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-violet-600 font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50",
        variant === "inline" ? "h-9 px-3 text-xs" : "h-11 px-5 text-sm"
      )}
    >
      {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
      {isSubmitting ? "Creating..." : `Create ${activeTypeConfig.label}`}
    </button>
  );

  if (variant === "wizard") {
    return (
      <form onSubmit={handleSubmit} className={cn("space-y-5", className)}>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
              1. Chagua Aina ya Video
            </h3>
            <span className="text-xs text-zinc-500">
              {activeTypeConfig.requiresOutline
                ? "Inajumuisha Story Outline kabla ya Script"
                : "Maelezo (Brief) yanageuka moja kwa moja kuwa Script"}
            </span>
          </div>
          <VideoTypeSelector
            value={videoType}
            onChange={setVideoType}
            disabled={isSubmitting}
            variant="cards"
          />
        </div>

        <div className="space-y-2 pt-1">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            2. Weka Jina la Project ({activeTypeConfig.label})
          </h3>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {input}
            {button}
          </div>
        </div>
      </form>
    );
  }

  if (variant === "card") {
    return (
      <form onSubmit={handleSubmit} className={cn("space-y-3", className)}>
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Create new video project</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Chagua aina ya video na jina la project ili uanze kuweka maelezo yake.
          </p>
        </div>
        <VideoTypeSelector
          value={videoType}
          onChange={setVideoType}
          disabled={isSubmitting}
          variant="pills"
        />
        <div className="flex items-center gap-2">
          {input}
          {button}
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-2", className)}>
      <VideoTypeSelector
        value={videoType}
        onChange={setVideoType}
        disabled={isSubmitting}
        variant="pills"
      />
      <div className="flex items-center gap-2">
        {input}
        {button}
      </div>
    </form>
  );
}

export default NewProjectForm;
