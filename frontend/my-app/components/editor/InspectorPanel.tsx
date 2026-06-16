import React from 'react';
import { Volume2, Gauge, ImageIcon, Video, Eye, TrendingUp, TrendingDown, Film, ChevronRight } from 'lucide-react';
import type { TimelineElement } from '@/lib/types/layers.types';
import { formatTime } from './utils';

export function InspectorPanel({
  selectedElement, onUpdateElement,
}: {
  selectedElement: TimelineElement | null;
  onUpdateElement: (elementId: string, updates: Partial<TimelineElement>) => void;
}) {
  if (!selectedElement) {
    return (
      <aside className="w-75 bg-[#18181b] rounded-xl border border-zinc-800 flex flex-col shrink-0 overflow-y-auto hide-scrollbar">
        <div className="p-4 border-b border-zinc-800 flex items-center gap-2 text-xs font-bold text-zinc-400">
          <span className="flex items-center gap-1 hover:text-white cursor-pointer"><ImageIcon size={14}/> Still Image <ChevronRight size={14} className="text-zinc-600"/></span>
          <span className="flex items-center gap-1 text-white border-b-2 border-white pb-0.5"><Video size={14}/> Video</span>
        </div>
        <div className="p-5 flex flex-col gap-6">
          <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800/50 border-dashed">
            <p className="text-xs text-zinc-500 font-medium leading-relaxed">
              Select a clip on the timeline to edit its properties.
            </p>
          </div>
        </div>
      </aside>
    );
  }

  const maxEditableDuration =
    typeof selectedElement.sourceDuration === 'number' && Number.isFinite(selectedElement.sourceDuration) &&
    (selectedElement.assetType === 'video' || selectedElement.assetType === 'audio')
      ? Math.max(0.1, (selectedElement.sourceDuration - selectedElement.trimStart) / selectedElement.speed)
      : 30;

  return (
    <aside className="w-75 bg-[#18181b] rounded-xl border border-zinc-800 flex flex-col shrink-0 overflow-y-auto hide-scrollbar">
      <div className="p-4 border-b border-zinc-800">
        <p className="text-xs font-bold text-white truncate">{selectedElement.assetName}</p>
        <p className="text-[10px] text-zinc-500 mt-0.5">
          Start: {formatTime(selectedElement.startTime)} • Duration: {selectedElement.duration.toFixed(1)}s
        </p>
      </div>

      <div className="p-5 flex flex-col gap-6">
        {/* Volume */}
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs font-bold text-zinc-200">
            <Volume2 size={16} /> Audio Volume
          </label>
          <div className="flex items-center gap-3">
            <input aria-label="Audio Volume" type="range" min="0" max="100"
              value={selectedElement.volume}
              onChange={(e) => onUpdateElement(selectedElement.id, { volume: Number(e.target.value) })}
              className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
            <div className="w-14 px-2 py-1 bg-zinc-700/50 rounded-md text-xs font-bold text-center border border-zinc-700">{selectedElement.volume}%</div>
          </div>
        </div>

        {/* Speed */}
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs font-bold text-zinc-200">
            <Gauge size={16} /> Audio Speed
          </label>
          <div className="flex items-center gap-3">
            <input aria-label="Audio Speed" type="range" min="50" max="200" step="10"
              value={selectedElement.speed * 100}
              onChange={(e) => onUpdateElement(selectedElement.id, { speed: Number(e.target.value) / 100 })}
              className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
            <div className="w-14 px-2 py-1 bg-zinc-700/50 rounded-md text-xs font-bold text-center border border-zinc-700">{selectedElement.speed.toFixed(2)}x</div>
          </div>
        </div>

        {/* Opacity */}
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs font-bold text-zinc-200">
            <Eye size={16} /> Opacity
          </label>
          <div className="flex items-center gap-3">
            <input aria-label="Opacity" type="range" min="0" max="100"
              value={selectedElement.opacity}
              onChange={(e) => onUpdateElement(selectedElement.id, { opacity: Number(e.target.value) })}
              className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
            <div className="w-14 px-2 py-1 bg-zinc-700/50 rounded-md text-xs font-bold text-center border border-zinc-700">{selectedElement.opacity}%</div>
          </div>
        </div>

        {/* Fade In */}
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs font-bold text-zinc-200">
            <TrendingUp size={16} /> Fade In
          </label>
          <div className="flex items-center gap-3">
            <input aria-label="Fade In" type="range" min="0" max="5" step="0.1"
              value={selectedElement.fadeIn}
              onChange={(e) => onUpdateElement(selectedElement.id, { fadeIn: Number(e.target.value) })}
              className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
            <div className="w-14 px-2 py-1 bg-zinc-700/50 rounded-md text-xs font-bold text-center border border-zinc-700">{selectedElement.fadeIn.toFixed(1)}s</div>
          </div>
        </div>

        {/* Fade Out */}
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs font-bold text-zinc-200">
            <TrendingDown size={16} /> Fade Out
          </label>
          <div className="flex items-center gap-3">
            <input aria-label="Fade Out" type="range" min="0" max="5" step="0.1"
              value={selectedElement.fadeOut}
              onChange={(e) => onUpdateElement(selectedElement.id, { fadeOut: Number(e.target.value) })}
              className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
            <div className="w-14 px-2 py-1 bg-zinc-700/50 rounded-md text-xs font-bold text-center border border-zinc-700">{selectedElement.fadeOut.toFixed(1)}s</div>
          </div>
        </div>

        {/* Duration */}
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs font-bold text-zinc-200">
            <Film size={16} /> Duration
          </label>
          <div className="flex items-center gap-3">
            <input aria-label="Duration" type="range" min={Math.min(0.5, maxEditableDuration)} max={maxEditableDuration} step="0.5"
              value={selectedElement.duration}
              onChange={(e) => onUpdateElement(selectedElement.id, { duration: Number(e.target.value) })}
              className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
            <div className="w-14 px-2 py-1 bg-zinc-700/50 rounded-md text-xs font-bold text-center border border-zinc-700">{selectedElement.duration.toFixed(1)}s</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
