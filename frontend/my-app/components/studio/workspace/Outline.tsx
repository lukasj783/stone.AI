"use client";

import { readApiError } from '@/lib/api/errors';
import React, { useEffect, useState } from "react";
import { List, RefreshCw, Clock3, Sparkles, FileText, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ErrorBanner } from '@/components/ui/ErrorBanner';

interface OutlineProps {
  projectId: string | null;
  onNavigateToIdea?: () => void;
  onNavigateToScript?: () => void;
}

interface OutlineData {
  id: string;
  content: string;
  metadata: {
    source?: string;
    generatedAt?: string;
  } | null;
  updated_at: string;
}

export function Outline({ projectId, onNavigateToIdea, onNavigateToScript }: OutlineProps) {
  const [outline, setOutline] = useState<OutlineData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [error, setError] = useState<string | Error | null>(null);

  useEffect(() => {
    if (!projectId) return;

    let isMounted = true;

    const fetchOutline = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const { data, error: fetchError } = await supabase
          .from("project_documents")
          .select("id, content, metadata, updated_at")
          .eq("project_id", projectId)
          .eq("type", "outline")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fetchError) throw fetchError;

        if (isMounted) {
          setOutline(
            data
              ? {
                  id: data.id as string,
                  content: (data.content as string) || "",
                  metadata: (data.metadata as OutlineData["metadata"]) ?? null,
                  updated_at: (data.updated_at as string) || "",
                }
              : null
          );
        }
      } catch (e) {
        if (isMounted) {
          setError(e instanceof Error ? e : "Failed to load outline.");
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchOutline();

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  const formatDate = (isoString: string) => {
    if (!isoString) return "Unknown";
    try {
      return new Date(isoString).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "Unknown";
    }
  };

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const handleGenerateScript = async () => {
    if (!projectId || !outline) return;

    setIsGeneratingScript(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/story/generate-script`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          outline: outline.content,
        }),
      });

      if (!response.ok) await readApiError(response, "Failed to generate script");

      // Script generation runs in the background. Move to the script tab to watch formatting happen.
      if (onNavigateToScript) {
        onNavigateToScript();
      }
    } catch (e) {
      setError(e instanceof Error ? e : "Script generation failed.");
    } finally {
      setIsGeneratingScript(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[#0A0A0B] px-5 py-6 text-zinc-100 lg:px-8">
      <div className="mx-auto w-full max-w-4xl space-y-6 pb-8">
        {/* Header */}
        <section className="flex flex-col gap-4 border-b border-zinc-800 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-violet-400">
              <List className="h-4 w-4" />
              Outline
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
              {isLoading ? "Loading..." : outline ? "Generated Outline" : "No Outline Yet"}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              {outline
                ? "Review your AI-generated story outline below."
                : "Generate an outline from the Idea page to get started."}
            </p>
          </div>
          <div className="flex gap-2">
            {onNavigateToIdea && (
              <button
                type="button"
                onClick={onNavigateToIdea}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-zinc-700 px-5 text-sm font-semibold text-zinc-200 hover:bg-zinc-900"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Idea
              </button>
            )}
            {outline && (
              <button
                type="button"
                onClick={handleGenerateScript}
                disabled={isGeneratingScript}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-violet-600 px-5 text-sm font-semibold text-zinc-50 hover:bg-violet-500 disabled:opacity-60 transition-colors duration-200"
              >
                <Sparkles className="h-4 w-4" />
                {isGeneratingScript ? "Generating Script..." : "Generate Script"}
              </button>
            )}
          </div>
        </section>

        {/* Error */}
        <ErrorBanner error={error} onDismiss={() => setError(null)} className="rounded-lg" />

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="h-6 w-6 animate-spin text-violet-400" />
            <span className="ml-3 text-sm text-zinc-400">Loading outline...</span>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !outline && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10">
              <FileText className="h-8 w-8 text-violet-400" />
            </div>
            <h2 className="mb-2 text-lg font-semibold text-zinc-200">No Outline Generated</h2>
            <p className="mb-6 max-w-md text-center text-sm text-zinc-500">
              Head over to the Idea page, fill in your movie details, and click &ldquo;Generate Outline&rdquo; to create your story outline.
            </p>
            {onNavigateToIdea && (
              <button
                type="button"
                onClick={onNavigateToIdea}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-violet-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-violet-400"
              >
                <Sparkles className="h-4 w-4" />
                Go to Idea Page
              </button>
            )}
          </div>
        )}

        {/* Outline Content */}
        {!isLoading && outline && (
          <>
            {/* Metadata Bar */}
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-xs text-zinc-500">
              {outline.metadata?.source && (
                <span className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                  Source: <span className="text-zinc-300">{outline.metadata.source}</span>
                </span>
              )}
              {outline.metadata?.generatedAt && (
                <span className="flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5 text-zinc-400" />
                  Generated: <span className="text-zinc-300">{formatDate(outline.metadata.generatedAt)}</span>
                </span>
              )}
              {outline.updated_at && (
                <span className="flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5 text-zinc-400" />
                  Updated: <span className="text-zinc-300">{formatDate(outline.updated_at)}</span>
                </span>
              )}
            </div>

            {/* Outline Text */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-6 md:p-8">
              <div className="prose prose-invert prose-sm max-w-none">
                {outline.content.split("\n").map((line, i) => {
                  const trimmed = line.trim();
                  if (!trimmed) return <br key={i} />;

                  // Detect markdown-style headings
                  if (trimmed.startsWith("# ")) {
                    return (
                      <h1 key={i} className="mt-6 mb-3 text-xl font-bold text-white">
                        {trimmed.slice(2)}
                      </h1>
                    );
                  }
                  if (trimmed.startsWith("## ")) {
                    return (
                      <h2 key={i} className="mt-5 mb-2 text-lg font-semibold text-violet-300">
                        {trimmed.slice(3)}
                      </h2>
                    );
                  }
                  if (trimmed.startsWith("### ")) {
                    return (
                      <h3 key={i} className="mt-4 mb-2 text-base font-semibold text-zinc-200">
                        {trimmed.slice(4)}
                      </h3>
                    );
                  }

                  // Detect numbered items (e.g., "1. Something")
                  if (/^\d+\.\s/.test(trimmed)) {
                    return (
                      <p key={i} className="mb-2 text-sm leading-relaxed text-zinc-300">
                        <span className="font-semibold text-violet-400">{trimmed.match(/^\d+/)?.[0]}.</span>
                        {trimmed.slice(trimmed.indexOf(".") + 1)}
                      </p>
                    );
                  }

                  // Detect bullet points
                  if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ")) {
                    return (
                      <p key={i} className="mb-1.5 pl-4 text-sm leading-relaxed text-zinc-300">
                        <span className="text-violet-400">•</span>
                        {trimmed.slice(trimmed.startsWith("• ") ? 2 : 1)}
                      </p>
                    );
                  }

                  // Regular paragraph
                  return (
                    <p key={i} className="mb-3 text-sm leading-relaxed text-zinc-300">
                      {trimmed}
                    </p>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}