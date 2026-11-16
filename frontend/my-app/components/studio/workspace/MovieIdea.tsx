"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { BadgePlus, BookOpen, Check, Clock3, Info, Palette, Sparkles, UserPlus, WandSparkles } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import {
  DEFAULT_STUDIO_VIDEO_TYPE,
  getVideoTypeConfig,
  resolveVideoType,
  type StudioVideoTypeConfig,
  type StudioVideoTypeId,
} from "@/lib/studioVideoTypes";
import AlertModal from '@/components/ui/AlertModal';

interface MovieIdeaProps {
  projectId: string | null;
  /** Video type of the active project — decides Idea (films) vs Brief (others). */
  videoType?: StudioVideoTypeId | string | null;
  /** Display name of the active project, shown in the page header. */
  projectName?: string | null;
  onNavigateToCharacters?: () => void;
  onNavigateToOutline?: () => void;
  onNavigateToScript?: () => void;
}

interface IdeaCharacter {
  id: string;
  name: string;
  role: string;
  archetype: string;
  summary: string;
  traits: string[];
  imageUrl: string | null;
}

type VisualStyle = "Realistic" | "3D Pixel" | "Cartoon";

interface IdeaFormState {
  projectType: string;
  duration: string;
  genres: string[];
  logline: string;
  premise: string;
  endingType: "Bittersweet" | "Positive" | "Cliffhanger" | "Ambiguous";
  visualStyle: VisualStyle;
}

const VISUAL_STYLES: { label: VisualStyle; emoji: string; gradient: string }[] = [
  { label: "Realistic", emoji: "🎬", gradient: "from-amber-900/40 via-orange-950/30 to-yellow-950/20" },
  { label: "3D Pixel", emoji: "🧊", gradient: "from-cyan-900/40 via-teal-950/30 to-emerald-950/20" },
  { label: "Cartoon", emoji: "🎨", gradient: "from-yellow-700/40 via-lime-950/30 to-green-950/20" },
];

/**
 * Older projects stored one of the previous 11 style labels. Map them onto the
 * three supported styles so loading an idea never leaves the picker empty.
 */
const LEGACY_VISUAL_STYLE_ALIASES: Record<string, VisualStyle> = {
  "Realistic Cinematic": "Realistic",
  "Hyper-Realistic": "Realistic",
  "Digital Painting": "Realistic",
  "Oil Painting": "Realistic",
  "Watercolor": "Realistic",
  "Graphic Novel": "Realistic",
  "Hand-Drawn Illustration": "Realistic",
  "Stylized 3D": "3D Pixel",
  "Pixar-like": "3D Pixel",
  Anime: "Cartoon",
};

function normalizeVisualStyle(value: unknown): VisualStyle {
  if (typeof value !== "string") return "Realistic";
  if (VISUAL_STYLES.some((style) => style.label === value)) return value as VisualStyle;
  return LEGACY_VISUAL_STYLE_ALIASES[value] ?? "Realistic";
}


interface CreativeBriefState {
  concept: string;
  keyMoments: string[];
  targetAudience: string;
  references: string;
}

const DEFAULT_BRIEF: CreativeBriefState = {
  concept: "",
  keyMoments: [],
  targetAudience: "",
  references: "",
};

/** Seed the form from the active video type instead of always assuming a film. */
function buildDefaultIdea(config: StudioVideoTypeConfig): IdeaFormState {
  return {
    projectType: config.formatOptions[0] ?? config.label,
    duration: config.defaultDuration,
    genres: [...config.defaultGenres],
    logline: "",
    premise: "",
    endingType: "Bittersweet",
    visualStyle: "Realistic",
  };
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function MovieIdea({
  projectId,
  videoType,
  projectName,
  onNavigateToCharacters,
  onNavigateToOutline,
  onNavigateToScript,
}: MovieIdeaProps) {
  const videoTypeConfig = getVideoTypeConfig(
    resolveVideoType(videoType ?? DEFAULT_STUDIO_VIDEO_TYPE),
  );
  const isNarrative = videoTypeConfig.requiresOutline;

  const [idea, setIdea] = useState<IdeaFormState>(() => buildDefaultIdea(videoTypeConfig));
  const [brief, setBrief] = useState<CreativeBriefState>(DEFAULT_BRIEF);
  const [characters, setCharacters] = useState<IdeaCharacter[]>([]);
  const [ideaDocumentId, setIdeaDocumentId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Custom Alert / Confirmation state
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    type?: 'info' | 'warning' | 'error' | 'success' | 'confirm';
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm?: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
  });

  const showAlert = (title: string, message: string, type: 'info' | 'warning' | 'error' | 'success' = 'info') => {
    setAlertState({
      isOpen: true,
      type,
      title,
      message,
    });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void, confirmLabel = 'Confirm') => {
    setAlertState({
      isOpen: true,
      type: 'confirm',
      title,
      message,
      confirmLabel,
      onConfirm,
    });
  };

  const secondaryCast = useMemo(() => Math.max(characters.length - 1, 0), [characters.length]);

  useEffect(() => {
    if (!projectId) return;

    const timer = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const { data: docData, error: docError } = await supabase
          .from("project_documents")
          .select("id, content, metadata")
          .eq("project_id", projectId)
          .eq("type", "idea")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (docError) throw docError;

        const defaults = buildDefaultIdea(videoTypeConfig);

        if (docData) {
          setIdeaDocumentId(docData.id as string);
          const metadata = (docData.metadata as Record<string, unknown> | null) ?? {};
          // Stored movie defaults should not leak into a brief of another type.
          const storedVideoType =
            typeof metadata.videoType === "string" ? resolveVideoType(metadata.videoType) : null;
          const sameType = !storedVideoType || storedVideoType === videoTypeConfig.id;

          setIdea({
            projectType:
              sameType && typeof metadata.projectType === "string"
                ? metadata.projectType
                : defaults.projectType,
            duration:
              sameType && typeof metadata.duration === "string"
                ? metadata.duration
                : defaults.duration,
            genres:
              sameType && Array.isArray(metadata.genres)
                ? (metadata.genres as string[])
                : defaults.genres,
            logline: typeof metadata.logline === "string" ? metadata.logline : "",
            premise: docData.content || (typeof metadata.premise === "string" ? metadata.premise : ""),
            endingType: (metadata.endingType as IdeaFormState["endingType"]) || defaults.endingType,
            visualStyle: normalizeVisualStyle(metadata.visualStyle),
          });

          const storedBrief = (metadata.brief as Partial<CreativeBriefState> | undefined) ?? {};
          setBrief({
            concept: typeof storedBrief.concept === "string" ? storedBrief.concept : "",
            keyMoments: Array.isArray(storedBrief.keyMoments) ? storedBrief.keyMoments : [],
            targetAudience:
              typeof storedBrief.targetAudience === "string" ? storedBrief.targetAudience : "",
            references: typeof storedBrief.references === "string" ? storedBrief.references : "",
          });
        } else {
          setIdea(defaults);
          setBrief(DEFAULT_BRIEF);
          setIdeaDocumentId(null);
        }

        const { data: charsData, error: charsError } = await supabase
          .from("characters")
          .select("id, name, role, appearance, personality, tags, primary_asset_id")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false });

        if (charsError) throw charsError;

        const assetIds = (charsData ?? []).map(c => c.primary_asset_id).filter(Boolean);
        const assetMap = new Map<string, string>();
        
        if (assetIds.length > 0) {
          const { data: assetsData } = await supabase
            .from('assets')
            .select('id, url')
            .in('id', assetIds);
          
          (assetsData || []).forEach(a => assetMap.set(a.id, a.url));
        }

        const mapped = ((charsData ?? []) as Array<Record<string, unknown>>).map((c) => ({
          id: String(c.id),
          name: String(c.name ?? "Untitled Character"),
          role: String(c.role ?? "Character"),
          archetype: String(c.appearance ?? "Unknown Archetype"),
          summary: String(c.personality ?? ""),
          traits: Array.isArray(c.tags) ? (c.tags as string[]) : [],
          imageUrl: c.primary_asset_id ? assetMap.get(c.primary_asset_id as string) ?? null : null,
        }));
        setCharacters(mapped);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load project idea data.");
      } finally {
        setIsLoading(false);
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [projectId, videoTypeConfig, videoTypeConfig.id]);

  const saveIdea = async () => {
    if (!projectId) return;

    setMessage(null);
    const payload = {
      project_id: projectId,
      type: "idea",
      title: isNarrative ? "Movie Idea" : `${videoTypeConfig.label} Brief`,
      content: isNarrative ? idea.premise : brief.concept || idea.premise,
      metadata: {
        videoType: videoTypeConfig.id,
        projectType: idea.projectType,
        duration: idea.duration,
        genres: idea.genres,
        logline: idea.logline,
        premise: idea.premise,
        endingType: idea.endingType,
        visualStyle: idea.visualStyle,
        brief,
      },
    };

    const query = ideaDocumentId
      ? supabase.from("project_documents").update(payload).eq("id", ideaDocumentId).select("id").single()
      : supabase.from("project_documents").insert(payload).select("id").single();

    const { data, error: saveError } = await query;
    if (saveError) throw saveError;
    if (data?.id) setIdeaDocumentId(data.id as string);

    // Keep projects.settings in sync so the video type survives a reload even
    // for projects created before settings carried a video type.
    const { error: settingsError } = await supabase
      .from("projects")
      .update({ settings: { app: "studio", videoType: videoTypeConfig.id } })
      .eq("id", projectId);
    if (settingsError) {
      console.warn("Could not persist project video type:", settingsError.message);
    }

    setMessage(isNarrative ? "Idea saved successfully." : "Brief saved successfully.");
  };

  const clearIdea = async () => {
    if (!projectId) return;

    const ideaLabel = isNarrative ? "Movie Idea" : `${videoTypeConfig.label} Brief`;

    showConfirm(
      `Reset ${ideaLabel}`,
      `Are you sure you want to delete and reset your ${ideaLabel}? This will permanently erase the saved ${isNarrative ? "premise and logline" : "concept and key moments"}.`,
      async () => {
        setIsClearing(true);
        setError(null);
        setMessage(null);

        try {
          if (ideaDocumentId) {
            const { error: deleteError } = await supabase
              .from("project_documents")
              .delete()
              .eq("id", ideaDocumentId);

            if (deleteError) throw deleteError;
          } else {
            // Fallback: Delete any matching "idea" document for this project
            const { error: deleteError } = await supabase
              .from("project_documents")
              .delete()
              .eq("project_id", projectId)
              .eq("type", "idea");

            if (deleteError) throw deleteError;
          }

          setIdea(buildDefaultIdea(videoTypeConfig));
          setBrief(DEFAULT_BRIEF);
          setIdeaDocumentId(null);
          showAlert(`Reset ${ideaLabel}`, `Your ${ideaLabel} has been cleared and reset successfully.`, "success");
        } catch (e) {
          showAlert("Error", e instanceof Error ? e.message : "Failed to delete idea.", "error");
        } finally {
          setIsClearing(false);
        }
      },
      "Reset Idea"
    );
  };

  const generateOutline = async () => {
    if (!projectId) return;

    setIsGenerating(true);
    setError(null);
    setMessage(null);

    try {
      await saveIdea();

      const response = await fetch(`${API_URL}/api/story/generate-outline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          basics: {
            projectType: idea.projectType,
            duration: idea.duration,
            genres: idea.genres,
            endingType: idea.endingType,
            visualStyle: idea.visualStyle,
          },
          story: {
            logline: idea.logline,
            premise: idea.premise,
          },
          characters: characters.map((c) => ({
            name: c.name,
            role: c.role,
            archetype: c.archetype,
            personality: c.summary,
            tags: c.traits,
          })),
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.detail || "Failed to generate outline.");
      }

      const outlineText = String(payload.outline || "");
      const outlinePayload = {
        project_id: projectId,
        type: "outline",
        title: "Generated Outline",
        content: outlineText,
        metadata: {
          source: "gemini-2.5-flash",
          generatedAt: new Date().toISOString(),
        },
      };

      const { data: existingOutline, error: findOutlineError } = await supabase
        .from("project_documents")
        .select("id")
        .eq("project_id", projectId)
        .eq("type", "outline")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (findOutlineError) throw findOutlineError;

      const outlineQuery = existingOutline?.id
        ? supabase.from("project_documents").update(outlinePayload).eq("id", existingOutline.id)
        : supabase.from("project_documents").insert(outlinePayload);

      const { error: outlineError } = await outlineQuery;
      if (outlineError) throw outlineError;
      setMessage("Outline generated and saved successfully.");
      onNavigateToOutline?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Outline generation failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const generateScript = async () => {
    if (!projectId) return;

    setIsGenerating(true);
    setError(null);
    setMessage(null);

    try {
      await saveIdea();

      const response = await fetch(`${API_URL}/api/story/generate-script`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          video_type: videoTypeConfig.id,
          outline: "",
          brief: {
            concept: brief.concept || idea.premise,
            keyMoments: brief.keyMoments,
            targetAudience: brief.targetAudience,
            references: brief.references,
            duration: idea.duration,
            visualStyle: idea.visualStyle,
          },
          basics: {
            projectType: videoTypeConfig.label,
            duration: idea.duration,
            genres: idea.genres,
            endingType: idea.endingType,
            visualStyle: idea.visualStyle,
          },
          characters: characters.map((c) => ({
            name: c.name,
            role: c.role,
            archetype: c.archetype,
            personality: c.summary,
            tags: c.traits,
          })),
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.detail || "Failed to generate script.");
      }

      setMessage(`${videoTypeConfig.label} script generation started. Opening the script...`);
      onNavigateToScript?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Script generation failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleKeyMoment = (value: string) => {
    if (!value.trim()) return;
    setBrief((s) =>
      s.keyMoments.includes(value)
        ? { ...s, keyMoments: s.keyMoments.filter((moment) => moment !== value) }
        : { ...s, keyMoments: [...s.keyMoments, value] },
    );
  };

  return (
    <div className="h-full overflow-y-auto bg-[#0A0A0B] px-5 py-6 text-zinc-100 lg:px-8">
      <div className="mx-auto w-full max-w-7xl space-y-8 pb-8">
        {/* Header */}
        <section className="flex flex-col gap-4 border-b border-zinc-800 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-violet-400">
              <BookOpen className="h-4 w-4" />
              {isNarrative ? "Movie Idea" : `${videoTypeConfig.label} Brief`}
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
              {isLoading
                ? "Loading..."
                : projectName?.trim() || (isNarrative ? "Movie Idea" : videoTypeConfig.label)}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              {isNarrative
                ? "Shape premise and cast, then generate your outline."
                : "Jaza maelezo mafupi (brief) kisha tengeneza script moja kwa moja — hakuna hatua ya outline."}
            </p>
          </div>
          <div className="flex gap-2">
            {ideaDocumentId && (
              <button
                type="button"
                onClick={clearIdea}
                disabled={isClearing}
                className="inline-flex h-10 items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 px-5 text-sm font-semibold text-rose-400 disabled:opacity-50"
              >
                {isClearing ? "Clearing..." : isNarrative ? "Delete Idea" : "Delete Brief"}
              </button>
            )}
            <button
              type="button"
              onClick={saveIdea}
              className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-700 px-5 text-sm font-semibold text-zinc-200 hover:bg-zinc-900"
            >
              {isNarrative ? "Save Idea" : "Save Brief"}
            </button>
            <button
              type="button"
              onClick={isNarrative ? generateOutline : generateScript}
              disabled={!projectId || isGenerating}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-violet-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-violet-400 disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" />
              {isGenerating ? "Generating..." : videoTypeConfig.primaryAction}
            </button>
          </div>
        </section>

        {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
        {message && <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</div>}

        {/* Basics */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {isNarrative ? (
            <Panel>
              <FieldLabel icon={Info}>Format</FieldLabel>
              <select
                aria-label="Project format"
                className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm"
                value={idea.projectType}
                onChange={(e) => setIdea((s) => ({ ...s, projectType: e.target.value }))}
              >
                {videoTypeConfig.formatOptions.map((format) => (
                  <option key={format} value={format}>{format}</option>
                ))}
              </select>
            </Panel>
          ) : (
            <Panel>
              <FieldLabel icon={Info}>Project Type</FieldLabel>
              <div className="flex h-10 w-full items-center rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 text-sm text-zinc-300">
                {videoTypeConfig.label}
              </div>
            </Panel>
          )}

          <Panel>
            <FieldLabel icon={Clock3}>Duration</FieldLabel>
            <input
              aria-label="Estimated duration"
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm"
              value={idea.duration}
              onChange={(e) => setIdea((s) => ({ ...s, duration: e.target.value }))}
            />
          </Panel>

          <Panel>
            <FieldLabel>{isNarrative ? "Genres" : "Category / Genres"}</FieldLabel>
            <input
              aria-label="Genres"
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm"
              placeholder={videoTypeConfig.examples.join(", ")}
              value={idea.genres.join(", ")}
              onChange={(e) =>
                setIdea((s) => ({
                  ...s,
                  genres: e.target.value.split(",").map((genre) => genre.trim()).filter(Boolean),
                }))
              }
            />
          </Panel>

          {isNarrative && (
            <Panel>
              <FieldLabel>Ending Type</FieldLabel>
              <select
                aria-label="Ending type"
                className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm"
                value={idea.endingType}
                onChange={(e) => setIdea((s) => ({ ...s, endingType: e.target.value as IdeaFormState["endingType"] }))}
              >
                <option value="Bittersweet">Bittersweet</option>
                <option value="Positive">Positive</option>
                <option value="Cliffhanger">Cliffhanger</option>
                <option value="Ambiguous">Ambiguous</option>
              </select>
            </Panel>
          )}
        </section>

        {/* Creative Direction: Visual Style */}
        <section className="space-y-4">
          <div>
            <SectionTitle icon={Palette} title="Visual Style" />
            <p className="text-xs text-zinc-500 mt-1">Choose the look and feel for your project&apos;s visuals.</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {VISUAL_STYLES.map((style) => {
              const isSelected = idea.visualStyle === style.label;
              return (
                <motion.button
                  key={style.label}
                  type="button"
                  onClick={() => setIdea((s) => ({ ...s, visualStyle: style.label }))}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.98 }}
                  className={cn(
                    "group relative flex h-32 flex-col items-center justify-center overflow-hidden rounded-xl border-2 p-4 transition-colors duration-200",
                    isSelected
                      ? "border-violet-500 shadow-[0_0_20px_rgba(139,92,246,0.3)]"
                      : "border-zinc-800 hover:border-zinc-600 bg-zinc-900/50"
                  )}
                >
                  {/* Gradient Background */}
                  <div className={cn("absolute inset-0 bg-linear-to-br opacity-60 transition-opacity", style.gradient, isSelected ? "opacity-90" : "group-hover:opacity-80")} />
                  
                  {/* Selected Checkmark */}
                  {isSelected && (
                    <motion.div 
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-violet-500 text-white shadow-lg"
                    >
                      <Check className="h-3 w-3" />
                    </motion.div>
                  )}

                  {/* Content */}
                  <span className="relative text-3xl mb-3 drop-shadow-md">{style.emoji}</span>
                  <span className={cn("relative text-xs font-semibold text-center leading-tight tracking-wide", isSelected ? "text-white drop-shadow-md" : "text-zinc-400 group-hover:text-zinc-200")}>
                    {style.label}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </section>

        {/* Story Foundation / Creative Brief */}
        <section className="space-y-4">
          <SectionTitle
            icon={WandSparkles}
            title={isNarrative ? "Story Foundation" : "Creative Brief"}
          />
          {isNarrative ? (
            <>
              <Panel>
                <FieldLabel>Logline</FieldLabel>
                <textarea
                  aria-label="Logline"
                  rows={2}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm"
                  value={idea.logline}
                  onChange={(e) => setIdea((s) => ({ ...s, logline: e.target.value }))}
                />
              </Panel>
              <Panel>
                <FieldLabel>Premise</FieldLabel>
                <textarea
                  aria-label="Premise"
                  rows={6}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm"
                  value={idea.premise}
                  onChange={(e) => setIdea((s) => ({ ...s, premise: e.target.value }))}
                />
              </Panel>
            </>
          ) : (
            <>
              <Panel>
                <FieldLabel>Concept / Wazo Kuu</FieldLabel>
                <textarea
                  aria-label="Concept"
                  rows={5}
                  placeholder={`Eleza wazo la ${videoTypeConfig.label.toLowerCase()} kwa ufupi...`}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm"
                  value={brief.concept}
                  onChange={(e) => setBrief((s) => ({ ...s, concept: e.target.value }))}
                />
              </Panel>
              <Panel>
                <FieldLabel>Key Moments (kila mstari ni wazo moja)</FieldLabel>
                <textarea
                  aria-label="Key moments"
                  rows={5}
                  placeholder={"Hook ya kwanza\nKilele cha kati\nKufunga kwa kuvutia"}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm"
                  value={brief.keyMoments.join("\n")}
                  onChange={(e) =>
                    setBrief((s) => ({
                      ...s,
                      keyMoments: e.target.value.split("\n").filter((line) => line.trim().length > 0),
                    }))
                  }
                />
                {brief.keyMoments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {brief.keyMoments.map((moment) => (
                      <button
                        key={moment}
                        type="button"
                        onClick={() => toggleKeyMoment(moment)}
                        className="inline-flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-[11px] text-violet-200"
                      >
                        {moment}
                      </button>
                    ))}
                  </div>
                )}
              </Panel>
              <Panel>
                <FieldLabel>Target Audience</FieldLabel>
                <input
                  aria-label="Target audience"
                  className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm"
                  placeholder="Mfano: vijana wa 18–30, wapenzi wa muziki"
                  value={brief.targetAudience}
                  onChange={(e) => setBrief((s) => ({ ...s, targetAudience: e.target.value }))}
                />
              </Panel>
              <Panel>
                <FieldLabel>References / Marejeo</FieldLabel>
                <textarea
                  aria-label="References"
                  rows={3}
                  placeholder="Video au brand zinazofanana na unachotaka kufikia"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm"
                  value={brief.references}
                  onChange={(e) => setBrief((s) => ({ ...s, references: e.target.value }))}
                />
              </Panel>
            </>
          )}
        </section>

        {/* Characters / Cast */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <SectionTitle icon={UserPlus} title={isNarrative ? "Main Characters" : "Cast / Talent"} />
            <button
              type="button"
              onClick={() => onNavigateToCharacters?.()}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 text-sm font-medium text-violet-300"
            >
              <BadgePlus className="h-4 w-4" />
              Manage in Characters Page
            </button>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {characters.map((character) => (
              <div key={character.id} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                <div className="relative h-44 bg-zinc-950">
                  {character.imageUrl ? (
                    <Image src={character.imageUrl} alt={character.name} fill className="object-cover opacity-80" sizes="(max-width: 768px) 100vw, 33vw" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-zinc-600">No image</div>
                  )}
                </div>
                <div className="space-y-2 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{character.name}</h3>
                    <span className={cn("rounded-full px-2 py-1 text-[10px] font-bold uppercase", "bg-violet-500/10 text-violet-300")}>{character.role}</span>
                  </div>
                  <p className="text-xs text-zinc-500">{character.archetype}</p>
                  <p className="line-clamp-2 text-sm italic text-zinc-400">{character.summary}</p>
                </div>
              </div>
            ))}
          </div>
          {!characters.length && (
            <p className="text-sm text-zinc-500">
              {isNarrative
                ? "No characters yet. Add them from the Characters page."
                : "No cast or talent yet. Add them from the Characters page."}
            </p>
          )}
        </section>

        {/* Outline Readiness */}
        <aside className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
            {isNarrative ? "Outline Readiness" : "Script Readiness"}
          </h2>
          <ul className="space-y-2 text-sm text-zinc-300">
            <li>• Type: {videoTypeConfig.label} / {idea.duration}</li>
            <li>• Visual Style: {idea.visualStyle}</li>
            {isNarrative ? (
              <li>• Logline: {idea.logline.trim() ? "Provided" : "Missing"}</li>
            ) : (
              <>
                <li>• Concept: {brief.concept.trim() ? "Provided" : "Missing"}</li>
                <li>• Key moments: {brief.keyMoments.length}</li>
                <li>• Target audience: {brief.targetAudience.trim() ? "Provided" : "Missing"}</li>
              </>
            )}
            <li>• Cast: {characters.length} ({secondaryCast} secondary)</li>
          </ul>
        </aside>
      </div>

      <AlertModal
        isOpen={alertState.isOpen}
        type={alertState.type}
        title={alertState.title}
        message={alertState.message}
        confirmLabel={alertState.confirmLabel}
        cancelLabel={alertState.cancelLabel}
        onConfirm={alertState.onConfirm}
        onClose={() => setAlertState((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: React.ElementType<{ className?: string }>; title: string }) {
  return (
    <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
      <Icon className="h-5 w-5 text-violet-400" />
      {title}
    </h2>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">{children}</div>;
}

function FieldLabel({ children, icon: Icon }: { children: React.ReactNode; icon?: React.ElementType<{ className?: string }> }) {
  return (
    <label className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </label>
  );
}