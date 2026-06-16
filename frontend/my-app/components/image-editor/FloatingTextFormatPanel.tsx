import React, { useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  GripHorizontal,
  Italic,
  Layers,
  Minus,
  MoveDown,
  MoveUp,
  Plus,
  Trash2,
  Underline,
} from 'lucide-react';
import { AVAILABLE_FONTS, type EditorTextElement } from '@/lib/types/layers.types';

interface FloatingTextFormatPanelProps {
  textElement: EditorTextElement;
  position: { x: number; y: number };
  onChange: (updates: Partial<EditorTextElement>) => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onDelete: () => void;
  onDragStart?: (event: React.PointerEvent<HTMLElement>) => void;
}

type PopoverName = 'fill' | 'border' | 'style' | 'spacing' | 'layer' | null;

const clampFontSize = (value: number) => Math.min(Math.max(value, 8), 240);

export default function FloatingTextFormatPanel({
  textElement,
  position,
  onChange,
  onBringForward,
  onSendBackward,
  onDelete,
  onDragStart,
}: FloatingTextFormatPanelProps) {
  const [openPopover, setOpenPopover] = useState<PopoverName>(null);

  const togglePopover = (popover: Exclude<PopoverName, null>) => {
    setOpenPopover((current) => current === popover ? null : popover);
  };

  const buttonClass = 'flex h-8 min-w-8 items-center justify-center rounded border border-zinc-700 bg-[#242424] px-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-[#303030]';
  const activeButtonClass = 'bg-blue-600 text-white border-blue-500 hover:bg-blue-500';

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
        aria-label="Move text format panel"
        title="Move panel"
      >
        <GripHorizontal size={15} />
      </button>

      <div className="relative">
        <button type="button" className={buttonClass} onClick={() => togglePopover('fill')}>
          Fill
        </button>
        {openPopover === 'fill' && (
          <div className="absolute left-0 top-11 z-50 w-44 rounded-lg border border-zinc-700 bg-[#1f1f1f] p-3 shadow-xl">
            <label className="mb-2 block text-xs font-semibold text-zinc-400">Fill Color</label>
            <input
              type="color"
              value={textElement.fill}
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
          <div className="absolute left-0 top-11 z-50 w-52 rounded-lg border border-zinc-700 bg-[#1f1f1f] p-3 shadow-xl">
            <label className="mb-2 block text-xs font-semibold text-zinc-400">Border Color</label>
            <input
              type="color"
              value={textElement.stroke}
              onChange={(event) => onChange({ stroke: event.target.value })}
              className="mb-3 h-9 w-full cursor-pointer rounded border border-zinc-700 bg-transparent"
              aria-label="Border color"
            />
            <label className="mb-2 flex items-center justify-between text-xs font-semibold text-zinc-400">
              <span>Width</span>
              <span>{textElement.strokeWidth}px</span>
            </label>
            <input
              type="range"
              min="0"
              max="12"
              step="1"
              value={textElement.strokeWidth}
              onChange={(event) => onChange({ strokeWidth: Number(event.target.value) })}
              className="w-full accent-blue-500"
              aria-label="Border width"
            />
          </div>
        )}
      </div>

      <select
        value={textElement.fontFamily}
        onChange={(event) => onChange({ fontFamily: event.target.value })}
        className="h-8 min-w-36 rounded border border-zinc-700 bg-[#242424] px-2 text-xs font-semibold text-zinc-200 outline-none"
        aria-label="Font family"
      >
        {AVAILABLE_FONTS.map((font) => (
          <option key={font.value} value={font.value}>
            {font.label}
          </option>
        ))}
      </select>

      <div className="flex h-8 items-center rounded border border-zinc-700 bg-[#242424]">
        <button
          type="button"
          onClick={() => onChange({ fontSize: clampFontSize(textElement.fontSize - 2) })}
          className="flex h-full w-8 items-center justify-center border-r border-zinc-700 hover:bg-[#303030]"
          aria-label="Decrease font size"
        >
          <Minus size={14} />
        </button>
        <span className="w-10 text-center text-xs font-semibold tabular-nums">{textElement.fontSize}</span>
        <button
          type="button"
          onClick={() => onChange({ fontSize: clampFontSize(textElement.fontSize + 2) })}
          className="flex h-full w-8 items-center justify-center border-l border-zinc-700 hover:bg-[#303030]"
          aria-label="Increase font size"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="relative">
        <button type="button" className={buttonClass} onClick={() => togglePopover('style')}>
          Style <ChevronDown size={14} />
        </button>
        {openPopover === 'style' && (
          <div className="absolute left-0 top-10 z-50 flex rounded-lg border border-zinc-700 bg-[#1f1f1f] p-1.5 shadow-xl">
            <button
              type="button"
              onClick={() => onChange({ fontWeight: textElement.fontWeight === 'bold' ? 'normal' : 'bold' })}
              className={`flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-[#303030] ${textElement.fontWeight === 'bold' ? activeButtonClass : ''}`}
              aria-label="Bold"
              title="Bold"
            >
              <Bold size={16} />
            </button>
            <button
              type="button"
              onClick={() => onChange({ fontStyle: textElement.fontStyle === 'italic' ? 'normal' : 'italic' })}
              className={`flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-[#303030] ${textElement.fontStyle === 'italic' ? activeButtonClass : ''}`}
              aria-label="Italic"
              title="Italic"
            >
              <Italic size={16} />
            </button>
            <button
              type="button"
              onClick={() => onChange({ textDecoration: textElement.textDecoration === 'underline' ? 'none' : 'underline' })}
              className={`flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-[#303030] ${textElement.textDecoration === 'underline' ? activeButtonClass : ''}`}
              aria-label="Underline"
              title="Underline"
            >
              <Underline size={16} />
            </button>
          </div>
        )}
      </div>

      <input
        type="color"
        value={textElement.fill}
        onChange={(event) => onChange({ fill: event.target.value })}
        className="h-8 w-8 cursor-pointer rounded border border-zinc-700 bg-[#242424] p-1"
        aria-label="Text color"
        title="Text Color"
      />

      <div className="flex h-8 items-center rounded border border-zinc-700 bg-[#242424]">
        <button
          type="button"
          onClick={() => onChange({ textAlign: 'left' })}
          className={`flex h-full w-8 items-center justify-center ${textElement.textAlign === 'left' ? 'bg-blue-600 text-white' : 'hover:bg-[#303030]'}`}
          aria-label="Align left"
        >
          <AlignLeft size={15} />
        </button>
        <button
          type="button"
          onClick={() => onChange({ textAlign: 'center' })}
          className={`flex h-full w-8 items-center justify-center border-x border-zinc-700 ${textElement.textAlign === 'center' ? 'bg-blue-600 text-white' : 'hover:bg-[#303030]'}`}
          aria-label="Align center"
        >
          <AlignCenter size={15} />
        </button>
        <button
          type="button"
          onClick={() => onChange({ textAlign: 'right' })}
          className={`flex h-full w-8 items-center justify-center ${textElement.textAlign === 'right' ? 'bg-blue-600 text-white' : 'hover:bg-[#303030]'}`}
          aria-label="Align right"
        >
          <AlignRight size={15} />
        </button>
      </div>

      <div className="relative">
        <button type="button" className={buttonClass} onClick={() => togglePopover('spacing')}>
          Spacing <ChevronDown size={14} />
        </button>
        {openPopover === 'spacing' && (
          <div className="absolute right-0 top-11 z-50 w-56 rounded-lg border border-zinc-700 bg-[#1f1f1f] p-3 shadow-xl">
            <label className="mb-2 flex items-center justify-between text-xs font-semibold text-zinc-400">
              <span>Letter</span>
              <span>{textElement.letterSpacing}</span>
            </label>
            <input
              type="range"
              min="-5"
              max="30"
              step="1"
              value={textElement.letterSpacing}
              onChange={(event) => onChange({ letterSpacing: Number(event.target.value) })}
              className="mb-4 w-full accent-blue-500"
              aria-label="Letter spacing"
            />
            <label className="mb-2 flex items-center justify-between text-xs font-semibold text-zinc-400">
              <span>Line</span>
              <span>{textElement.lineHeight.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="0.8"
              max="2.5"
              step="0.1"
              value={textElement.lineHeight}
              onChange={(event) => onChange({ lineHeight: Number(event.target.value) })}
              className="w-full accent-blue-500"
              aria-label="Line height"
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
        className="flex h-8 w-8 items-center justify-center rounded border border-red-500/40 bg-red-500/10 text-red-300 transition-colors hover:bg-red-500/20"
        aria-label="Delete text"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}
