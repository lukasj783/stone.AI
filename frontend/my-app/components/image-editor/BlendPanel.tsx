import React from 'react';
import { Info, Download, Save } from 'lucide-react';
import { AVAILABLE_BLEND_MODES, type BlendMode, type BlendableTarget } from '@/lib/types/layers.types';

interface BlendPanelProps {
  selectedTarget?: BlendableTarget | null;
  onBlendModeChange?: (blendMode: BlendMode) => void;
  onOpacityChange?: (opacity: number) => void;
  onDownload?: () => void;
}

export default function BlendPanel({
  selectedTarget = null,
  onBlendModeChange = () => {},
  onOpacityChange = () => {},
  onDownload = () => {}
}: BlendPanelProps) {
  return (
    <div className="bg-[#1a1a1a] w-80 shrink-0 flex flex-col border-l border-zinc-800 text-zinc-300">
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-bold text-white flex items-center gap-2">
            <div className="w-5 h-5 border-2 border-white rounded-sm border-dashed"></div>
            Blend Board
          </span>
          <Info size={14} className="text-zinc-500" />
        </div>
        <span className="text-xs text-zinc-500 flex items-center gap-1 cursor-pointer hover:text-zinc-300">
          Results <span className="text-lg leading-none">&rarr;</span>
        </span>
      </div>

      <div className="p-4 flex-1 overflow-y-auto">
        
          <div className="flex justify-between mb-2 text-sm font-semibold text-zinc-300">
            <label>Board Size</label>
            <Info size={14} className="text-zinc-500" />
          </div>
          <div className="w-full bg-[#2a2a2a] p-2 rounded flex justify-between items-center text-sm border border-zinc-700 cursor-pointer">
            <span>Blend</span>
            <span className="text-zinc-500">⌵</span>
          </div>
          <div className="flex items-center justify-center gap-2 mt-4 text-xs text-emerald-500">
            <span>♦</span> 10 credits will be charged
          </div>
        </div>

        <div className="mb-6 rounded-lg border border-zinc-800 bg-[#202020] p-4">
          <div className="mb-2 flex items-center justify-between text-sm font-semibold text-zinc-300">
            <label htmlFor="blend-mode">Layer Blend Mode</label>
            <Info size={14} className="text-zinc-500" />
          </div>
          <p className="mb-3 text-xs text-zinc-500">
            {selectedTarget
              ? `${selectedTarget.label} blending is applied live on the artboard.`
              : 'Select the base image or an image layer on the board to apply a real blend mode.'}
          </p>
          <select
            id="blend-mode"
            value={selectedTarget?.blendMode ?? 'source-over'}
            onChange={(e) => onBlendModeChange(e.target.value as BlendMode)}
            disabled={!selectedTarget}
            className="w-full rounded-md border border-zinc-700 bg-[#2a2a2a] px-3 py-2 text-sm text-white outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {AVAILABLE_BLEND_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between text-sm font-semibold text-zinc-300">
              <label htmlFor="blend-opacity">Layer Opacity</label>
              <span className="text-xs font-bold text-white tabular-nums">
                {selectedTarget ? Math.round(selectedTarget.opacity * 100) : 100}%
              </span>
            </div>
            <input
              id="blend-opacity"
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={selectedTarget?.opacity ?? 1}
              onChange={(e) => onOpacityChange(Number(e.target.value))}
              disabled={!selectedTarget}
              className="w-full accent-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        </div>

        <div className="mt-8 border-t border-zinc-800 pt-6">
          <label className="block text-sm font-semibold text-zinc-300 mb-2">Export the Artboard</label>
          <div className="flex gap-2">
            <div className="flex-1 bg-[#2a2a2a] p-2 rounded flex justify-between items-center text-sm border border-zinc-700 cursor-pointer">
              <span>PNG</span>
              <span className="text-zinc-500">⌵</span>
            </div>
            <button
              type="button"
              onClick={onDownload}
              className="bg-[#2a2a2a] hover:bg-[#333] border border-zinc-700 text-white px-3 py-2 rounded flex items-center gap-2 text-sm transition-colors"
            >
              <Download size={14} /> Download
            </button>
          </div>
          <button className="w-full mt-3 bg-[#2a2a2a] hover:bg-[#333] border border-zinc-700 text-white p-2 rounded flex items-center justify-center gap-2 text-sm transition-colors">
            <Save size={14} /> Save To Generation History
          </button>
        </div>
      </div>
  
  );
}