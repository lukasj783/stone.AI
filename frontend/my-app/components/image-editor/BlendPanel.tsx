import React, { useState } from 'react';
import { ChevronDown, Download, ImagePlus, Info, RotateCcw, Save } from 'lucide-react';
import {
  AVAILABLE_BLEND_MODES,
  BLEND_BOARD_SIZE_PRESETS,
  type BlendBoardSize,
  type BlendMode,
  type BlendableTarget,
  type ExportFormat,
} from '@/lib/types/layers.types';

interface BlendPanelProps {
  selectedTarget?: BlendableTarget | null;
  boardSize: BlendBoardSize;
  exportFormat: ExportFormat;
  layerCount: number;
  canExport: boolean;
  isExporting?: boolean;
  isSavingToAssets?: boolean;
  onBlendModeChange: (blendMode: BlendMode) => void;
  onOpacityChange: (opacity: number) => void;
  onBoardSizeChange: (size: BlendBoardSize) => void;
  onExportFormatChange: (format: ExportFormat) => void;
  onResetSelectedTarget: () => void;
  onAddImageLayer: () => void;
  onDownload: () => void;
  onSaveToAssets?: () => void;
}

const EXPORT_FORMATS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
];

const getBlendModeLabel = (blendMode: BlendMode) => (
  AVAILABLE_BLEND_MODES.find((mode) => mode.value === blendMode)?.label ?? blendMode
);

export default function BlendPanel({
  selectedTarget = null,
  boardSize,
  exportFormat,
  layerCount,
  canExport,
  isExporting = false,
  isSavingToAssets = false,
  onBlendModeChange,
  onOpacityChange,
  onBoardSizeChange,
  onExportFormatChange,
  onResetSelectedTarget,
  onAddImageLayer,
  onDownload,
  onSaveToAssets,
}: BlendPanelProps) {
  const [isLayersOpen, setIsLayersOpen] = useState(true);
  const hasSelectedTarget = Boolean(selectedTarget);
  const canSaveToAssets = Boolean(onSaveToAssets) && canExport && !isSavingToAssets;

  return (
    <div className="bg-[#1a1a1a] w-80 shrink-0 flex flex-col border-l border-zinc-800 text-zinc-300">
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-bold text-white flex items-center gap-2">
            <div className="w-5 h-5 border-2 border-white rounded-sm border-dashed" />
            Blend Board
          </span>
          <Info size={14} className="text-zinc-500" />
        </div>
        <span className="text-xs text-zinc-500">{layerCount} layers</span>
      </div>

      <div className="p-4 flex-1 overflow-y-auto space-y-5">
        <section>
          <div className="flex justify-between mb-2 text-sm font-semibold text-zinc-300">
            <label htmlFor="blend-board-size">Board Size</label>
            <span className="text-xs font-normal text-zinc-500">
              {boardSize.width}x{boardSize.height}
            </span>
          </div>
          <select
            id="blend-board-size"
            value={boardSize.id}
            onChange={(event) => {
              const nextSize = BLEND_BOARD_SIZE_PRESETS.find((size) => size.id === event.target.value);
              if (nextSize) {
                onBoardSizeChange(nextSize);
              }
            }}
            className="w-full rounded-md border border-zinc-700 bg-[#2a2a2a] px-3 py-2 text-sm text-white outline-none transition-colors"
          >
            {BLEND_BOARD_SIZE_PRESETS.map((size) => (
              <option key={size.id} value={size.id}>
                {size.label}
              </option>
            ))}
          </select>
        </section>

        <section className="rounded-lg border border-zinc-800 bg-[#202020]">
          <button
            type="button"
            onClick={() => setIsLayersOpen((current) => !current)}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-zinc-300 transition-colors hover:bg-[#252525]"
            aria-expanded={isLayersOpen}
          >
            <span>Layers</span>
            <span className="flex items-center gap-2 text-xs font-normal text-zinc-500">
              {layerCount} layers
              <ChevronDown
                size={16}
                className={`transition-transform ${isLayersOpen ? 'rotate-180' : ''}`}
              />
            </span>
          </button>
          {isLayersOpen && (
            <div className="border-t border-zinc-800 p-4">
              <button
                type="button"
                onClick={onAddImageLayer}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-zinc-700 bg-[#2a2a2a] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#333]"
              >
                <ImagePlus size={16} />
                Add Image Layer
              </button>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-zinc-800 bg-[#202020] p-4">
          <div className="mb-3 flex items-center justify-between text-sm font-semibold text-zinc-300">
            <span>Selected Layer</span>
            <span className="text-xs font-normal text-zinc-500">
              {selectedTarget ? selectedTarget.kind === 'base-image' ? 'Base' : 'Image' : 'None'}
            </span>
          </div>
          {selectedTarget ? (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-[#2a2a2a] p-2">
                <span className="block text-zinc-500">Target</span>
                <span className="font-semibold text-white">{selectedTarget.label}</span>
              </div>
              <div className="rounded-md bg-[#2a2a2a] p-2">
                <span className="block text-zinc-500">Opacity</span>
                <span className="font-semibold text-white">{Math.round(selectedTarget.opacity * 100)}%</span>
              </div>
              <div className="col-span-2 rounded-md bg-[#2a2a2a] p-2">
                <span className="block text-zinc-500">Blend Mode</span>
                <span className="font-semibold text-white">{getBlendModeLabel(selectedTarget.blendMode)}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs leading-5 text-zinc-500">
              Select the base image or an image layer on the board to edit blend settings.
            </p>
          )}
        </section>

        <section className="rounded-lg border border-zinc-800 bg-[#202020] p-4">
          <div className="mb-2 flex items-center justify-between text-sm font-semibold text-zinc-300">
            <label htmlFor="blend-mode">Layer Blend Mode</label>
            <Info size={14} className="text-zinc-500" />
          </div>
          <select
            id="blend-mode"
            value={selectedTarget?.blendMode ?? 'source-over'}
            onChange={(event) => onBlendModeChange(event.target.value as BlendMode)}
            disabled={!hasSelectedTarget}
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
              onChange={(event) => onOpacityChange(Number(event.target.value))}
              disabled={!hasSelectedTarget}
              className="w-full accent-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => onBlendModeChange('source-over')}
              disabled={!hasSelectedTarget}
              className="rounded border border-zinc-700 bg-[#2a2a2a] px-2 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reset Blend
            </button>
            <button
              type="button"
              onClick={() => onOpacityChange(1)}
              disabled={!hasSelectedTarget}
              className="rounded border border-zinc-700 bg-[#2a2a2a] px-2 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reset Opacity
            </button>
            <button
              type="button"
              onClick={onResetSelectedTarget}
              disabled={!hasSelectedTarget}
              className="rounded border border-zinc-700 bg-[#2a2a2a] px-2 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex items-center justify-center gap-1">
                <RotateCcw size={12} /> Both
              </span>
            </button>
          </div>
        </section>

        <section className="border-t border-zinc-800 pt-5">
          <label className="block text-sm font-semibold text-zinc-300 mb-2">Export the Artboard</label>
          <div className="flex gap-2">
            <select
              value={exportFormat}
              onChange={(event) => onExportFormatChange(event.target.value as ExportFormat)}
              className="flex-1 rounded border border-zinc-700 bg-[#2a2a2a] px-3 py-2 text-sm text-white outline-none"
              aria-label="Export format"
            >
              {EXPORT_FORMATS.map((format) => (
                <option key={format.value} value={format.value}>
                  {format.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onDownload}
              disabled={!canExport || isExporting}
              className="bg-[#2a2a2a] hover:bg-[#333] border border-zinc-700 text-white px-3 py-2 rounded flex items-center gap-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={14} /> {isExporting ? 'Exporting' : 'Download'}
            </button>
          </div>
          <button
            type="button"
            onClick={onSaveToAssets}
            disabled={!canSaveToAssets}
            className="w-full mt-3 bg-[#2a2a2a] hover:bg-[#333] border border-zinc-700 text-white p-2 rounded flex items-center justify-center gap-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save size={14} /> {isSavingToAssets ? 'Saving To Assets' : 'Save To Assets'}
          </button>
        </section>
      </div>
    </div>
  );
}
