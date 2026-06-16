import React, { useState } from 'react';
import {
  ChevronDown,
  GripHorizontal,
  Layers,
  Minus,
  MoveDown,
  MoveUp,
  Plus,
  Trash2,
  SquareDashed,
  CornerUpRight
} from 'lucide-react';
import { type EditorRectElement } from '@/lib/types/layers.types';

interface FloatingShapeFormatPanelProps {
  shapeElement: EditorRectElement;
  position: { x: number; y: number };
  onChange: (updates: Partial<EditorRectElement>) => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onDelete: () => void;
  onDragStart?: (event: React.PointerEvent<HTMLElement>) => void;
}

type PopoverName = 'fill' | 'border' | 'opacity' | 'layer' | null;

const clampWidth = (value: number) => Math.min(Math.max(value, 0), 64);
const clampRadius = (value: number) => Math.min(Math.max(value, 0), 100);

export default function FloatingShapeFormatPanel({
  shapeElement,
  position,
  onChange,
  onBringForward,
  onSendBackward,
  onDelete,
  onDragStart,
}: FloatingShapeFormatPanelProps) {
  const [openPopover, setOpenPopover] = useState<PopoverName>(null);

  const togglePopover = (popover: Exclude<PopoverName, null>) => {
    setOpenPopover((current) => current === popover ? null : popover);
  };

  const buttonClass = 'flex h-8 min-w-8 items-center justify-center rounded border border-zinc-700 bg-[#242424] px-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-[#303030]';
  
  const handlePanelPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!onDragStart) {
      return;
    }

    const target = event.target as HTMLElement;
    const isDragHandle = Boolean(target.closest('[data-panel-drag-handle="true"]'));
    const isInteractiveControl = Boolean(target.closest('button, input, select, textarea, label'));

    if (!isDragHandle && isInteractiveControl) {
      return;
    }

    onDragStart(event);
  };

  const isDashed = Boolean(shapeElement.dash && shapeElement.dash.length > 0);

  return (
    <div
      className="absolute z-40 flex w-max max-w-none cursor-move flex-nowrap items-center gap-1 rounded-lg border border-zinc-700 bg-[#181818] p-1.5 text-zinc-200 shadow-2xl"
      style={{ left: position.x, top: position.y }}
      onPointerDown={handlePanelPointerDown}
    >
      <button
        type="button"
        data-panel-drag-handle="true"
        className="flex h-8 w-6 cursor-grab items-center justify-center rounded border border-zinc-700 bg-[#242424] text-zinc-400 hover:bg-[#303030] hover:text-white active:cursor-grabbing"
        aria-label="Move shape format panel"
        title="Move panel"
      >
        <GripHorizontal size={15} />
      </button>

      <div className="relative">
        <button type="button" className={buttonClass} onClick={() => togglePopover('fill')}>
          Fill
        </button>
        {openPopover === 'fill' && (
          <div className="absolute left-0 top-11 z-50 w-48 rounded-lg border border-zinc-700 bg-[#1f1f1f] p-3 shadow-xl">
            <label className="mb-2 flex items-center justify-between text-xs font-semibold text-zinc-400">
              <span>Fill Color</span>
              <button 
                className="text-[10px] text-blue-400 hover:text-blue-300"
                onClick={() => onChange({ fill: 'transparent' })}
              >
                Transparent
              </button>
            </label>
            <input
              type="color"
              value={shapeElement.fill === 'transparent' ? '#000000' : shapeElement.fill}
              onChange={(event) => onChange({ fill: event.target.value })}
              className="h-9 w-full cursor-pointer rounded border border-zinc-700 bg-transparent"
              aria-label="Fill color"
            />
          </div>
        )}
      </div>

      <div className="relative">
        <button type="button" className={buttonClass} onClick={() => togglePopover('border')}>
          Border
        </button>
        {openPopover === 'border' && (
          <div className="absolute left-0 top-11 z-50 w-56 rounded-lg border border-zinc-700 bg-[#1f1f1f] p-3 shadow-xl">
            <label className="mb-2 flex items-center justify-between text-xs font-semibold text-zinc-400">
              <span>Border Color</span>
              <button 
                className="text-[10px] text-blue-400 hover:text-blue-300"
                onClick={() => onChange({ stroke: 'transparent' })}
              >
                Transparent
              </button>
            </label>
            <input
              type="color"
              value={shapeElement.stroke === 'transparent' ? '#000000' : shapeElement.stroke}
              onChange={(event) => onChange({ stroke: event.target.value })}
              className="mb-3 h-9 w-full cursor-pointer rounded border border-zinc-700 bg-transparent"
              aria-label="Border color"
            />
            
            <label className="mb-2 flex items-center justify-between text-xs font-semibold text-zinc-400">
              <span>Dash Style</span>
            </label>
            <button
              onClick={() => onChange({ dash: isDashed ? undefined : [10, 8] })}
              className={`flex w-full items-center justify-center gap-2 rounded border border-zinc-700 p-1.5 mb-3 transition-colors ${
                isDashed ? 'bg-blue-600/20 text-blue-400 border-blue-500/50' : 'bg-[#242424] hover:bg-[#303030]'
              }`}
            >
              <SquareDashed size={14} /> 
              <span className="text-xs font-medium">{isDashed ? 'Dashed Line' : 'Solid Line'}</span>
            </button>
          </div>
        )}
      </div>

      <div className="flex h-8 items-center rounded border border-zinc-700 bg-[#242424]">
        <button
          type="button"
          onClick={() => onChange({ strokeWidth: clampWidth((shapeElement.strokeWidth || 0) - 1) })}
          className="flex h-full w-8 items-center justify-center border-r border-zinc-700 hover:bg-[#303030]"
          aria-label="Decrease border width"
          title="Border Width"
        >
          <Minus size={14} />
        </button>
        <span className="w-10 text-center text-xs font-semibold tabular-nums">{shapeElement.strokeWidth || 0}</span>
        <button
          type="button"
          onClick={() => onChange({ strokeWidth: clampWidth((shapeElement.strokeWidth || 0) + 1) })}
          className="flex h-full w-8 items-center justify-center border-l border-zinc-700 hover:bg-[#303030]"
          aria-label="Increase border width"
          title="Border Width"
        >
          <Plus size={14} />
        </button>
      </div>

      {(!shapeElement.shapeKind || shapeElement.shapeKind === 'rectangle') && (
        <div className="flex h-8 items-center rounded border border-zinc-700 bg-[#242424] ml-1">
          <div className="flex h-full w-8 items-center justify-center border-r border-zinc-700 text-zinc-400" title="Corner Radius">
            <CornerUpRight size={14} />
          </div>
          <button
            type="button"
            onClick={() => onChange({ cornerRadius: clampRadius((shapeElement.cornerRadius || 0) - 2) })}
            className="flex h-full w-7 items-center justify-center border-r border-zinc-700 hover:bg-[#303030]"
            aria-label="Decrease corner radius"
            title="Decrease Corner Radius"
          >
            <Minus size={12} />
          </button>
          <span className="w-8 text-center text-xs font-semibold tabular-nums">{shapeElement.cornerRadius || 0}</span>
          <button
            type="button"
            onClick={() => onChange({ cornerRadius: clampRadius((shapeElement.cornerRadius || 0) + 2) })}
            className="flex h-full w-7 items-center justify-center border-l border-zinc-700 hover:bg-[#303030]"
            aria-label="Increase corner radius"
            title="Increase Corner Radius"
          >
            <Plus size={12} />
          </button>
        </div>
      )}

      <div className="relative ml-1">
        <button type="button" className={buttonClass} onClick={() => togglePopover('opacity')}>
          Opacity <ChevronDown size={14} />
        </button>
        {openPopover === 'opacity' && (
          <div className="absolute right-0 top-11 z-50 w-56 rounded-lg border border-zinc-700 bg-[#1f1f1f] p-3 shadow-xl">
            <label className="mb-2 flex items-center justify-between text-xs font-semibold text-zinc-400">
              <span>Opacity</span>
              <span>{Math.round((shapeElement.opacity ?? 1) * 100)}%</span>
            </label>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={shapeElement.opacity ?? 1}
              onChange={(event) => onChange({ opacity: Number(event.target.value) })}
              className="w-full accent-blue-500"
              aria-label="Opacity"
            />
          </div>
        )}
      </div>

      <div className="relative">
        <button type="button" className={buttonClass} onClick={() => togglePopover('layer')}>
          <Layers size={15} /> Layer
        </button>
        {openPopover === 'layer' && (
          <div className="absolute right-0 top-11 z-50 flex rounded-lg border border-zinc-700 bg-[#1f1f1f] p-1.5 shadow-xl">
            <button
              type="button"
              onClick={onBringForward}
              className="flex h-8 w-8 items-center justify-center rounded text-zinc-200 hover:bg-zinc-700"
              aria-label="Bring forward"
              title="Bring Forward"
            >
              <MoveUp size={16} />
            </button>
            <button
              type="button"
              onClick={onSendBackward}
              className="flex h-8 w-8 items-center justify-center rounded text-zinc-200 hover:bg-zinc-700"
              aria-label="Send backward"
              title="Send Backward"
            >
              <MoveDown size={16} />
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onDelete}
        className="ml-1 flex h-8 w-8 items-center justify-center rounded border border-red-500/40 bg-red-500/10 text-red-300 transition-colors hover:bg-red-500/20"
        aria-label="Delete shape"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}
