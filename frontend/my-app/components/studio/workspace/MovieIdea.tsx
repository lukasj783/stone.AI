"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import Image from "next/image";
import { BadgePlus, BookOpen, Check, Clock3, Info, Palette, Sparkles, UserPlus, WandSparkles, ChevronLeft, ChevronRight, Play, Pause } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import AlertModal from '@/components/ui/AlertModal';

interface MovieIdeaProps {
  projectId: string | null;
  onNavigateToCharacters?: () => void;
  onNavigateToOutline?: () => void;
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

type VisualStyle =
  | "Realistic Cinematic"
  | "Hyper-Realistic"
  | "Stylized 3D"
  | "Pixar-like"
  | "Anime"
  | "Cartoon"
  | "Graphic Novel"
  | "Hand-Drawn Illustration"
  | "Digital Painting"
  | "Watercolor"
  | "Oil Painting";

interface IdeaFormState {
  projectType: "Feature Film" | "Short" | "Series";
  duration: string;
  genres: string[];
  logline: string;
  premise: string;
  themeTone: string[];
  endingType: "Bittersweet" | "Positive" | "Cliffhanger" | "Ambiguous";
  visualStyle: VisualStyle;
}

const VISUAL_STYLES: { label: VisualStyle; emoji: string; gradient: string }[] = [
  { label: "Realistic Cinematic", emoji: "🎬", gradient: "from-amber-900/40 via-orange-950/30 to-yellow-950/20" },
  { label: "Hyper-Realistic", emoji: "🔍", gradient: "from-slate-800/40 via-zinc-900/30 to-neutral-950/20" },
  { label: "Stylized 3D", emoji: "💎", gradient: "from-cyan-900/40 via-teal-950/30 to-emerald-950/20" },
  { label: "Pixar-like", emoji: "🧸", gradient: "from-sky-800/40 via-blue-950/30 to-indigo-950/20" },
  { label: "Anime", emoji: "⚡", gradient: "from-pink-800/40 via-rose-950/30 to-fuchsia-950/20" },
  { label: "Cartoon", emoji: "🎨", gradient: "from-yellow-700/40 via-lime-950/30 to-green-950/20" },
  { label: "Graphic Novel", emoji: "💥", gradient: "from-red-900/40 via-orange-950/30 to-amber-950/20" },
  { label: "Hand-Drawn Illustration", emoji: "✏️", gradient: "from-stone-700/40 via-amber-950/30 to-orange-950/20" },
  { label: "Digital Painting", emoji: "🖥️", gradient: "from-violet-900/40 via-purple-950/30 to-fuchsia-950/20" },
  { label: "Watercolor", emoji: "💧", gradient: "from-sky-700/40 via-cyan-950/30 to-teal-950/20" },
  { label: "Oil Painting", emoji: "🖌️", gradient: "from-amber-800/40 via-yellow-950/30 to-orange-950/20" },
];

const TONE_OPTIONS: { label: string; color: string; bg: string; border: string }[] = [
  { label: "Dark", color: "text-purple-300", bg: "bg-purple-500/20", border: "border-purple-500/50" },
  { label: "Humorous", color: "text-yellow-300", bg: "bg-yellow-500/20", border: "border-yellow-500/50" },
  { label: "Suspenseful", color: "text-red-300", bg: "bg-red-500/20", border: "border-red-500/50" },
  { label: "Romantic", color: "text-pink-300", bg: "bg-pink-500/20", border: "border-pink-500/50" },
  { label: "Melancholic", color: "text-blue-300", bg: "bg-blue-500/20", border: "border-blue-500/50" },
  { label: "Gritty", color: "text-stone-300", bg: "bg-stone-500/20", border: "border-stone-500/50" },
  { label: "Whimsical", color: "text-emerald-300", bg: "bg-emerald-500/20", border: "border-emerald-500/50" },
  { label: "Uplifting", color: "text-amber-300", bg: "bg-amber-500/20", border: "border-amber-500/50" },
  { label: "Mysterious", color: "text-indigo-300", bg: "bg-indigo-500/20", border: "border-indigo-500/50" },
  { label: "Epic", color: "text-orange-300", bg: "bg-orange-500/20", border: "border-orange-500/50" },
  { label: "Cyberpunk", color: "text-fuchsia-300", bg: "bg-fuchsia-500/20", border: "border-fuchsia-500/50" },
  { label: "Dystopian", color: "text-zinc-300", bg: "bg-zinc-500/20", border: "border-zinc-500/50" },
  { label: "Noir", color: "text-neutral-300", bg: "bg-neutral-500/20", border: "border-neutral-500/50" },
  { label: "Surreal", color: "text-violet-300", bg: "bg-violet-500/20", border: "border-violet-500/50" },
  { label: "Nostalgic", color: "text-rose-300", bg: "bg-rose-500/20", border: "border-rose-500/50" },
];

const DEFAULT_IDEA: IdeaFormState = {
  projectType: "Feature Film",
  duration: "120 min",
  genres: ["Sci-Fi", "Thriller"],
  logline: "",
  premise: "",
  themeTone: ["Cyberpunk", "Melancholic"],
  endingType: "Bittersweet",
  visualStyle: "Realistic Cinematic",
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function MovieIdea({ projectId, onNavigateToCharacters, onNavigateToOutline }: MovieIdeaProps) {
  const [idea, setIdea] = useState<IdeaFormState>(DEFAULT_IDEA);
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

  // States for Carousel Autoplay & Navigation Controls
  const [isAutoplay, setIsAutoplay] = useState(true);
  const carouselRef = useRef<HTMLDivElement>(null);

  const secondaryCast = useMemo(() => Math.max(characters.length - 1, 0), [characters.length]);

  // Autoplay effect for Visual Style Carousel
  useEffect(() => {
    if (!isAutoplay) return;

    const interval = setInterval(() => {
      if (!carouselRef.current) return;

      const container = carouselRef.current;
      const currentScroll = container.scrollLeft;
      const selectButton = container.querySelector('button');
      if (!selectButton) return;
      const itemWidth = selectButton.getBoundingClientRect().width + 16; // 16px gap
      const maxScroll = container.scrollWidth - container.clientWidth;

      if (currentScroll >= maxScroll - 5) {
        // Scroll back to start
        container.scrollTo({ left: 0, behavior: "smooth" });
      } else {
        // Scroll forward
        container.scrollTo({ left: currentScroll + itemWidth, behavior: "smooth" });
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isAutoplay]);

  const scrollCarousel = (direction: "forward" | "backward") => {
    if (!carouselRef.current) return;
    setIsAutoplay(false); // Stop autoplay when user manually navigates

    const container = carouselRef.current;
    const selectButton = container.querySelector('button');
    if (!selectButton) return;
    const itemWidth = selectButton.getBoundingClientRect().width + 16;
    const currentScroll = container.scrollLeft;

    if (direction === "forward") {
      container.scrollTo({
        left: currentScroll + itemWidth,
        behavior: "smooth"
      });
    } else {
      container.scrollTo({
        left: currentScroll - itemWidth,
        behavior: "smooth"
      });
    }
  };

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

        if (docData) {
          setIdeaDocumentId(docData.id as string);
          const metadata = (docData.metadata as Record<string, unknown> | null) ?? {};
          setIdea({
            projectType: (metadata.projectType as IdeaFormState["projectType"]) || "Feature Film",
            duration: (metadata.duration as string) || "120 min",
            genres: (metadata.genres as string[]) || ["Sci-Fi", "Thriller"],
            logline: (metadata.logline as string) || "",
            premise: docData.content || (metadata.premise as string) || "",
            themeTone: (metadata.themeTone as string[]) || ["Cyberpunk", "Melancholic"],
            endingType: (metadata.endingType as IdeaFormState["endingType"]) || "Bittersweet",
            visualStyle: (metadata.visualStyle as VisualStyle) || "Realistic Cinematic",
          });
        } else {
          setIdea(DEFAULT_IDEA);
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
        setError(e instanceof Error ? e.message : "Failed to load movie idea data.");
      } finally {
        setIsLoading(false);
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [projectId]);

  const saveIdea = async () => {
    if (!projectId) return;

    setMessage(null);
    const payload = {
      project_id: projectId,
      type: "idea",
      title: "Movie Idea",
      content: idea.premise,
      metadata: {
        projectType: idea.projectType,
        duration: idea.duration,
        genres: idea.genres,
        logline: idea.logline,
        premise: idea.premise,
        themeTone: idea.themeTone,
        endingType: idea.endingType,
        visualStyle: idea.visualStyle,
      },
    };

    const query = ideaDocumentId
      ? supabase.from("project_documents").update(payload).eq("id", ideaDocumentId).select("id").single()
      : supabase.from("project_documents").insert(payload).select("id").single();

    const { data, error: saveError } = await query;
    if (saveError) throw saveError;
    if (data?.id) setIdeaDocumentId(data.id as string);
    setMessage("Idea saved successfully.");
  };

  const clearIdea = async () => {
    if (!projectId) return;

    showConfirm(
      "Reset Movie Idea",
      "Are you sure you want to delete and reset your Movie Idea? This will permanently erase the premise and logline.",
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

          setIdea(DEFAULT_IDEA);
          setIdeaDocumentId(null);
          showAlert("Reset Movie Idea", "Your Movie Idea has been cleared and reset successfully.", "success");
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
            themeTone: idea.themeTone,
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

  const toggleTone = (tone: string) => {
    setIdea((s) => ({
      ...s,
      themeTone: s.themeTone.includes(tone)
        ? s.themeTone.filter((t) => t !== tone)
        : [...s.themeTone, tone],
    }));
  };

  return (
    <div className="h-full overflow-y-auto bg-[#0A0A0B] px-5 py-6 text-zinc-100 lg:px-8">
      <div className="mx-auto w-full max-w-7xl space-y-8 pb-8">
        {/* Header */}
        <section className="flex flex-col gap-4 border-b border-zinc-800 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-violet-400">
              <BookOpen className="h-4 w-4" />
              Movie Idea
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">{isLoading ? "Loading..." : "Untitled Epic"}</h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">Shape premise and cast, then generate your outline.</p>
          </div>
          <div className="flex gap-2">
            {ideaDocumentId && (
              <button
                type="button"
                onClick={clearIdea}
                disabled={isClearing}
                className="inline-flex h-10 items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 px-5 text-sm font-semibold text-rose-400 disabled:opacity-50"
              >
                {isClearing ? "Clearing..." : "Delete Idea"}
              </button>
            )}
            <button
              type="button"
              onClick={saveIdea}
              className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-700 px-5 text-sm font-semibold text-zinc-200 hover:bg-zinc-900"
            >
              Save Idea
            </button>
            <button
              type="button"
              onClick={generateOutline}
              disabled={!projectId || isGenerating}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-violet-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-violet-400 disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" />
              {isGenerating ? "Generating..." : "Generate Outline"}
            </button>
          </div>
        </section>

        {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
        {message && <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</div>}

        {/* Basics */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Panel>
            <FieldLabel icon={Info}>Project Type</FieldLabel>
            <select
              aria-label="Project type"
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm"
              value={idea.projectType}
              onChange={(e) => setIdea((s) => ({ ...s, projectType: e.target.value as IdeaFormState["projectType"] }))}
            >
              <option value="Feature Film">Feature Film</option>
              <option value="Short">Short</option>
              <option value="Series">Series</option>
            </select>
          </Panel>

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
        </section>

        {/* Creative Direction: Visual Style */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <SectionTitle icon={Palette} title="Visual Style" />
              <p className="text-xs text-zinc-500 mt-1">Choose the look and feel for your movie&apos;s visuals.</p>
            </div>
            
            {/* Carousel Controls */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsAutoplay(!isAutoplay)}
                title={isAutoplay ? "Pause Autoplay" : "Start Autoplay"}
                className={cn(
                  "p-2 rounded-lg border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 hover:bg-zinc-800 transition text-zinc-400 hover:text-zinc-200",
                  isAutoplay && "text-violet-400 border-violet-500/30 bg-violet-500/5"
                )}
              >
                {isAutoplay ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => scrollCarousel("backward")}
                title="Scroll Left"
                className="p-2 rounded-lg border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 hover:bg-zinc-800 transition text-zinc-400 hover:text-zinc-200"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => scrollCarousel("forward")}
                title="Scroll Right"
                className="p-2 rounded-lg border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 hover:bg-zinc-800 transition text-zinc-400 hover:text-zinc-200"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          
          {/* Horizontal Snap Carousel Container */}
          <div 
            ref={carouselRef}
            onMouseEnter={() => setIsAutoplay(false)}
            onMouseLeave={() => setIsAutoplay(true)}
            className="flex w-full snap-x snap-mandatory gap-4 overflow-x-auto pb-4 scrollbar-hide" 
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {VISUAL_STYLES.map((style) => {
              const isSelected = idea.visualStyle === style.label;
              return (
                <motion.button
                  key={style.label}
                  type="button"
                  layout
                  onClick={() => {
                    setIsAutoplay(false); // Pause autoplay on manual selection
                    setIdea((s) => ({ ...s, visualStyle: style.label }));
                  }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.98 }}
                  className={cn(
                    "group relative flex flex-col items-center justify-center overflow-hidden rounded-xl border-2 p-4 transition-colors duration-200 snap-center shrink-0",
                    "w-40 sm:w-48 h-32",
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

        {/* Creative Direction: Tones */}
        <section className="space-y-4">
          <SectionTitle icon={WandSparkles} title="Tone & Mood" />
          <p className="text-xs text-zinc-500 -mt-2">Select one or more tones that define the feeling of your story.</p>
          <div className="flex flex-wrap gap-2">
            {TONE_OPTIONS.map((tone) => {
              const isSelected = idea.themeTone.includes(tone.label);
              return (
                <button
                  key={tone.label}
                  type="button"
                  onClick={() => toggleTone(tone.label)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-200",
                    isSelected
                      ? cn(tone.bg, tone.border, tone.color, "shadow-sm")
                      : "border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                  )}
                >
                  {isSelected && <Check className="h-3 w-3" />}
                  {tone.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Story Foundation */}
        <section className="space-y-4">
          <SectionTitle icon={WandSparkles} title="Story Foundation" />
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
        </section>

        {/* Main Characters */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <SectionTitle icon={UserPlus} title="Main Characters" />
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
          {!characters.length && <p className="text-sm text-zinc-500">No characters yet. Add them from the Characters page.</p>}
        </section>

        {/* Outline Readiness */}
        <aside className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">Outline Readiness</h2>
          <ul className="space-y-2 text-sm text-zinc-300">
            <li>• Basics: {idea.projectType} / {idea.duration}</li>
            <li>• Visual Style: {idea.visualStyle}</li>
            <li>• Tones: {idea.themeTone.length > 0 ? idea.themeTone.join(", ") : "None selected"}</li>
            <li>• Logline: {idea.logline.trim() ? "Provided" : "Missing"}</li>
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