"use client";
import React from 'react';
import { Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, Trash2 } from 'lucide-react';
import ColorPicker from './ColorPicker';
import { TextProperties, AVAILABLE_FONTS } from '@/lib/types/layers.types';
import { cn } from '@/lib/utils';

interface TextPropertiesPanelProps {
  properties: TextProperties;
  onChange: (properties: Partial<TextProperties>) => void;
  onDelete?: () => void;
}

export default function TextPropertiesPanel({ 
  properties, 
  onChange,
  onDelete 
}: TextPropertiesPanelProps) {
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">Text Properties</h3>
        {onDelete && (
          <button
            onClick={onDelete}
            className="p-1 rounded-md text-zinc-500 hover:text-red-500 hover:bg-zinc-900 transition-colors"
            title="Delete text layer"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* Font Family */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-zinc-300">
          Font Family
        </label>
        <select
          value={properties.fontFamily}
          onChange={(e) => onChange({ fontFamily: e.target.value })}
          title="Select font family"
          className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-md px-2.5 py-1.5 focus:outline-none focus:border-zinc-700 transition-colors cursor-pointer"
        >
          {AVAILABLE_FONTS.map((font) => (
            <option key={font.value} value={font.value}>
              {font.label}
            </option>
          ))}
        </select>
      </div>

      {/* Font Size */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-zinc-300">Font Size</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={properties.fontSize}
              onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
              min="12"
              max="200"
              title="Font size in pixels"
              className="w-14 bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs rounded-md px-1.5 py-1 text-center focus:outline-none focus:border-zinc-700"
            />
            <span className="text-xs text-zinc-500">px</span>
          </div>
        </div>
        <input
          type="range"
          min="12"
          max="200"
          step="1"
          value={properties.fontSize}
          onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
          aria-label="Font size slider"
          className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer 
            [&::-webkit-slider-thumb]:appearance-none 
            [&::-webkit-slider-thumb]:w-4 
            [&::-webkit-slider-thumb]:h-4 
            [&::-webkit-slider-thumb]:rounded-full 
            [&::-webkit-slider-thumb]:bg-white 
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:shadow-lg"
        />
      </div>

      {/* Text Style Buttons */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-zinc-300">Text Style</label>
        <div className="grid grid-cols-3 overflow-hidden rounded-md border border-zinc-800 bg-zinc-900">
          <button
            onClick={() => onChange({ 
              fontWeight: properties.fontWeight === 'bold' ? 'normal' : 'bold' 
            })}
            className={cn(
              "flex items-center justify-center px-2 py-1.5 text-sm transition-all",
              properties.fontWeight === 'bold'
                ? "bg-white text-black"
                : "text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800"
            )}
            title="Bold"
          >
            <Bold size={16} />
          </button>
          
          <button
            onClick={() => onChange({ 
              fontStyle: properties.fontStyle === 'italic' ? 'normal' : 'italic' 
            })}
            className={cn(
              "flex items-center justify-center border-x border-zinc-800 px-2 py-1.5 text-sm transition-all",
              properties.fontStyle === 'italic'
                ? "bg-white text-black"
                : "text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800"
            )}
            title="Italic"
          >
            <Italic size={16} />
          </button>
          
          <button
            onClick={() => onChange({ 
              textDecoration: properties.textDecoration === 'underline' ? 'none' : 'underline' 
            })}
            className={cn(
              "flex items-center justify-center px-2 py-1.5 text-sm transition-all",
              properties.textDecoration === 'underline'
                ? "bg-white text-black"
                : "text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800"
            )}
            title="Underline"
          >
            <Underline size={16} />
          </button>
        </div>
      </div>

      {/* Text Alignment */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-zinc-300">Text Alignment</label>
        <div className="grid grid-cols-3 overflow-hidden rounded-md border border-zinc-800 bg-zinc-900">
          <button
            onClick={() => onChange({ textAlign: 'left' })}
            className={cn(
              "flex items-center justify-center py-1.5 transition-all",
              properties.textAlign === 'left'
                ? "bg-white text-black"
                : "text-zinc-400 hover:text-zinc-300"
            )}
            title="Align Left"
          >
            <AlignLeft size={16} />
          </button>
          
          <button
            onClick={() => onChange({ textAlign: 'center' })}
            className={cn(
              "flex items-center justify-center border-x border-zinc-800 py-1.5 transition-all",
              properties.textAlign === 'center'
                ? "bg-white text-black"
                : "text-zinc-400 hover:text-zinc-300"
            )}
            title="Align Center"
          >
            <AlignCenter size={16} />
          </button>
          
          <button
            onClick={() => onChange({ textAlign: 'right' })}
            className={cn(
              "flex items-center justify-center py-1.5 transition-all",
              properties.textAlign === 'right'
                ? "bg-white text-black"
                : "text-zinc-400 hover:text-zinc-300"
            )}
            title="Align Right"
          >
            <AlignRight size={16} />
          </button>
        </div>
      </div>

      {/* Text Color */}
      <ColorPicker
        label="Text Color"
        color={properties.color}
        onChange={(color) => onChange({ color })}
      />

      {/* Stroke Settings */}
      <div className="space-y-2.5 pt-2.5 border-t border-zinc-900">
        <ColorPicker
          label="Stroke Color"
          color={properties.strokeColor}
          onChange={(strokeColor) => onChange({ strokeColor })}
        />

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-zinc-300">Stroke Width</label>
            <span className="text-xs font-bold text-white tabular-nums">{properties.strokeWidth}px</span>
          </div>
          <input
            type="range"
            min="0"
            max="10"
            step="1"
            value={properties.strokeWidth}
            onChange={(e) => onChange({ strokeWidth: Number(e.target.value) })}
            aria-label="Stroke width slider"
            className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer 
              [&::-webkit-slider-thumb]:appearance-none 
              [&::-webkit-slider-thumb]:w-4 
              [&::-webkit-slider-thumb]:h-4 
              [&::-webkit-slider-thumb]:rounded-full 
              [&::-webkit-slider-thumb]:bg-white 
              [&::-webkit-slider-thumb]:cursor-pointer
              [&::-webkit-slider-thumb]:shadow-lg"
          />
        </div>
      </div>

      {/* Letter Spacing */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-zinc-300">Letter Spacing</label>
          <span className="text-xs font-bold text-white tabular-nums">{properties.letterSpacing}</span>
        </div>
        <input
          type="range"
          min="-5"
          max="20"
          step="1"
          value={properties.letterSpacing}
          onChange={(e) => onChange({ letterSpacing: Number(e.target.value) })}
          aria-label="Letter spacing slider"
          className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer 
            [&::-webkit-slider-thumb]:appearance-none 
            [&::-webkit-slider-thumb]:w-4 
            [&::-webkit-slider-thumb]:h-4 
            [&::-webkit-slider-thumb]:rounded-full 
            [&::-webkit-slider-thumb]:bg-white 
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:shadow-lg"
        />
      </div>

      {/* Line Height */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-zinc-300">Line Height</label>
          <span className="text-xs font-bold text-white tabular-nums">{properties.lineHeight.toFixed(1)}</span>
        </div>
        <input
          type="range"
          min="0.8"
          max="2.5"
          step="0.1"
          value={properties.lineHeight}
          onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
          aria-label="Line height slider"
          className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer 
            [&::-webkit-slider-thumb]:appearance-none 
            [&::-webkit-slider-thumb]:w-4 
            [&::-webkit-slider-thumb]:h-4 
            [&::-webkit-slider-thumb]:rounded-full 
            [&::-webkit-slider-thumb]:bg-white 
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:shadow-lg"
        />
      </div>
    </div>
  );
}
