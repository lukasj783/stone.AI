"use client";
import React, { useState } from 'react';
import {
  CreditCard,
  ChevronDown,
  ChevronLeft,
  Maximize2,
  Search,
  SlidersHorizontal,
  Star,
  LayoutTemplate,
  FolderOpen,
  Clock,
  Layers,
  Zap,
  Image as ImageIcon,
  Info,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { usePathname } from 'next/navigation';
import { generateImage } from '@/lib/api/image-generation';
import { ImageModel as ApiImageModel } from '@/lib/types/image-generation';
import ImagePreviewModal, { ImagePreview } from '@/components/ui/ImagePreviewModal';

type GenerationModel = {
  id: number;
  apiModel: ApiImageModel | string;
  name: string;
  creator: string;
  tags: string[];
  thumbnail: string;
  provider: 'replicate' | 'wavespeed';
};

const sampleModels: GenerationModel[] = [
  {
    id: 1,
    apiModel: 'nanobanana',
    name: 'Nanobanana Pro',
    creator: 'Google',
    tags: ['Standard'],
    thumbnail: 'from-fuchsia-900 via-purple-900 to-indigo-900',
    provider: 'replicate',
  },
  {
    id: 101,
    apiModel: 'google/nano-banana-pro/text-to-image-multi',
    name: 'Nanobanana Multi',
    creator: 'Google',
    tags: ['Standard', 'Multi'],
    thumbnail: 'from-fuchsia-900 via-purple-900 to-indigo-900',
    provider: 'wavespeed',
  },
  {
    id: 6,
    apiModel: 'nanobanana2',
    name: 'Nanobanana 2',
    creator: 'Google',
    tags: ['Standard', 'Search'],
    thumbnail: 'from-yellow-900 via-orange-900 to-amber-900',
    provider: 'replicate',
  },
  {
    id: 106,
    apiModel: 'google/nano-banana-2/text-to-image',
    name: 'Nanobanana 2',
    creator: 'Google',
    tags: ['Standard', 'Search'],
    thumbnail: 'from-yellow-900 via-orange-900 to-amber-900',
    provider: 'wavespeed',
  },
  {
    id: 2,
    apiModel: 'seedream45',
    name: 'Seedream 4.5',
    creator: 'Byteplus',
    tags: ['Standard'],
    thumbnail: 'from-blue-900 via-indigo-900 to-purple-900',
    provider: 'replicate',
  },
  {
    id: 102,
    apiModel: 'bytedance/seedream-v4.5',
    name: 'Seedream 4.5',
    creator: 'Byteplus',
    tags: ['Standard'],
    thumbnail: 'from-blue-900 via-indigo-900 to-purple-900',
    provider: 'wavespeed',
  },
  {
    id: 103,
    apiModel: 'bytedance/seedream-v5.0-lite',
    name: 'Seedream 5 Lite',
    creator: 'Byteplus',
    tags: ['Standard', 'Fast'],
    thumbnail: 'from-indigo-900 via-purple-900 to-pink-900',
    provider: 'wavespeed',
  },
  {
    id: 3,
    apiModel: 'qwen',
    name: 'Qwen Image 2512',
    creator: 'Qwen',
    tags: ['Fast', 'High Quality'],
    thumbnail: 'from-cyan-900 via-teal-900 to-green-900',
    provider: 'replicate',
  },
  {
    id: 4,
    apiModel: 'z-image',
    name: 'Z-Image Turbo',
    creator: 'Pruna AI',
    tags: ['Turbo', 'Realistic'],
    thumbnail: 'from-amber-900 via-orange-900 to-red-900',
    provider: 'replicate',
  },
  {
    id: 5,
    apiModel: 'flux-klein',
    name: 'FLUX.2 [klein] 9B',
    creator: 'Black Forest Labs',
    tags: ['Fast', 'Realistic'],
    thumbnail: 'from-blue-600 via-sky-500 to-cyan-400',
    provider: 'replicate',
  },
];

const modelCategories = ['Standard', 'Fast', 'High Quality', 'Turbo', 'Realistic'];
const modelTabs = ['Public Models', 'My Trained Models', 'My Characters', 'Character Library'];

const galleryTabs = [
  { label: 'Generation', icon: LayoutTemplate },
  { label: 'Albums', icon: FolderOpen },
  { label: 'Editing History', icon: Clock },
  { label: 'Bulk Create', icon: Layers },
];

const sizePresetToAspectRatio: Record<string, string> = {
  'Classic (4:3)': '4:3',
  'Square (1:1)': '1:1',
  'Portrait (3:4)': '3:4',
  'Landscape (16:9)': '16:9',
  'Panoramic (21:9)': '21:9',
  'Cinematic (2.39:1)': '2.39:1',
};

export default function CreateImagePage() {
  const pathname = usePathname();
  
  const secondaryNav = [
    { label: 'Image Home', href: '/image' },
    { label: 'Create Image', href: '/image/create' },
    { label: 'Edit Image', href: '/image/edit' },
    { label: 'Chat to Edit', href: '/image/chat' },
    { label: 'Face Swap', href: '/image/face-swap' },
    { label: 'Character', href: '/image/character' },
    { label: 'Multiple Angle', href: '/image/multiple-angle' },
    { label: 'Image Upscale', href: '/image/upscale' },
    { label: 'Train a Model', href: '/image/train' },
  ];
  
  const [prompt, setPrompt] = useState('');
  const [numImages, setNumImages] = useState(1);
  const [activeGalleryTab, setActiveGalleryTab] = useState('Generation');
  const [customSettings, setCustomSettings] = useState('None');
  const [isGenerating, setIsGenerating] = useState(false);
  const [sizePreset, setSizePreset] = useState('Classic (4:3)');
  const [resolution, setResolution] = useState('1K');
  const [guidanceOpen, setGuidanceOpen] = useState(true);
  const [outputOpen, setOutputOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [selectedModelTab, setSelectedModelTab] = useState('Public Models');
  const [selectedCategory, setSelectedCategory] = useState('Standard');
  const [selectedModel, setSelectedModel] = useState(sampleModels[0]);
  const [generatedImages, setGeneratedImages] = useState<ImagePreview[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [generationError, setGenerationError] = useState('');
  const [createAlbumOpen, setCreateAlbumOpen] = useState(false);
  const [albumName, setAlbumName] = useState('');
  const [albumDescription, setAlbumDescription] = useState('');
  const [albums, setAlbums] = useState<Array<{ id: number; name: string; description: string; imageCount: number }>>([]);

  const handleCreateAlbum = () => {
    if (!albumName.trim()) return;
    const newAlbum = {
      id: Date.now(),
      name: albumName,
      description: albumDescription,
      imageCount: 0,
    };
    setAlbums([...albums, newAlbum]);
    setAlbumName('');
    setAlbumDescription('');
    setCreateAlbumOpen(false);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setGenerationError('');
    setIsGenerating(true);
    try {
      const payload: any = {
        model: selectedModel.apiModel,
        provider: selectedModel.provider,
        prompt,
        aspect_ratio: sizePresetToAspectRatio[sizePreset] ?? '1:1',
        num_images: numImages,
      };

      if (selectedModel.apiModel === 'nanobanana2') {
        payload.resolution = resolution.toLowerCase();
        payload.image_search = true;
        payload.google_search = true;
        payload.output_format = 'jpg';
      }

      const response = await generateImage(payload);

      const newImages = response.images.map((url) => ({
        id: crypto.randomUUID(),
        url,
        prompt,
        model: selectedModel.name,
        aspect_ratio: sizePreset,
        width: 0, // Placeholder
        height: 0 // Placeholder
      }));

      setGeneratedImages(newImages);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image generation failed';
      setGenerationError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      <div className="flex flex-col lg:flex-row gap-5">
        {/* ── Secondary Sidebar ── */}
        <aside className="lg:w-52 space-y-8 shrink-0">
          <div className="space-y-4">
            <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest px-4">
              Image Controls
            </h3>
            <div className="space-y-1">
              {secondaryNav.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className={cn(
                    'w-full flex items-center justify-between px-4 py-2.5 rounded-lg text-sm font-bold transition-all',
                    pathname === item.href
                      ? 'bg-zinc-900 text-white border border-zinc-800'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40'
                  )}
                >
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Credits Box */}
          <div className="p-5 rounded-2xl bg-linear-to-br from-zinc-900 to-black border border-zinc-800 space-y-4">
            <div className="flex items-center gap-2 text-zinc-400">
              <CreditCard size={14} />
              <span className="text-[10px] font-bold uppercase tracking-wider">
                Remaining Credits
              </span>
            </div>
            <div className="space-y-1">
              <div className="text-2xl font-black text-white">0 / 40</div>
              <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div className="w-0 h-full bg-yellow-500" />
              </div>
              <p className="text-[10px] text-zinc-600">trial credits left</p>
            </div>
            <button className="w-full py-2 rounded-lg bg-yellow-500 text-black text-xs font-bold hover:bg-yellow-400 transition-colors">
              Upgrade Now
            </button>
          </div>
        </aside>

        {/* ── Middle Panel: Controls ── */}
        <div className="lg:w-80 xl:w-96 shrink-0 space-y-4">
          {/* Custom Settings */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-300">
              <SlidersHorizontal size={14} />
              <span>Custom Settings</span>
              <Info size={12} className="text-zinc-600" />
            </div>
            <div className="relative">
              <select
                value={customSettings}
                onChange={(e) => setCustomSettings(e.target.value)}
                title="Custom Settings"
                aria-label="Custom Settings"
                className="w-full appearance-none bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-xl px-4 py-3 pr-10 focus:outline-none focus:border-zinc-700 cursor-pointer"
              >
                <option value="None">None</option>
                <option value="Cinematic">Cinematic</option>
                <option value="Portrait">Portrait</option>
                <option value="Landscape">Landscape</option>
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
            </div>
          </div>

          {/* Model or Character */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-300">
              <span>Model or Character</span>
              <ChevronDown size={14} className="text-zinc-600" />
            </div>
            <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-linear-to-r from-purple-900/40 via-indigo-900/30 to-zinc-900 p-3 flex items-center justify-between gap-3">
              {/* Model thumbnail preview */}
              <div className="flex items-center gap-3 min-w-0">
                <div className={cn("w-14 h-14 rounded-lg overflow-hidden shrink-0 bg-linear-to-br flex items-center justify-center", selectedModel.thumbnail)}>
                  <ImageIcon size={20} className="text-white/50" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-white truncate">{selectedModel.name}</p>
                    <span className={cn("text-[8px] font-bold px-1.5 py-0.5 flex items-center justify-center rounded-sm uppercase tracking-wider", selectedModel.provider === 'wavespeed' ? "bg-cyan-900/50 text-cyan-400" : "bg-purple-900/50 text-purple-400")}>{selectedModel.provider}</span>
                  </div>
                  <p className="text-[10px] text-zinc-500">{selectedModel.creator}</p>
                </div>
              </div>
              <button
                onClick={() => setModelSelectorOpen(true)}
                className="shrink-0 flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-3 py-1.5 rounded-lg border border-white/10 transition-colors"
              >
                Switch
                <ChevronRight size={12} />
              </button>
            </div>
          </div>

          {/* Prompt */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-300">
              <span>Prompt</span>
              <Info size={12} className="text-zinc-600" />
              <ChevronDown size={14} className="text-zinc-600" />
            </div>
            <div className="relative bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden focus-within:border-zinc-600 transition-colors">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. A cat is sitting on a table. We support all languages."
                rows={5}
                className="w-full bg-transparent text-zinc-200 placeholder:text-zinc-600 text-sm px-4 pt-3 pb-10 resize-none focus:outline-none"
              />
              <button className="absolute bottom-2.5 left-3 flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-[11px] font-semibold border border-zinc-800 hover:border-zinc-600 bg-zinc-900 px-2.5 py-1.5 rounded-lg transition-all">
                <ImageIcon size={12} />
                Image to Prompt
              </button>
              <button
                title="Expand prompt"
                aria-label="Expand prompt"
                onClick={() => setPromptExpanded(true)}
                className="absolute bottom-2.5 right-3 text-zinc-600 hover:text-zinc-300 transition-colors"
              >
                <Maximize2 size={14} />
              </button>
            </div>
          </div>

          {/* Configuration & Settings */}
          <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-3">
            <button
              onClick={() => setGuidanceOpen((prev) => !prev)}
              className="w-full flex items-center justify-between text-sm font-semibold text-zinc-200 px-2 py-2 rounded-lg hover:bg-zinc-900/60 transition-colors"
            >
              <span className="flex items-center gap-2">
                <SlidersHorizontal size={14} />
                Image Guidance
              </span>
              <ChevronDown
                size={14}
                className={cn('text-zinc-500 transition-transform', guidanceOpen && 'rotate-180')}
              />
            </button>

            <AnimatePresence initial={false}>
              {guidanceOpen && (
                <motion.div
                  key="guidance-body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-zinc-900 pt-3 space-y-3">
                    <button
                      onClick={() => setOutputOpen((prev) => !prev)}
                      className="w-full flex items-center justify-between px-2"
                    >
                      <div className="text-sm font-semibold text-zinc-200">Output Settings</div>
                      <ChevronDown
                        size={14}
                        className={cn('text-zinc-500 transition-transform', outputOpen && 'rotate-180')}
                      />
                    </button>

                    <AnimatePresence initial={false}>
                      {outputOpen && (
                        <motion.div
                          key="output-body"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="space-y-2 px-2">
                            <div className="flex items-center justify-between text-xs text-zinc-500">
                              <span>Size</span>
                              <span className="text-emerald-400">Upgrade</span>
                            </div>
                            <div className="relative">
                              <select
                                value={sizePreset}
                                onChange={(e) => setSizePreset(e.target.value)}
                                title="Output size"
                                aria-label="Output size"
                                className="w-full appearance-none bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2 pr-9 focus:outline-none focus:border-zinc-700"
                              >
                                <option value="Classic (4:3)">Classic (4:3)</option>
                                <option value="Square (1:1)">Square (1:1)</option>
                                <option value="Portrait (3:4)">Portrait (3:4)</option>
                                <option value="Landscape (16:9)">Landscape (16:9)</option>
                                <option value="Panoramic (21:9)">Panoramic (21:9)</option>
                                <option value="Cinematic (2.39:1)">Cinematic (2.39:1)</option>
                              </select>
                              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                            </div>

                            <div className="space-y-2">
                              <div className="text-xs text-zinc-500">Resolution</div>
                              <div className="flex items-center gap-2">
                                {['1K', '2K', '4K'].map((value) => (
                                  <button
                                    key={value}
                                    onClick={() => setResolution(value)}
                                    className={cn(
                                      'flex-1 rounded-lg border text-xs font-bold py-1.5 transition-colors',
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
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="border-t border-zinc-900 pt-3 space-y-3">
                    <button
                      onClick={() => setAdvancedOpen((prev) => !prev)}
                      className="w-full flex items-center justify-between px-2"
                    >
                      <div className="text-sm font-semibold text-zinc-200">Advanced Settings</div>
                      <ChevronDown
                        size={14}
                        className={cn('text-zinc-500 transition-transform', advancedOpen && 'rotate-180')}
                      />
                    </button>

                    <AnimatePresence initial={false}>
                      {advancedOpen && (
                        <motion.div
                          key="advanced-body"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="space-y-3 px-2">
                            <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
                              <span className="text-xs font-semibold text-zinc-300">Number of Images</span>
                              <input
                                type="number"
                                min={1}
                                max={8}
                                value={numImages}
                                onChange={(e) => {
                                  const nextValue = Number(e.target.value);
                                  const normalized = Number.isNaN(nextValue)
                                    ? 1
                                    : Math.min(8, Math.max(1, nextValue));
                                  setNumImages(normalized);
                                }}
                                title="Number of images"
                                aria-label="Number of images"
                                className="w-14 bg-zinc-800 border border-zinc-700 text-white text-xs text-center rounded-md py-1 focus:outline-none focus:border-zinc-500"
                              />
                            </div>

                            <div className="flex items-center gap-3">
                              <div className="w-9 h-5 bg-zinc-700 rounded-full relative cursor-not-allowed opacity-50">
                                <div className="w-4 h-4 bg-zinc-400 rounded-full absolute top-0.5 left-0.5 transition-transform" />
                              </div>
                              <span className="text-xs text-zinc-600">Batch mode</span>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Generate Button */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleGenerate}
            disabled={isGenerating}
            className={cn(
              'w-full py-3.5 rounded-xl font-bold text-sm transition-all',
              !prompt.trim()
                ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                : 'bg-linear-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-500 hover:to-indigo-500 shadow-lg shadow-purple-500/20'
            )}
          >
            {isGenerating ? (
              <span className="flex items-center justify-center gap-2">
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                  className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                />
                Generating...
              </span>
            ) : (
              'Create'
            )}
          </motion.button>

          {/* Credits info */}
          <div className="text-center space-y-1">
            {generationError && (
              <p className="text-xs text-red-400 font-semibold">{generationError}</p>
            )}
            <p className="text-xs text-emerald-400 font-semibold flex items-center justify-center gap-1.5">
              <Zap size={11} />
              40 credits will be charged
            </p>
            <p className="text-[11px] text-zinc-600">
              <span className="text-zinc-400 underline cursor-pointer hover:text-white transition-colors">Upgrade</span>
              {' '}to enjoy speed boost
            </p>
          </div>
        </div>

        {/* ── Right Panel: Gallery ── */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Gallery Tabs */}
          <div className="flex items-center gap-1 border-b border-zinc-800 overflow-x-auto scrollbar-none">
            {galleryTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeGalleryTab === tab.label;
              return (
                <button
                  key={tab.label}
                  onClick={() => setActiveGalleryTab(tab.label)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-all',
                    isActive
                      ? 'border-blue-500 text-white'
                      : 'border-transparent text-zinc-500 hover:text-zinc-300'
                  )}
                >
                  <Icon size={14} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Search + Filters */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Search image by prompt and similarity"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 pl-9 pr-4 text-sm text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
              />
            </div>
            <button className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-600 text-zinc-400 hover:text-zinc-200 text-sm font-semibold px-4 py-2.5 rounded-xl transition-all shrink-0">
              <SlidersHorizontal size={14} />
              Filters
            </button>
            <button title="Starred" aria-label="Starred" className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-yellow-400 hover:border-zinc-600 transition-all shrink-0">
              <Star size={16} />
            </button>
          </div>

          {/* Private creations banner */}
          <div className="flex items-center justify-between gap-4 bg-emerald-950/50 border border-emerald-800/50 rounded-xl px-4 py-3">
            <div className="flex items-start gap-3 min-w-0">
              <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-sm text-zinc-300">
                Your private creations will be stored for{' '}
                <span className="font-bold text-white">7 days</span>.{' '}
                Upgrade now to unlock unlimited private history.
              </p>
            </div>
            <button className="shrink-0 bg-white text-black text-xs font-bold px-4 py-2 rounded-lg hover:bg-zinc-200 transition-colors whitespace-nowrap">
              Upgrade Now
            </button>
          </div>

          {/* Image Gallery */}
          <AnimatePresence mode="wait">
            {activeGalleryTab === 'Generation' && (
              <motion.div
                key="generation"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5"
              >
                {generatedImages.length > 0
                  ? generatedImages.map((image, index) => (
                      <motion.div
                        key={`${image.id}-${index}`}
                        whileHover={{ scale: 1.03, zIndex: 10 }}
                        className="aspect-square rounded-xl bg-zinc-900 cursor-pointer overflow-hidden group relative border border-zinc-800/50"
                        onClick={() => setPreviewIndex(index)}
                      >
                        <img
                          src={image.url}
                          alt={`Generated image ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2 gap-1">
                          <button
                            title="Save image"
                            aria-label="Save image"
                            className="text-zinc-300 hover:text-white transition-colors p-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              // handleSave logic here
                            }}
                          >
                            <Star size={14} />
                          </button>
                        </div>
                      </motion.div>
                    ))
                  : !isGenerating && (
                      <div className="col-span-full flex flex-col items-center justify-center py-16 text-zinc-600 border border-zinc-800 rounded-xl bg-zinc-900/30">
                        <ImageIcon size={36} strokeWidth={1.5} className="mb-3" />
                        <p className="text-sm font-semibold">No generated images yet</p>
                        <p className="text-xs mt-1">Create an image to see results here.</p>
                      </div>
                    )}

                {/* Loading skeleton if generating */}
                {isGenerating &&
                  Array.from({ length: numImages }).map((_, i) => (
                    <div
                      key={`skeleton-${i}`}
                      className="aspect-square rounded-xl bg-zinc-900 border border-zinc-800 animate-pulse flex items-center justify-center"
                    >
                      <motion.span
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
                        className="inline-block w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full"
                      />
                    </div>
                  ))}
              </motion.div>
            )}

            {activeGalleryTab === 'Albums' && (
              <motion.div
                key="albums"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {albums.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-white">My Albums</h3>
                      <button
                        onClick={() => setCreateAlbumOpen(true)}
                        className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                      >
                        <FolderOpen size={14} />
                        New Album
                      </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {albums.map((album) => (
                        <motion.div
                          key={album.id}
                          whileHover={{ y: -4 }}
                          className="group cursor-pointer rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden hover:border-zinc-700 transition-all p-4"
                        >
                          <div className="aspect-square rounded-lg bg-zinc-800 flex items-center justify-center mb-3">
                            <FolderOpen size={32} className="text-zinc-600" />
                          </div>
                          <h4 className="text-sm font-bold text-white truncate">{album.name}</h4>
                          {album.description && (
                            <p className="text-xs text-zinc-500 mt-1 truncate">{album.description}</p>
                          )}
                          <p className="text-xs text-zinc-600 mt-2">{album.imageCount} images</p>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
                    <FolderOpen size={48} strokeWidth={1} className="mb-4" />
                    <p className="text-base font-semibold">No Albums Yet</p>
                    <p className="text-sm mt-1 mb-4">Create your first album to organize images.</p>
                    <button
                      onClick={() => setCreateAlbumOpen(true)}
                      className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
                    >
                      <FolderOpen size={14} />
                      Create Album
                    </button>
                  </div>
                )}
              </motion.div>
            )}

            {activeGalleryTab !== 'Generation' && activeGalleryTab !== 'Albums' && (
              <motion.div
                key={activeGalleryTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col items-center justify-center py-20 text-zinc-600"
              >
                <FolderOpen size={48} strokeWidth={1} className="mb-4" />
                <p className="text-base font-semibold">No {activeGalleryTab} found</p>
                <p className="text-sm mt-1">Items will appear here once created.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {promptExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPromptExpanded(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: 20, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 20, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              onClick={(event) => event.stopPropagation()}
              className="w-[min(780px,92vw)] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-900">
                <div className="text-sm font-semibold text-white">Expanded Prompt</div>
                <button
                  title="Close"
                  aria-label="Close"
                  onClick={() => setPromptExpanded(false)}
                  className="text-zinc-500 hover:text-zinc-200"
                >
                  ✕
                </button>
              </div>
              <div className="p-5 space-y-4">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe what you want to generate..."
                  rows={10}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-zinc-600"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setPromptExpanded(false)}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Model Selection Modal */}
      <AnimatePresence>
        {modelSelectorOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setModelSelectorOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ y: 20, scale: 0.97 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 20, scale: 0.97 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-6xl h-[85vh] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-900 shrink-0">
                <button
                  onClick={() => setModelSelectorOpen(false)}
                  className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
                >
                  <ChevronLeft size={16} />
                  <span className="text-sm font-semibold">Back</span>
                </button>
                <button
                  title="Close"
                  aria-label="Close"
                  onClick={() => setModelSelectorOpen(false)}
                  className="text-zinc-500 hover:text-zinc-200 text-xl"
                >
                  ✕
                </button>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 px-6 pt-4 border-b border-zinc-900 shrink-0 overflow-x-auto scrollbar-none">
                {modelTabs.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setSelectedModelTab(tab)}
                    className={cn(
                      'px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 transition-all',
                      selectedModelTab === tab
                        ? 'border-white text-white'
                        : 'border-transparent text-zinc-500 hover:text-zinc-300'
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Search & Categories */}
              <div className="px-6 py-4 space-y-4 border-b border-zinc-900 shrink-0">
                <div className="relative max-w-md">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Search All Models"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-2.5 pl-10 pr-4 text-sm text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
                  />
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-zinc-500 font-semibold">Category:</span>
                  {modelCategories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={cn(
                        'px-3 py-1 rounded-full text-xs font-semibold transition-colors',
                        selectedCategory === cat
                          ? 'bg-zinc-700 text-white'
                          : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Models Grid */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {sampleModels
                    .filter((model) =>
                      selectedCategory === 'Standard'
                        ? true
                        : model.tags.includes(selectedCategory)
                    )
                    .map((model) => (
                      <motion.div
                        key={model.id}
                        whileHover={{ y: -4 }}
                        onClick={() => {
                          setSelectedModel(model);
                          setModelSelectorOpen(false);
                        }}
                        className="group cursor-pointer rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden hover:border-zinc-700 transition-all"
                      >
                        <div
                          className={cn(
                            'aspect-4/3 bg-linear-to-br',
                            model.thumbnail,
                            'flex items-center justify-center relative'
                          )}
                        >
                          <ImageIcon size={32} className="text-white/20" />
                          <div className="absolute top-2 left-2 flex gap-1">
                            {model.tags.map((tag) => (
                              <span
                                key={tag}
                                className="bg-black/60 backdrop-blur-sm text-white text-[9px] font-bold px-2 py-0.5 rounded"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          <button title="View details" aria-label="View details" className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-black/60 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 transition-opacity">
                            <FolderOpen size={14} />
                          </button>
                        </div>
                        <div className="p-3 space-y-1">
                          <h3 className="text-sm font-bold text-white truncate">{model.name}</h3>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="text-xs text-zinc-500 truncate">{model.creator}</p>
                            <span className={cn("text-[9px] font-bold px-1.5 py-0.5 flex items-center justify-center rounded-sm uppercase tracking-wider shrink-0", model.provider === 'wavespeed' ? "bg-cyan-900/50 text-cyan-400" : "bg-purple-900/50 text-purple-400")}>{model.provider}</span>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                </div>

                {sampleModels.filter((model) =>
                  selectedCategory === 'Standard' ? true : model.tags.includes(selectedCategory)
                ).length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
                    <ImageIcon size={48} strokeWidth={1} className="mb-4" />
                    <p className="text-base font-semibold">No models found</p>
                    <p className="text-sm mt-1">Try selecting a different category.</p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Album Modal */}
      <AnimatePresence>
        {createAlbumOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setCreateAlbumOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: 20, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 20, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="w-[min(500px,92vw)] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-900">
                <div className="flex items-center gap-2">
                  <FolderOpen size={18} className="text-purple-500" />
                  <div className="text-sm font-semibold text-white">Create New Album</div>
                </div>
                <button
                  title="Close"
                  aria-label="Close"
                  onClick={() => setCreateAlbumOpen(false)}
                  className="text-zinc-500 hover:text-zinc-200"
                >
                  ✕
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div className="space-y-2">
                  <label htmlFor="albumName" className="text-sm font-semibold text-zinc-300">
                    Album Name
                  </label>
                  <input
                    id="albumName"
                    type="text"
                    value={albumName}
                    onChange={(e) => setAlbumName(e.target.value)}
                    placeholder="e.g. My Best Creations"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="albumDescription" className="text-sm font-semibold text-zinc-300">
                    Description (Optional)
                  </label>
                  <textarea
                    id="albumDescription"
                    value={albumDescription}
                    onChange={(e) => setAlbumDescription(e.target.value)}
                    placeholder="Add a description for your album..."
                    rows={3}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-zinc-600"
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => setCreateAlbumOpen(false)}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateAlbum}
                    disabled={!albumName.trim()}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
                      albumName.trim()
                        ? 'bg-purple-600 hover:bg-purple-500 text-white'
                        : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                    )}
                  >
                    Create Album
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ImagePreviewModal
        isOpen={previewIndex !== null}
        onClose={() => setPreviewIndex(null)}
        images={generatedImages}
        selectedIndex={previewIndex ?? 0}
        onNavigate={setPreviewIndex}
      />
    </>
  );
}
