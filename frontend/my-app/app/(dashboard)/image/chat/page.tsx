"use client";
import React, { useState, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { HighlightTextarea } from "@/components/ui/HighlightTextarea";
import ImagePreviewModal from "@/components/ui/ImagePreviewModal";
import {
  CreditCard,
  ChevronDown,
  ChevronLeft,
  Upload,
  MessageSquare,
  Image as ImageIcon,
  Search,
  Clock,
  SlidersHorizontal,
  Sparkles,
  Plus,
  Info,
  ArrowRight,
  FolderOpen,
  X,
  Loader,
  CheckCircle,
  AlertCircle,
  Download,
  Maximize2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ImageModel as ApiImageModel } from '@/lib/types/image-generation';
import { supabase } from '@/lib/supabaseClient';

// Sample style images configuration - rows of styles
const styleImages = [
  { id: 'style1', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=style1' },
  { id: 'style2', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=style2' },
  { id: 'style3', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=style3' },
  { id: 'style4', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=style4' },
  { id: 'style5', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=style5' },
  { id: 'style6', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=style6' },
  { id: 'style7', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=style7' },
  { id: 'style8', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=style8' },
];

type GenerationModel = {
  id: number;
  apiModel: ApiImageModel | string;
  name: string;
  creator: string;
  tags: string[];
  thumbnail: string;
  provider: 'replicate' | 'wavespeed';
  isNew?: boolean;
};

const imageToImageModels: GenerationModel[] = [
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
    id: 6,
    apiModel: 'nanobanana2',
    name: 'Nanobanana 2',
    creator: 'Google',
    tags: ['Standard', 'Search'],
    thumbnail: 'from-yellow-900 via-orange-900 to-amber-900',
    isNew: true,
    provider: 'replicate',
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
    id: 5,
    apiModel: 'flux-klein',
    name: 'FLUX.2 [klein] 9B',
    creator: 'Black Forest Labs',
    tags: ['Fast', 'Realistic'],
    thumbnail: 'from-blue-600 via-sky-500 to-cyan-400',
    provider: 'replicate',
  },
  {
    id: 101,
    apiModel: 'google/nano-banana-pro/edit-multi',
    name: 'Nanobanana Pro Edit Multi',
    creator: 'Google',
    tags: ['Standard', 'Multi'],
    thumbnail: 'from-fuchsia-900 via-purple-900 to-indigo-900',
    provider: 'wavespeed',
  },
  {
    id: 102,
    apiModel: 'google/nano-banana/edit',
    name: 'Nanobanana Edit',
    creator: 'Google',
    tags: ['Standard', 'Edit'],
    thumbnail: 'from-yellow-900 via-orange-900 to-amber-900',
    provider: 'wavespeed',
  },
  {
    id: 103,
    apiModel: 'google/nano-banana-pro/edit',
    name: 'Nanobanana Pro Edit',
    creator: 'Google',
    tags: ['Standard', 'Edit'],
    thumbnail: 'from-yellow-900 via-orange-900 to-amber-900',
    provider: 'wavespeed',
  },
  {
    id: 104,
    apiModel: 'bytedance/seedream-v4.5/edit',
    name: 'Seedream 4.5 Edit',
    creator: 'Byteplus',
    tags: ['Standard', 'Edit'],
    thumbnail: 'from-blue-900 via-indigo-900 to-purple-900',
    provider: 'wavespeed',
  },
  {
    id: 105,
    apiModel: 'bytedance/seedream-v5.0-lite/edit-sequential',
    name: 'Seedream 5 Lite Sequential',
    creator: 'Byteplus',
    tags: ['Standard', 'Fast', 'Edit'],
    thumbnail: 'from-indigo-900 via-purple-900 to-pink-900',
    provider: 'wavespeed',
  },
];

const modelCategories = ['Standard', 'Fast', 'High Quality', 'Turbo', 'Realistic'];
const modelTabs = ['Public Models', 'My Trained Models', 'My Characters', 'Character Library'];

const sizePresetToAspectRatio: Record<string, string> = {
  'Classic (4:3)': '4:3',
  'Square (1:1)': '1:1',
  'Portrait (3:4)': '3:4',
  'Landscape (16:9)': '16:9',
  'Panoramic (21:9)': '21:9',
  'Cinematic (2.39:1)': '2.39:1',
};

export default function ChatToEditPage() {
  const pathname = usePathname();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const secondaryNav = [
    { label: 'Image Home', href: '/image' },
    { label: 'Create Image', href: '/image/create' },
    { label: 'Edit Image', href: '/image/edit' },
    { label: 'Chat to Edit', href: '/image/chat' },
    { label: 'Face Swap', href: '/image/face-swap' },
    { label: 'Character', href: '/image/character' },
    { label: 'Image Upscale', href: '/image/upscale' },
    { label: 'Train a Model', href: '/image/train' },
  ];

  // State management
  const [message, setMessage] = useState('');
  const [selectedModel, setSelectedModel] = useState<GenerationModel>(imageToImageModels[1] ?? imageToImageModels[0]);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [selectedModelTab, setSelectedModelTab] = useState('Public Models');
  const [selectedCategory, setSelectedCategory] = useState('Standard');
  const [modelSearch, setModelSearch] = useState('');
  const [stylesOpen, setStylesOpen] = useState(true);
  const [numImages, setNumImages] = useState(1);
  const [sizePreset, setSizePreset] = useState('Classic (4:3)');
  const [resolution, setResolution] = useState('1K');
  const [guidanceOpen, setGuidanceOpen] = useState(true);
  const [outputOpen, setOutputOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [uploadedImages, setUploadedImages] = useState<Array<{url: string, file: File | null, tag: string, supabaseUrl?: string}>>([]);
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string; image?: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);

  // Modal Preview states
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImages, setPreviewImages] = useState<any[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);

  const openPreview = (type: 'uploaded' | 'generated', index: number) => {
    let images = [];
    if (type === 'uploaded') {
      images = uploadedImages.map((img, i) => ({
        id: `up-${i}`,
        url: img.url,
        prompt: 'Uploaded Image',
        model: 'Input',
      }));
    } else {
      images = generatedImages.map((img, i) => ({
        id: `gen-${i}`,
        url: img,
        prompt: message || 'Output Image',
        model: selectedModel.name,
      }));
    }
    setPreviewImages(images);
    setPreviewIndex(index);
    setPreviewOpen(true);
  };

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      const validFiles = files.filter(f => f.type.startsWith('image/'));
      
      if (validFiles.length === 0) {
        setError('Please select valid image files');
        return;
      }

      validFiles.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          setUploadedImages(prev => {
            const newTag = `image${prev.length + 1}`;
            return [...prev, { url: e.target?.result as string, file, tag: newTag }];
          });
          setError(null);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  // Handle style image selection
  const handleSelectStyleImage = (imageUrl: string) => {
    setUploadedImages([{ url: imageUrl, file: null, tag: 'image1' }]);
    setError(null);
  };

  // Generate image with backend
  const handleGenerateImage = async () => {
    if (!message.trim() || uploadedImages.length === 0) {
      setError('Please provide both a prompt and at least one image');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const uploadedMap: Record<string, string> = {};

      for (const img of uploadedImages) {
        if (img.file && !img.supabaseUrl) {
          const fileExt = img.file.name.split('.').pop();
          const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
          const filePath = `${fileName}`;

          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('user-images')
            .upload(filePath, img.file);

          if (uploadError) throw uploadError;

          const { data: publicUrlData } = supabase.storage
            .from('user-images')
            .getPublicUrl(filePath);

          uploadedMap[img.tag] = publicUrlData.publicUrl;
        } else if (img.supabaseUrl) {
          uploadedMap[img.tag] = img.supabaseUrl;
        } else if (!img.file && !img.supabaseUrl) {
           uploadedMap[img.tag] = img.url; // Use standard url if both file and supabaseUrl are missing
        }
      }

      const payload = {
        model: selectedModel.apiModel,
        provider: selectedModel.provider,
        prompt: message,
        aspect_ratio: sizePresetToAspectRatio[sizePreset] ?? '4:3',
        num_images: numImages,
        image_mapping: uploadedMap,
        ...(selectedModel.apiModel === 'nanobanana2' && { resolution: resolution.toLowerCase() })
      };

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/images/generate-with-image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to generate image');
      }

      const data = await response.json();
      const imageUrls = data.images || (Array.isArray(data) ? data : []);
      if (imageUrls.length > 0) {
        setGeneratedImages(imageUrls);
        setActivePreviewIndex(0);
        setChatHistory([
          ...chatHistory,
          { role: 'user', content: message, image: uploadedImages[0].url },
          { role: 'assistant', content: `Generated ${imageUrls.length} image(s) using ${selectedModel.name}` },
        ]);
        setMessage('');
      } else {
        throw new Error('No images generated');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Generation error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredModels = imageToImageModels.filter((model) => {
    const matchesCategory = selectedCategory === 'Standard' ? true : model.tags.includes(selectedCategory);
    const query = modelSearch.trim().toLowerCase();
    const matchesSearch = query.length === 0
      ? true
      : model.name.toLowerCase().includes(query) || model.creator.toLowerCase().includes(query);

    return matchesCategory && matchesSearch;
  });

  return (
    <div className="flex flex-col lg:flex-row gap-5">
        {/* Secondary Sidebar (Left) */}
        <aside className="lg:w-52 space-y-8 shrink-0">
          <div className="space-y-4">
            <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest px-4">Image Controls</h3>
            <div className="space-y-1">
              {secondaryNav.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`block w-full text-left px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${
                    pathname === item.href
                      ? "bg-zinc-900 text-white border border-zinc-800"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Remaining Credits Box */}
          <div className="p-5 rounded-2xl bg-linear-to-br from-zinc-900 to-black border border-zinc-800 space-y-4">
            <div className="flex items-center gap-2 text-zinc-400">
              <CreditCard size={14} />
              <span className="text-[10px] font-bold uppercase tracking-wider">Remaining Credits</span>
            </div>
            <div className="space-y-1">
              <div className="text-2xl font-black text-white">0 / 40 <span className="text-xs font-normal text-zinc-400">trial credits left</span></div>
              <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="w-full h-full bg-yellow-500 rounded-full" />
              </div>
            </div>
            <button className="w-full py-2.5 rounded-lg bg-yellow-500 text-black text-xs font-bold hover:bg-yellow-400 transition-colors">
              Upgrade
            </button>
          </div>

        </aside>

        {/* Main Content Area */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {/* Header Row */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="text-zinc-400" size={20} />
              <h1 className="text-lg font-bold text-white">Chat to Edit</h1>
              <Info size={14} className="text-zinc-500 cursor-pointer hover:text-zinc-300" />
            </div>
            {/* Model Badge */}
            <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-linear-to-r from-purple-900/40 via-indigo-900/30 to-zinc-900 px-3 py-1.5 flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                <span className="text-sm font-bold text-white tracking-wide">{selectedModel.name}</span>
                {/* The Provider Badge exactly like Create Page */}
                <span className={cn(
                  "text-[9px] font-bold px-1.5 py-0.5 flex items-center justify-center rounded-sm uppercase tracking-wider", 
                  selectedModel.provider === 'wavespeed' ? "bg-cyan-900/60 text-cyan-300" : "bg-purple-900/60 text-purple-300"
                )}>
                  {selectedModel.provider}
                </span>
                {selectedModel.isNew && (
                  <span className="text-[10px] font-bold bg-emerald-600 text-white px-1.5 py-0.5 rounded">NEW</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setModelSelectorOpen(true)}
                className="shrink-0 flex items-center gap-1 bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-2.5 py-1 rounded border border-white/10 transition-colors ml-2"
              >
                Switch
              </button>
            </div>
            <span className="text-xs text-yellow-500 ml-2 font-medium">&#x26A1; 40 credits each</span>
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 flex-1 min-h-0">
            {/* Left Panel - Prompt and Guidance */}
            <div className="xl:col-span-4 flex flex-col gap-4 overflow-y-auto pr-2 pb-2">
              <div className="space-y-4">
                {/* Input Image Section */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-300">
                    <span>Input Image</span>
                    <Info size={12} className="text-zinc-600" />
                  </div>
                  <div
                    className={`relative border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center transition-colors ${
                      uploadedImages.length > 0 ? "p-4 border-zinc-800 bg-zinc-900/50" : "p-6 border-zinc-700 bg-zinc-900 cursor-pointer hover:border-blue-500"
                    }`}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploadedImages.length > 0 ? (
                      <div className="w-full grid grid-cols-2 gap-2">
                        {uploadedImages.map((img, idx) => (
                          <div 
                            key={idx} 
                            className={`relative w-full h-24 flex items-center justify-center bg-zinc-950 rounded-lg border group transition-all duration-200 ${
                              message.includes(`[${img.tag}]`) ? 'border-blue-500 ring-2 ring-blue-500/50 bg-blue-900/10' : 'border-zinc-800'
                            }`}
                          >
                            <img src={img.url} className="max-h-full max-w-full rounded-md object-contain" alt={`Uploaded ${idx + 1}`} />
                            <button
                              type="button"
                              aria-label="Remove image"
                              onClick={(e) => {
                                e.stopPropagation();
                                setUploadedImages(prev => prev.filter((_, i) => i !== idx));
                              }}
                              className="absolute top-1 right-1 p-1 bg-red-500/80 hover:bg-red-600 rounded-full transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <X size={12} className="text-white" />
                            </button>
                            <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMessage(prev => prev ? `${prev} [${img.tag}] ` : `[${img.tag}] `);
                                }}
                                className="absolute bottom-1 right-1 bg-zinc-900/90 text-[10px] text-blue-400 font-mono px-2 py-0.5 rounded border border-zinc-700 hover:text-white hover:border-blue-500 z-10 transition-colors shadow-lg"
                                title="Click to insert into prompt"
                            >
                              +{img.tag}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <>
                        <Upload size={24} className="text-zinc-500 mb-2" />
                        <span className="text-sm font-medium text-zinc-300">Click to upload image(s)</span>
                      </>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    title="Upload images"
                    aria-label="Upload images"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-300">
                    <span>Prompt</span>
                    <Info size={12} className="text-zinc-600" />
                    <ChevronDown size={14} className="text-zinc-600" />
                  </div>
                  <div className="relative bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden focus-within:border-zinc-600 transition-colors h-32">
                    <HighlightTextarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          handleGenerateImage();
                        }
                      }}
                      title="Prompt"
                      aria-label="Prompt"
                      placeholder="Describe how you want this image edited. For example: remove the background..."
                      rows={6}
                      className="w-full h-full pb-8"
                    />
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-3">
                  <button
                    type="button"
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
                            type="button"
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
                                <div className="space-y-3 px-2">
                                  <div>
                                    <div className="flex items-center justify-between text-xs text-zinc-500 mb-2">
                                      <span>Size</span>
                                      <span className="text-emerald-400">Active</span>
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
                                  </div>

                                  {selectedModel.apiModel === 'nanobanana2' && (
                                    <div className="space-y-2">
                                      <div className="text-xs text-zinc-500">Resolution</div>
                                      <div className="flex items-center gap-2">
                                        {['1K', '2K', '4K'].map((value) => (
                                          <button
                                            key={value}
                                            type="button"
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
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          <div className="border-t border-zinc-900 pt-3 space-y-3">
                            <button
                              type="button"
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
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <button
                  onClick={handleGenerateImage}
                  disabled={isLoading || uploadedImages.length === 0 || !message.trim()}
                  className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all text-sm"
                >
                  {isLoading ? (
                    <>
                      <Loader size={16} className="animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      Generate
                    </>
                  )}
                </button>
              </div>
              {error && (
                <div className="flex items-center gap-2 text-red-400 text-xs p-2 mt-2 bg-red-900/20 rounded-lg">
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}
            </div>

            {/* Right Panel - Output Preview & History */}
            <div className="xl:col-span-8 flex flex-col gap-4">
              {/* Output Preview Display */}
              <div className="w-full h-100 border border-zinc-800 rounded-2xl relative flex flex-col items-center justify-center p-1 bg-zinc-950/50">
                {isLoading && (
                  <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                      <div className="absolute inset-0 bg-blue-500 blur-3xl opacity-20 animate-pulse" />
                      <Loader size={48} className="animate-spin text-blue-400 relative z-10" />
                    </div>
                    <p className="text-white font-bold">Generating output...</p>
                  </div>
                )}

                {!isLoading && generatedImages.length === 0 && (
                  <div className="flex flex-col items-center text-center space-y-5 max-w-sm">
                    <div className="relative">
                      <div className="w-24 h-24 rounded-full bg-zinc-900 flex items-center justify-center border border-zinc-800">
                        <ImageIcon size={32} className="text-zinc-600" />
                      </div>
                      <div className="absolute -top-1 -right-1 w-7 h-7 bg-zinc-800 rounded-full flex items-center justify-center border border-zinc-700">
                        <Sparkles size={14} className="text-zinc-400" />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h3 className="text-lg font-bold text-white">Output Preview</h3>
                      <p className="text-sm text-zinc-400">Your edited images will appear here once generated.</p>
                    </div>
                  </div>
                )}

                {!isLoading && generatedImages.length > 0 && (
                  <div className="w-full h-full flex flex-col items-center justify-between p-2">
                    {/* Main Image View with Hover Actions */}
                    <div className="relative group flex-1 w-full flex items-center justify-center min-h-0">
                      <img
                        src={generatedImages[activePreviewIndex]}
                        alt="Generated"
                        className="max-h-full max-w-full object-contain rounded-xl border border-zinc-700 shadow-2xl transition-all"
                      />
                      
                      {/* Floating Action Bar */}
                      <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <button 
                          title="Download"
                          className="p-2.5 bg-zinc-900/80 hover:bg-zinc-800 text-white rounded-lg border border-zinc-700 backdrop-blur-md shadow-lg transition-colors"
                          onClick={() => {
                            const link = document.createElement('a');
                            link.href = generatedImages[activePreviewIndex];
                            link.download = `edit-${Date.now()}.png`;
                            link.click();
                          }}
                        >
                          <Download size={16} />
                        </button>
                        <button 
                          title="View Fullscreen"
                          className="p-2.5 bg-zinc-900/80 hover:bg-zinc-800 text-white rounded-lg border border-zinc-700 backdrop-blur-md shadow-lg transition-colors"
                        >
                          <Maximize2 size={16} />
                        </button>
                      </div>

                      {/* Compare Toggle */}
                      {uploadedImages.length > 0 && (
                        <button 
                          className="absolute top-4 left-4 px-3 py-1.5 bg-zinc-900/80 hover:bg-zinc-800 text-xs font-semibold text-white rounded-lg border border-zinc-700 backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity"
                          onPointerDown={(e) => {
                            const img = e.currentTarget.parentElement?.querySelector('img');
                            if (img) img.src = uploadedImages[0].url;
                          }}
                          onPointerUp={(e) => {
                            const img = e.currentTarget.parentElement?.querySelector('img');
                            if (img) img.src = generatedImages[activePreviewIndex];
                          }}
                          onPointerLeave={(e) => {
                            const img = e.currentTarget.parentElement?.querySelector('img');
                            if (img) img.src = generatedImages[activePreviewIndex];
                          }}
                        >
                          Hold to View Original
                        </button>
                      )}
                    </div>

                    {/* Multi-image Thumbnail Row */}
                    {generatedImages.length > 1 && (
                      <div className="flex items-center gap-2 mt-4 px-4 overflow-x-auto w-full justify-center">
                        {generatedImages.map((img, idx) => (
                          <img
                            key={idx}
                            src={img}
                            alt={`Generation ${idx + 1}`}
                            className={cn(
                              "w-12 h-12 rounded-lg object-cover cursor-pointer transition-all border-2",
                              idx === activePreviewIndex 
                                ? "border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" 
                                : "border-zinc-700 hover:border-zinc-500 opacity-60 hover:opacity-100"
                            )}
                            onClick={() => setActivePreviewIndex(idx)}
                          />
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-green-400 text-sm bg-green-900/20 px-3 py-1.5 rounded-full border border-green-800/30 mt-4 shrink-0">
                      <CheckCircle size={16} />
                      Successfully generated {generatedImages.length} image(s)!
                    </div>
                  </div>
                )}
              </div>

              {/* Editing History Section */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* New Image Card */}
                        <div className="w-16 h-16 rounded-lg border border-zinc-700 bg-zinc-900 flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-zinc-500 transition-colors"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Plus size={16} className="text-zinc-400" />
                          <span className="text-[10px] text-zinc-500">New Image</span>
                        </div>

                        {/* Uploaded thumbnails */}
                        {uploadedImages.map((img, idx) => (
                          <div 
                            key={`up-${idx}`} 
                            className="relative cursor-pointer transition-transform hover:scale-105"
                            onClick={() => openPreview('uploaded', idx)}
                          >
                            <img
                              src={img.url}
                              alt="Uploaded"
                              className="w-16 h-16 rounded-lg object-cover border border-zinc-700 hover:border-blue-500"
                            />
                            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] text-zinc-400 bg-zinc-900 px-1 rounded pointer-events-none">Uploaded</span>
                          </div>
                        ))}

                        {/* Generated thumbnails */}
                        {generatedImages.map((img, idx) => (
                          <div 
                            key={`gen-${idx}`} 
                            className="relative cursor-pointer transition-transform hover:scale-105"
                            onClick={() => openPreview('generated', idx)}
                          >
                            <img
                              src={img}
                              alt={`Generated ${idx + 1}`}
                              className="w-16 h-16 rounded-lg object-cover border border-zinc-700 hover:border-blue-500 transition-colors"
                            />
                          </div>
                        ))}
                      </div>

                      {/* Editing History Link */}
                      <Link
                        href="#"
                        className="text-sm text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
                      >
                        Editing History
                        <ArrowRight size={14} />
                      </Link>
                    </div>
                  </div>
            </div>
          </div>

          {/* Chat History Messages */}
            {chatHistory.length > 0 && (
              <div className="xl:col-span-12 max-h-48 overflow-y-auto space-y-2 bg-zinc-900/50 rounded-xl p-4 border border-zinc-800">
                <AnimatePresence>
                  {chatHistory.map((msg, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-xs px-4 py-2 rounded-lg ${
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white'
                          : 'bg-zinc-800 text-zinc-200'
                      }`}>
                        <p className="text-sm">{msg.content}</p>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

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
                  <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-900 shrink-0">
                    <button
                      type="button"
                      onClick={() => setModelSelectorOpen(false)}
                      className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
                    >
                      <ChevronLeft size={16} />
                      <span className="text-sm font-semibold">Back</span>
                    </button>
                    <button
                      type="button"
                      title="Close"
                      aria-label="Close"
                      onClick={() => setModelSelectorOpen(false)}
                      className="text-zinc-500 hover:text-zinc-200 text-xl"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="flex items-center gap-1 px-6 pt-4 border-b border-zinc-900 shrink-0 overflow-x-auto scrollbar-none">
                    {modelTabs.map((tab) => (
                      <button
                        key={tab}
                        type="button"
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

                  <div className="px-6 py-4 space-y-4 border-b border-zinc-900 shrink-0">
                    <div className="relative max-w-md">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                      <input
                        type="text"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        title="Search All Models"
                        aria-label="Search All Models"
                        placeholder="Search All Models"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-2.5 pl-10 pr-4 text-sm text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
                      />
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-zinc-500 font-semibold">Category:</span>
                      {modelCategories.map((cat) => (
                        <button
                          key={cat}
                          type="button"
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

                  <div className="flex-1 overflow-y-auto px-6 py-4">
                    {selectedModelTab === 'Public Models' ? (
                      <>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                          {filteredModels.map((model) => (
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
                                  'aspect-4/3 bg-linear-to-br flex items-center justify-center relative',
                                  model.thumbnail
                                )}
                              >
                                <ImageIcon size={32} className="text-white/20" />
                                <div className="absolute top-2 left-2 flex gap-1 flex-wrap pr-2">
                                  {model.tags.map((tag) => (
                                    <span
                                      key={tag}
                                      className="bg-black/60 backdrop-blur-sm text-white text-[9px] font-bold px-2 py-0.5 rounded"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                                <div className={cn(
                                  "absolute top-2 right-2 px-1.5 py-0.5 rounded-sm text-[8px] font-bold uppercase tracking-wider",
                                  model.provider === 'wavespeed' ? "bg-cyan-900/80 text-cyan-300" : "bg-purple-900/80 text-purple-300"
                                )}>
                                  {model.provider}
                                </div>
                                <button
                                  type="button"
                                  title="View details"
                                  aria-label="View details"
                                  className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-black/60 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <FolderOpen size={14} />
                                </button>
                              </div>
                              <div className="p-3 space-y-1">
                                <h3 className="text-sm font-bold text-white truncate">{model.name}</h3>
                                <p className="text-xs text-zinc-500 truncate">{model.creator}</p>
                              </div>
                            </motion.div>
                          ))}
                        </div>

                        {filteredModels.length === 0 && (
                          <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
                            <ImageIcon size={48} strokeWidth={1} className="mb-4" />
                            <p className="text-base font-semibold">No models found</p>
                            <p className="text-sm mt-1">Try selecting a different category.</p>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
                        <ImageIcon size={48} strokeWidth={1} className="mb-4" />
                        <p className="text-base font-semibold">No models available here yet</p>
                        <p className="text-sm mt-1">Switch back to Public Models to choose a generation model.</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <ImagePreviewModal
            isOpen={previewOpen}
            onClose={() => setPreviewOpen(false)}
            images={previewImages}
            selectedIndex={previewIndex}
            onNavigate={(index) => setPreviewIndex(index)}
          />
        </div>
      </div>
  );
}
