"use client";
import React, { useState, useRef, useEffect } from 'react';
import { HexColorPicker } from 'react-colorful';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  label?: string;
}

export default function ColorPicker({ color, onChange, label }: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(color);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(color);
  }, [color]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    
    // Validate hex color
    if (/^#[0-9A-F]{6}$/i.test(value)) {
      onChange(value);
    }
  };

  const handleInputBlur = () => {
    // Reset to current color if invalid
    if (!/^#[0-9A-F]{6}$/i.test(inputValue)) {
      setInputValue(color);
    }
  };

  return (
    <div className="relative" ref={pickerRef}>
      {label && (
        <label className="block text-xs font-semibold text-zinc-300 mb-2">
          {label}
        </label>
      )}
      
      <div className="flex items-center gap-2">
        {/* Color Swatch Button */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-10 h-10 rounded-lg border-2 border-zinc-800 hover:border-zinc-700 transition-colors cursor-pointer shadow-inner [background-color:var(--swatch-color)]"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {...({ style: { '--swatch-color': color } } as any)}
          title="Click to open color picker"
        />

        {/* Hex Input */}
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          className="flex-1 bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-zinc-700 transition-colors font-mono uppercase"
          placeholder="#FFFFFF"
          maxLength={7}
        />
      </div>

      {/* Color Picker Popover */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 mt-2 p-3 bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl"
          >
            <HexColorPicker color={color} onChange={onChange} />
            
            {/* Preset Colors */}
            <div className="mt-3 pt-3 border-t border-zinc-800">
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Presets
              </p>
              <div className="grid grid-cols-8 gap-1.5">
                {PRESET_COLORS.map((presetColor) => (
                  <button
                    key={presetColor}
                    onClick={() => onChange(presetColor)}
                    className={cn(
                      "w-6 h-6 rounded border-2 transition-all hover:scale-110 [background-color:var(--preset-color)]",
                      color.toLowerCase() === presetColor.toLowerCase()
                        ? "border-white shadow-lg"
                        : "border-zinc-800 hover:border-zinc-700"
                    )}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    {...({ style: { '--preset-color': presetColor } } as any)}
                    title={presetColor}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const PRESET_COLORS = [
  '#FFFFFF', '#000000', '#FF0000', '#00FF00',
  '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
  '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
];
