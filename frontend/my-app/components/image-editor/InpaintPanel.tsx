"use client";

import React, { useRef, useState } from 'react';
import Image from 'next/image';
import {
  ChevronDown,
  Image as ImageIcon,
  Info,
  Loader2,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { generateInpaintImage } from '@/lib/api/image-generation';
import { cn } from '@/lib/utils';
import type { InpaintModel } from '@/lib/types/image-generation';
import type { InpaintExportResult } from '@/lib/types/layers.types';
import { ErrorBanner } from '@/components/ui/ErrorBanner';

type GenerationModel = {
  id: number;
  apiModel: InpaintModel;
  name: string;
  creator: string;
  tags: string[];
  thumbnail: string;
  description: string;
};

interface InpaintPanelProps {
  imageSrc: string | null;
  hasMask: boolean;
  results: string[];
  onBaseImageUpload: (src: string) => void;
  onResultsGenerated: (urls: string[]) => void;
  onResultSelect: (src: string) => void;
  onExportInpaintInputs: () => Promise<InpaintExportResult | null>;
}

const inpaintModels: GenerationModel[] = [
  {
    id: 1,
    apiModel: 'wavespeed-ai/flux-fill-dev',
    name: 'FLUX Fill Dev',
    creator: 'Black Forest Labs',
    tags: ['Precise', 'Mask'],
    thumbnail: 'from-cyan-800 via-blue-700 to-emerald-600',
    description: 'Best for strict brush-mask edits.',
  },
  {
    id: 2,
    apiModel: 'google/nano-banana-pro/edit',
    name: 'Nano Banana Pro',
    creator: 'Google',
    tags: ['Semantic', 'Pro'],
    thumbnail: 'from-yellow-800 via-orange-700 to-fuchsia-700',
    description: 'Best for high-quality guided edits.',
  },
];

const sizePresets = [
  'Square (1:1)',
  'Classic (4:3)',
  'Portrait (3:4)',
  'Landscape (16:9)',
  'Panoramic (21:9)',
];

const sizePresetToAspectRatio: Record<string, string> = {
  'Square (1:1)': '1:1',
  'Classic (4:3)': '4:3',
  'Portrait (3:4)': '3:4',
  'Landscape (16:9)': '16:9',
  'Panoramic (21:9)': '21:9',
};

const defaultModel = inpaintModels[0];

export default function InpaintPanel({
  imageSrc,
  hasMask,
  results,
  onBaseImageUpload,
  onResultsGenerated,
  onResultSelect,
  onExportInpaintInputs,
}: InpaintPanelProps) {
  const baseImageInputRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState<GenerationModel>(defaultModel);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [outputOpen, setOutputOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [numImages, setNumImages] = useState(1);
  const [sizePreset, setSizePreset] = useState('Square (1:1)');
  const [resolution, setResolution] = useState('1K');
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | Error>('');

  const canCreate = Boolean(imageSrc && prompt.trim() && hasMask && !isGenerating);

  const handleBaseImageFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';

    if (!file?.type.startsWith('image/')) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const result = loadEvent.target?.result;
      if (typeof result === 'string') {
        onBaseImageUpload(result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCreate = async () => {
    if (!canCreate) {
      return;
    }

    setErrorMessage('');
    setIsGenerating(true);

    try {
      const exportResult = await onExportInpaintInputs();
      if (!exportResult) {
        throw new Error('Draw a mask on the image before creating an inpaint edit.');
      }

      const formData = new FormData();
      formData.append('model', selectedModel.apiModel);
      formData.append('prompt', prompt.trim());
      formData.append('base_image', exportResult.baseFile);
      formData.append('mask_image', exportResult.maskFile);
      formData.append('aspect_ratio', sizePresetToAspectRatio[sizePreset] ?? '1:1');
      formData.append('resolution', resolution.toLowerCase());
      formData.append('output_format', 'png');
      formData.append('num_images', String(numImages));
      formData.append('source_width', String(exportResult.width));
      formData.append('source_height', String(exportResult.height));

      const response = await generateInpaintImage(formData);
      onResultsGenerated(response.images);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error : 'Inpaint generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="w-80 bg-[#1e1e1e] border-l border-zinc-800 flex flex-col h-full shrink-0 overflow-y-auto">
      <div className="flex items-center justify-between p-4 border-b border-zinc-800/50">
        <div className="flex items-center gap-2 text-zinc-100 font-medium">
          <Sparkles size={18} className="text-zinc-400" />
          <span>InPaint Area</span>
          <Info size={14} className="text-zinc-500" />
        </div>
      </div>

      <div className="p-4 space-y-5">
        <section className="space-y-3">
          <div className="flex items-center justify-between text-sm font-medium text-zinc-200">
            <span>Model</span>
            <button
              type="button"
              onClick={() => setIsModelSelectorOpen(true)}
              className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
            >
              Switch
            </button>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
            <div className="flex items-center gap-3">
              <div className={cn('h-10 w-10 rounded-lg bg-linear-to-br flex items-center justify-center', selectedModel.thumbnail)}>
                <ImageIcon size={18} className="text-white/70" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">{selectedModel.name}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="truncate text-xs text-zinc-500">{selectedModel.creator}</span>
                  <span className="rounded-sm bg-cyan-900/60 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-cyan-300">
                    wavespeed
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between text-sm font-medium text-zinc-200">
            <span>Base Image</span>
            <Info size={14} className="text-zinc-500" />
          </div>
          <button
            type="button"
            onClick={() => baseImageInputRef.current?.click()}
            className="group w-full rounded-lg border border-dashed border-zinc-700 bg-zinc-900/60 p-3 text-left transition-colors hover:border-blue-500"
          >
            <div className="flex items-center gap-3">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 flex items-center justify-center">
                {imageSrc ? (
                  <Image
                    src={imageSrc}
                    alt="Base image"
                    fill
                    sizes="56px"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <ImageIcon size={20} className="text-zinc-600" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-zinc-200">
                  {imageSrc ? 'Replace base image' : 'Upload base image'}
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  A brush mask is required before creating.
                </p>
              </div>
              <Upload size={16} className="ml-auto shrink-0 text-zinc-500 transition-colors group-hover:text-blue-400" />
            </div>
          </button>
          <input
            ref={baseImageInputRef}
            type="file"
            accept="image/*"
            title="Upload base image"
            aria-label="Upload base image"
            onChange={handleBaseImageFileChange}
            className="hidden"
          />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between text-sm font-medium text-zinc-200">
            <span>Prompt</span>
            <ChevronDown size={14} className="text-zinc-500" />
          </div>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="w-full h-24 bg-[#1a1a1a] border border-zinc-800 rounded-lg p-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 resize-none"
            placeholder="What do you want to generate in the selected area?"
          />
        </section>

        <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <button
            type="button"
            onClick={() => setSettingsOpen((current) => !current)}
            className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-900/70"
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal size={14} />
              Settings
            </span>
            <ChevronDown
              size={14}
              className={cn('text-zinc-500 transition-transform', settingsOpen && 'rotate-180')}
            />
          </button>

          <AnimatePresence initial={false}>
            {settingsOpen && (
              <motion.div
                key="inpaint-settings"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="space-y-3 border-t border-zinc-900 pt-3">
                  <button
                    type="button"
                    onClick={() => setOutputOpen((current) => !current)}
                    className="flex w-full items-center justify-between px-2 text-sm font-semibold text-zinc-200"
                  >
                    <span>Output Settings</span>
                    <ChevronDown
                      size={14}
                      className={cn('text-zinc-500 transition-transform', outputOpen && 'rotate-180')}
                    />
                  </button>

                  <AnimatePresence initial={false}>
                    {outputOpen && (
                      <motion.div
                        key="inpaint-output-settings"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-3 px-2">
                          <div>
                            <label htmlFor="inpaint-size-preset" className="mb-2 block text-xs text-zinc-500">
                              Size
                            </label>
                            <div className="relative">
                              <select
                                id="inpaint-size-preset"
                                value={sizePreset}
                                onChange={(event) => setSizePreset(event.target.value)}
                                className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 pr-9 text-sm text-zinc-300 focus:outline-none focus:border-zinc-700"
                              >
                                {sizePresets.map((preset) => (
                                  <option key={preset} value={preset}>
                                    {preset}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                            </div>
                          </div>

                          {selectedModel.apiModel === 'google/nano-banana-pro/edit' && (
                            <div className="space-y-2">
                              <div className="text-xs text-zinc-500">Resolution</div>
                              <div className="flex items-center gap-2">
                                {['1K', '2K', '4K'].map((value) => (
                                  <button
                                    key={value}
                                    type="button"
                                    onClick={() => setResolution(value)}
                                    className={cn(
                                      'flex-1 rounded-lg border py-1.5 text-xs font-bold transition-colors',
                                      resolution === value
                                        ? 'bg-blue-600/30 border-blue-500 text-white'
                                        : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300'
                                    )}
                                  >
                                    {value}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="border-t border-zinc-900 pt-3">
                    <button
                      type="button"
                      onClick={() => setAdvancedOpen((current) => !current)}
                      className="flex w-full items-center justify-between px-2 text-sm font-semibold text-zinc-200"
                    >
                      <span>Advanced Settings</span>
                      <ChevronDown
                        size={14}
                        className={cn('text-zinc-500 transition-transform', advancedOpen && 'rotate-180')}
                      />
                    </button>

                    <AnimatePresence initial={false}>
                      {advancedOpen && (
                        <motion.div
                          key="inpaint-advanced-settings"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="px-2 pt-3">
                            <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
                              <label htmlFor="inpaint-num-images" className="text-xs font-semibold text-zinc-300">
                                Number of Images
                              </label>
                              <input
                                id="inpaint-num-images"
                                type="number"
                                min={1}
                                max={4}
                                value={numImages}
                                onChange={(event) => {
                                  const nextValue = Number(event.target.value);
                                  setNumImages(Number.isNaN(nextValue) ? 1 : Math.min(4, Math.max(1, nextValue)));
                                }}
                                className="w-14 rounded-md border border-zinc-700 bg-zinc-800 py-1 text-center text-xs text-white focus:outline-none focus:border-zinc-500"
                              />
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <ErrorBanner error={errorMessage} onDismiss={() => setErrorMessage('')} compact className="rounded-lg leading-5" />

        <button
          type="button"
          disabled={!canCreate}
          onClick={handleCreate}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-medium transition-colors',
            canCreate
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-[#3a3a3a] text-zinc-500 cursor-not-allowed'
          )}
        >
          {isGenerating && <Loader2 size={16} className="animate-spin" />}
          {isGenerating ? 'Creating' : 'Create'}
        </button>

        <section className="space-y-3">
          <div className="flex items-center justify-between text-sm font-medium text-zinc-200">
            <span>Results</span>
            <span className="text-xs text-zinc-500">{results.length}</span>
          </div>
          {results.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {results.map((url, index) => (
                <button
                  key={`${url}-${index}`}
                  type="button"
                  onClick={() => onResultSelect(url)}
                  className="group relative aspect-square overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 text-left transition-colors hover:border-blue-500"
                >
                  <Image
                    src={url}
                    alt={`Inpaint result ${index + 1}`}
                    fill
                    sizes="128px"
                    className="object-cover"
                    unoptimized
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1 text-[10px] font-semibold text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100">
                    Replace base
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-6 text-center text-xs text-zinc-600">
              Generated edits will appear here.
            </div>
          )}
        </section>
      </div>

      <AnimatePresence>
        {isModelSelectorOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsModelSelectorOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: 20, scale: 0.97 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 20, scale: 0.97 }}
              transition={{ duration: 0.2 }}
              onClick={(event) => event.stopPropagation()}
              className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-zinc-900 px-5 py-4">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <ImageIcon size={16} className="text-zinc-400" />
                  Select Inpaint Model
                </div>
                <button
                  type="button"
                  title="Close"
                  aria-label="Close model selector"
                  onClick={() => setIsModelSelectorOpen(false)}
                  className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="grid gap-4 p-5 sm:grid-cols-2">
                {inpaintModels.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => {
                      setSelectedModel(model);
                      setIsModelSelectorOpen(false);
                    }}
                    className={cn(
                      'group overflow-hidden rounded-lg border bg-zinc-900 text-left transition-all hover:-translate-y-1 hover:border-zinc-700',
                      selectedModel.id === model.id ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-zinc-800'
                    )}
                  >
                    <div className={cn('aspect-4/3 bg-linear-to-br flex items-center justify-center relative', model.thumbnail)}>
                      <ImageIcon size={32} className="text-white/25" />
                      <div className="absolute left-2 top-2 flex flex-wrap gap-1 pr-2">
                        {model.tags.map((tag) => (
                          <span key={tag} className="rounded bg-black/60 px-2 py-0.5 text-[9px] font-bold text-white backdrop-blur-sm">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1 p-3">
                      <h3 className="truncate text-sm font-bold text-white">{model.name}</h3>
                      <p className="truncate text-xs text-zinc-500">{model.creator}</p>
                      <p className="text-xs leading-5 text-zinc-400">{model.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
