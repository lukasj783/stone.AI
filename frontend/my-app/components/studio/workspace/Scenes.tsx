"use client";

import React, { useEffect, useState } from 'react';
import { Clapperboard, FileText, RefreshCw, CheckCircle2, Clock, AlertCircle, ChevronRight } from 'lucide-react';
import { supabase } from "@/lib/supabaseClient";

interface ScenesProps {
  projectId: string | null;
  onNavigateToScript?: (sceneId?: string) => void;
}

interface SceneRow {
  id: string;
  slugline_raw: string;
  location_type?: string;
  location?: string;
  time_of_day?: string;
  summary?: string;
  status: string;
  scene_order: number;
  block_count: number;
}

export function Scenes({ projectId, onNavigateToScript }: ScenesProps) {
  const [scenes, setScenes] = useState<SceneRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let isMounted = true;

    const fetchScenes = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const { data: scenesData, error: scenesError } = await supabase
          .from("scenes")
          .select("*")
          .eq("project_id", projectId)
          .order("sort_order", { ascending: true });

        if (scenesError) throw scenesError;

        if (scenesData && isMounted) {
          const sceneIds = scenesData.map((s) => s.id as string);

          let blockCountMap: Record<string, number> = {};
          if (sceneIds.length > 0) {
            const { data: blocksData } = await supabase
              .from("script_blocks")
              .select("scene_id")
              .in("scene_id", sceneIds);

            if (blocksData) {
              blockCountMap = (blocksData as { scene_id: string }[]).reduce((acc, b) => {
                acc[b.scene_id] = (acc[b.scene_id] || 0) + 1;
                return acc;
              }, {} as Record<string, number>);
            }
          }

          const mapped: SceneRow[] = (scenesData as Record<string, unknown>[]).map((s) => ({
            id: s.id as string,
            slugline_raw: s.slugline_raw as string,
            location_type: s.location_type as string | undefined,
            location: s.location as string | undefined,
            time_of_day: s.time_of_day as string | undefined,
            summary: s.summary as string | undefined,
            status: s.status as string,
            scene_order: (s.sort_order ?? s.scene_order ?? 0) as number,
            block_count: blockCountMap[s.id as string] ?? 0,
          }));

          setScenes(mapped);
        }
      } catch (e) {
        if (isMounted) setError(e instanceof Error ? e.message : "Failed to load scenes.");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchScenes();
    return () => { isMounted = false; };
  }, [projectId]);

  const totalScenes = scenes.length;
  const completedScenes = scenes.filter((s) => s.status === 'complete').length;
  const pendingScenes = scenes.filter((s) => s.status === 'pending').length;
  const inProgressScenes = scenes.filter((s) => s.status === 'in_progress').length;
  const progressPercent = totalScenes > 0 ? Math.round((completedScenes / totalScenes) * 100) : 0;

  const statusConfig: Record<string, { label: string; chipClass: string; icon: React.ReactNode }> = {
    complete: {
      label: 'Complete',
      chipClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    in_progress: {
      label: 'In Progress',
      chipClass: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
      icon: <RefreshCw className="w-3 h-3 animate-spin" />,
    },
    pending: {
      label: 'Pending',
      chipClass: 'bg-zinc-700/40 text-zinc-400 border-zinc-700/40',
      icon: <Clock className="w-3 h-3" />,
    },
    failed: {
      label: 'Failed',
      chipClass: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
      icon: <AlertCircle className="w-3 h-3" />,
    },
  };

  return (
    <div className="h-full flex flex-col overflow-auto bg-[#0A0A0B]">
      {/* Page Header */}
      <div className="shrink-0 px-8 pt-8 pb-6 border-b border-zinc-800/60">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <Clapperboard className="w-5 h-5 text-violet-400" />
              <h1 className="text-xl font-bold text-zinc-100 font-sans tracking-tight">Scenes</h1>
            </div>
            <p className="text-sm text-zinc-500">
              {totalScenes > 0
                ? `${totalScenes} scenes from your screenplay — review each one before moving to production.`
                : 'No scenes yet. Generate your script first to populate this view.'}
            </p>
          </div>
          {onNavigateToScript && (
            <button
              type="button"
              onClick={() => onNavigateToScript()}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-violet-400 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 rounded-lg transition-colors shrink-0"
            >
              <FileText className="w-3.5 h-3.5" />
              Open Script Editor
            </button>
          )}
        </div>

        {/* Stats Bar */}
        {totalScenes > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-48">
              <div className="flex-1 bg-zinc-800/60 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-linear-to-r from-emerald-600 to-emerald-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="text-xs font-mono text-zinc-400 shrink-0">{progressPercent}%</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {completedScenes} complete
              </span>
              {inProgressScenes > 0 && (
                <span className="flex items-center gap-1.5 text-xs text-violet-400 font-medium">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  {inProgressScenes} writing
                </span>
              )}
              {pendingScenes > 0 && (
                <span className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
                  <Clock className="w-3.5 h-3.5" />
                  {pendingScenes} pending
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Scene Cards Grid */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {error && (
          <div className="mb-4 bg-red-500/10 border border-red-500/30 text-red-300 text-sm px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <RefreshCw className="w-8 h-8 animate-spin text-zinc-600" />
            <p className="text-zinc-500 text-sm">Loading scenes...</p>
          </div>
        ) : totalScenes === 0 ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center py-24 gap-5 text-center">
            <div className="w-16 h-16 rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/50 flex items-center justify-center">
              <Clapperboard className="w-7 h-7 text-zinc-600" />
            </div>
            <div>
              <p className="text-zinc-300 font-semibold font-sans mb-1">No scenes generated yet</p>
              <p className="text-zinc-500 text-sm max-w-sm">
                Go to the Script tab, generate your screenplay, and scenes will appear here automatically.
              </p>
            </div>
            {onNavigateToScript && (
              <button
                type="button"
                onClick={() => onNavigateToScript()}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition-colors"
              >
                <FileText className="w-4 h-4" />
                Go to Script Editor
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {scenes.map((scene, idx) => {
              const statusInfo = statusConfig[scene.status] ?? statusConfig['pending'];
              return (
                <div
                  key={scene.id}
                  className="group bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl p-5 flex flex-col gap-3.5 transition-all duration-200 cursor-default"
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-[10px] font-bold text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700/50">
                        #{idx + 1}
                      </span>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${statusInfo.chipClass}`}>
                        {statusInfo.icon}
                        {statusInfo.label}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-zinc-500 bg-zinc-950 border border-zinc-800 px-2 py-0.5 rounded shrink-0">
                      {scene.location_type || 'INT'} • {scene.time_of_day || 'DAY'}
                    </span>
                  </div>

                  {/* Slugline */}
                  <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wide leading-snug font-mono">
                    {scene.slugline_raw}
                  </h3>

                  {/* Summary */}
                  {scene.summary ? (
                    <p className="text-xs text-zinc-400 leading-relaxed line-clamp-3 font-sans">
                      {scene.summary}
                    </p>
                  ) : (
                    <p className="text-xs text-zinc-600 italic font-sans">No summary available.</p>
                  )}

                  {/* Card Footer */}
                  <div className="flex items-center justify-between mt-auto pt-3 border-t border-zinc-800/60">
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {scene.block_count} {scene.block_count === 1 ? 'block' : 'blocks'}
                    </span>
                    {onNavigateToScript && (
                      <button
                        type="button"
                        onClick={() => onNavigateToScript(scene.id)}
                        className="flex items-center gap-1 text-[10px] font-semibold text-zinc-400 hover:text-violet-400 transition-colors group-hover:text-zinc-300"
                      >
                        Open in Script
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
