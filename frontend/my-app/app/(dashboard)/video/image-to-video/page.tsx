"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import AssetCard from '@/components/assets/AssetCard';
import {
  CreditCard,
  Video,
  Type,
  Image as LucideImage,
  Layers,
  ChevronDown,
  Clock,
  Volume2,
  Plus,
  ArrowRightLeft,
  Search,
  Calendar,
  Star,
  Check,
  Sparkles,
  Settings,
} from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { generateImageToVideo } from '@/lib/api/video-generation';
import { ImageToVideoModel, VideoGenerationHistoryItem } from '@/lib/types/video-generation';

type ModelCapabilities = {
  audio?: boolean;
  resolution?: boolean;
  cfgScale?: boolean;
  shotType?: boolean;
  promptExpansion?: boolean;
  seed?: boolean;
  multiPrompt?: boolean;
  elementList?: boolean;
};

type VideoModelOption = {
  id: ImageToVideoModel;
  name: string;
  description: string;
  color: string;
  tag?: string;
  tagColor?: string;
  capabilities: ModelCapabilities;
};

const VIDEO_MODELS: VideoModelOption[] = [
  {
    id: 'kwaivgi/kling-v3.0-std/image-to-video',
    name: 'Kling 3',
    description: 'Backend-supported Kling image-to-video with shot and CFG controls.',
    color: 'bg-emerald-500',
    tag: 'BACKEND',
    tagColor: 'bg-emerald-600',
    capabilities: {
      cfgScale: true,
      shotType: true,
      multiPrompt: true,
      elementList: true,
    },
  },
  {
    id: 'google/veo3.1/image-to-video',
    name: 'Veo 3.1',
    description: 'Backend-supported Veo image-to-video with optional audio and 1080p.',
    color: 'bg-blue-500',
    tag: 'BACKEND',
    tagColor: 'bg-blue-600',
    capabilities: {
      audio: true,
      resolution: true,
    },
  },
  {
    id: 'bytedance/seedance-2.0/image-to-video',
    name: 'Seedance 2.0',
    description: 'Backend-supported Seedance image-to-video with cinematic motion.',
    color: 'bg-orange-500',
    tag: 'BACKEND',
    tagColor: 'bg-orange-600',
    capabilities: {
      resolution: true,
    },
  },
  {
    id: 'alibaba/wan-2.7/image-to-video',
    name: 'Wan 2.7',
    description: 'Backend-supported Wan image-to-video with prompt expansion and seed.',
    color: 'bg-yellow-500',
    tag: 'BACKEND',
    tagColor: 'bg-yellow-600',
    capabilities: {
      resolution: true,
      promptExpansion: true,
      seed: true,
    },
  },
];

const aspectRatios = [
  { label: 'Cinema (16:9)', value: '16:9', width: 'w-4', height: 'h-2.5' },
  { label: 'Portrait (9:16)', value: '9:16', width: 'w-2.5', height: 'h-4' },
  { label: 'Square (1:1)', value: '1:1', width: 'w-3.5', height: 'h-3.5' },
  { label: 'Classic (4:3)', value: '4:3', width: 'w-4', height: 'h-3' },
];

export default function ImageToVideoPage() {
  const pathname = usePathname();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  
  const secondaryNav = [
    { label: "Video Home", href: "/video" },
    { label: "Text to Video", href: "/video/text-to-video" },
    { label: "Image to Video", href: "/video/image-to-video" },
    { label: "Elements to Video", href: "/video/elements-to-video" },
    { label: "Motion-Transfer & Lypsinc", href: "/video/video-to-video" },
  ];

  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [isAspectRatioOpen, setIsAspectRatioOpen] = useState(false);
  const [activeHistoryTab, setActiveHistoryTab] = useState('Video');
  const [selectedModel, setSelectedModel] = useState<ImageToVideoModel>('kwaivgi/kling-v3.0-std/image-to-video');
  const [isModelSelectorExpanded, setIsModelSelectorExpanded] = useState(false);
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState<5 | 10>(5);
  const [generateAudio, setGenerateAudio] = useState(false);
  const [resolution, setResolution] = useState('720p');
  const [cfgScale, setCfgScale] = useState('0.5');
  const [shotType, setShotType] = useState('customize');
  const [enablePromptExpansion, setEnablePromptExpansion] = useState(false);
  const [seed, setSeed] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<VideoGenerationHistoryItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const selectedModelConfig = useMemo(
    () => VIDEO_MODELS.find((model) => model.id === selectedModel) ?? VIDEO_MODELS[0],
    [selectedModel]
  );

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(imageFile);
    setImagePreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [imageFile]);

  useEffect(() => {
    async function fetchHistory() {
      setIsHistoryLoading(true);
      setHistoryError(null);
      try {
        const { data, error } = await supabase
          .from('video_generations')
          .select('id, generation_type, model, prompt, result_video_url, created_at')
          .eq('generation_type', 'image-to-video')
          .order('created_at', { ascending: false })
          .limit(12);

        if (error) {
          throw error;
        }

        setHistoryItems((data ?? []) as VideoGenerationHistoryItem[]);
      } catch (error: any) {
        console.error('Failed to load image-to-video history:', error?.message || JSON.stringify(error) || error);
        setHistoryError('Unable to load image-to-video history. Apply the updated SQL if the new generation_type column is missing.');
      } finally {
        setIsHistoryLoading(false);
      }
    }

    fetchHistory();
  }, []);

  const handleSelectImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    setImageFile(nextFile);
    setGenerationError(null);
  };

  const handleGenerate = async () => {
    if (!imageFile || !prompt.trim() || isGenerating) {
      return;
    }

    setIsGenerating(true);
    setGenerationError(null);
    setGeneratedVideoUrl(null);

    try {
      const payload = {
        model: selectedModel,
        prompt,
        image: imageFile,
        aspect_ratio: aspectRatio,
        duration,
        ...(selectedModelConfig.capabilities.audio ? { generate_audio: generateAudio } : {}),
        ...(selectedModelConfig.capabilities.resolution ? { resolution: resolution } : {}),
        ...(selectedModelConfig.capabilities.cfgScale && cfgScale.trim() ? { cfg_scale: Number(cfgScale) } : {}),
        ...(selectedModelConfig.capabilities.shotType && shotType.trim() ? { shot_type: shotType } : {}),
        ...(selectedModelConfig.capabilities.promptExpansion ? { enable_prompt_expansion: enablePromptExpansion } : {}),
        ...(selectedModelConfig.capabilities.seed && seed.trim() ? { seed: Number(seed) } : {}),
      };

      const response = await generateImageToVideo(payload);
      setGeneratedVideoUrl(response.video_url);
      setActiveHistoryTab('Video');
      setHistoryItems((current) => [
        {
          id: Date.now(),
          generation_type: 'image-to-video',
          model: response.model,
          prompt,
          result_video_url: response.video_url,
          created_at: new Date().toISOString(),
        },
        ...current,
      ]);
    } catch (error) {
      console.error(error);
      setGenerationError(error instanceof Error ? error.message : 'Image to video generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const canGenerate = Boolean(imageFile && prompt.trim()) && !isGenerating;

  return (
    <div className="flex flex-col lg:flex-row gap-5 h-full">
        {/* --- Column 1: Secondary Sidebar --- */}
        <aside className="lg:w-52 space-y-8 shrink-0">
          <div className="space-y-4">
            <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest px-4">Video Controls</h3>
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

          <div className="p-5 rounded-2xl bg-linear-to-br from-zinc-900 to-black border border-zinc-800 space-y-4">
            <div className="flex items-center gap-2 text-zinc-400">
              <CreditCard size={14}/>
              <span className="text-[10px] font-bold uppercase tracking-wider">Remaining Credits</span>
            </div>
            <div className="space-y-1">
              <div className="text-2xl font-black text-white">480</div>
              <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div className="w-[40%] h-full bg-purple-500" />
              </div>
            </div>
            <button className="w-full py-2 rounded-lg bg-white/10 text-white text-xs font-bold hover:bg-white/20 transition-colors border border-zinc-800">
              Upgrade Now
            </button>
          </div>
        </aside>

        {/* --- Column 2: Creation Panel --- */}
        <div className="w-full lg:w-100 shrink-0 flex flex-col gap-4">
          {/* Model Selector - Collapsible */}
          <div className="space-y-2">
            {/* Collapsed Header */}
            <button 
              onClick={() => setIsModelSelectorExpanded(!isModelSelectorExpanded)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex items-center justify-between hover:bg-zinc-850 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <Sparkles size={14} className="text-zinc-400 group-hover:text-zinc-300" />
                <div className="flex flex-col items-start gap-1">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Model</span>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${selectedModelConfig.color} ${!isModelSelectorExpanded ? 'animate-pulse' : ''}`} />
                    <span className="font-bold text-white text-sm">{selectedModelConfig.name}</span>
                    {selectedModelConfig.tag && (
                      <span className={`${selectedModelConfig.tagColor} text-[7px] font-black px-1.5 py-0.5 rounded text-white tracking-widest`}>
                        {selectedModelConfig.tag}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-zinc-500">{VIDEO_MODELS.length} backend image-to-video models</span>
                </div>
              </div>
              <ChevronDown size={16} className={`text-zinc-500 transition-transform ${isModelSelectorExpanded ? 'rotate-180' : ''}`} />
            </button>
            
            {/* Expandable Grid */}
            <div className={`grid transition-all duration-300 ease-in-out ${isModelSelectorExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
              <div className="overflow-hidden">
                <div className="grid grid-cols-2 gap-2 pt-2 max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-zinc-600">
                  {VIDEO_MODELS.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => {
                        setSelectedModel(model.id);
                        setIsModelSelectorExpanded(false);
                      }}
                      className={`relative p-3 rounded-xl transition-all text-left group ${
                        selectedModel === model.id
                          ? 'bg-zinc-800 border-2 border-zinc-700 ring-2 ring-blue-500/20'
                          : 'bg-zinc-900 border-2 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-850'
                      }`}
                    >
                      {/* Selection Indicator */}
                      {selectedModel === model.id && (
                        <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center shadow-lg shadow-blue-500/50">
                          <Check size={12} className="text-white" strokeWidth={3} />
                        </div>
                      )}
                      
                      {/* Model Color Indicator */}
                      <div className={`absolute top-3 left-3 w-2 h-2 rounded-full ${model.color} ${selectedModel === model.id ? 'animate-pulse' : ''}`} />
                      
                      {/* Content */}
                      <div className="pl-4 space-y-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`font-bold text-xs ${selectedModel === model.id ? 'text-white' : 'text-zinc-300'}`}>
                            {model.name}
                          </span>
                          {model.tag && (
                            <span className={`${model.tagColor} text-[7px] font-black px-1 py-0.5 rounded text-white tracking-widest`}>
                              {model.tag}
                            </span>
                          )}
                        </div>
                        
                        <p className="text-[10px] text-zinc-500 leading-snug line-clamp-2">
                          {model.description}
                        </p>

                        <div className="text-[9px] font-mono text-zinc-600 break-all">
                          {model.id}
                        </div>
                        
                        {/* Features */}
                        {model.capabilities.audio && (
                          <div className="flex items-center gap-1 mt-2">
                            <div className="flex items-center gap-1 bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-800">
                              <Volume2 size={8} className="text-blue-400" />
                              <span className="text-[8px] text-zinc-400 font-bold uppercase tracking-tight">Audio</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Image Upload Area */}
          <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-6">
              <input
                ref={fileInputRef}
                type="file"
                aria-label="Upload source image"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleSelectImage}
              />
              {/* Central Drop Zone */}
              <button
                type="button"
                onClick={openFilePicker}
                className="flex-1 border-2 border-dashed border-zinc-800 rounded-xl flex flex-col items-center justify-center p-6 text-center space-y-4 hover:border-zinc-700 transition-all cursor-pointer group"
              >
                  {imagePreviewUrl ? (
                    <div className="w-full space-y-4">
                      <img src={imagePreviewUrl} alt="Selected source" className="w-full h-56 object-cover rounded-xl border border-zinc-800" />
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-white">{imageFile?.name}</p>
                        <p className="text-xs text-zinc-500 uppercase font-bold tracking-widest">Click to replace source image</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 group-hover:text-zinc-300 group-hover:bg-zinc-750 transition-all">
                          <LucideImage size={24} />
                      </div>
                      <div className="space-y-1">
                          <p className="text-sm font-bold text-white">Upload a source image</p>
                          <p className="text-xs text-zinc-500 uppercase font-bold tracking-widest">PNG, JPG, or WEBP</p>
                      </div>
                    </>
                  )}
              </button>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Prompt</label>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Describe the motion, camera movement, and scene changes you want from this image."
                  className="w-full min-h-28 rounded-xl bg-black border border-zinc-800 px-4 py-3 text-sm text-white outline-none focus:border-zinc-700 resize-none"
                />
              </div>

              {/* Start/End Frames Component */}
              <div className="flex items-center gap-2">
                   {/* Start Frame */}
                   <button type="button" onClick={openFilePicker} className="flex-1 aspect-4/3 bg-zinc-950 border-2 border-dashed border-blue-500/40 rounded-xl flex flex-col items-center justify-center p-2 text-center group cursor-pointer hover:bg-zinc-900 transition-all">
                       {imagePreviewUrl ? (
                         <img src={imagePreviewUrl} alt="Start frame" className="w-full h-full rounded-lg object-cover" />
                       ) : (
                         <>
                           <Plus size={16} className="text-blue-500/50 mb-1" />
                           <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Start Frame</span>
                         </>
                       )}
                   </button>

                   <button type="button" title="Reuse the same source frame" className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 hover:text-white transition-all shrink-0">
                      <ArrowRightLeft size={14} />
                   </button>

                   {/* End Frame */}
                   <div className="flex-1 aspect-4/3 bg-zinc-950 border-2 border-dashed border-zinc-800 rounded-xl flex flex-col items-center justify-center p-2 text-center opacity-40 group cursor-not-allowed">
                       <Plus size={16} className="text-zinc-700 mb-1" />
                       <span className="text-[10px] font-bold text-zinc-700 uppercase tracking-wider">End Frame (Optional)</span>
                   </div>
              </div>
          </div>

          {/* Settings Section */}
          <div className="space-y-1">
              <button 
                type="button"
                onClick={() => setIsSettingsExpanded(!isSettingsExpanded)}
                className="w-full flex items-center justify-between p-1.5 hover:bg-zinc-900/50 rounded-lg transition-colors group"
              >
                  <div className="flex items-center gap-2 text-zinc-500 group-hover:text-zinc-400">
                      <Settings size={14} />
                      <span className="text-xs font-bold uppercase tracking-wider">Settings</span>
                  </div>
                  <ChevronDown size={14} className={`text-zinc-500 transition-transform ${isSettingsExpanded ? 'rotate-180' : ''}`} />
              </button>
              
              <div className={`grid transition-all duration-300 ease-in-out ${isSettingsExpanded ? 'grid-rows-[1fr] opacity-100 mb-2' : 'grid-rows-[0fr] opacity-0'}`}>
                <div className="overflow-hidden">
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
                  {/* Duration */}
                  <div className="flex items-center justify-between gap-4">
                       <span className="text-[10px] font-bold text-zinc-500 uppercase">Duration</span>
                       <div className="flex bg-black rounded-lg p-0.5 w-32">
                          <button onClick={() => setDuration(5)} className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-colors ${duration === 5 ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-zinc-600 hover:text-zinc-400'}`}>5s</button>
                          <button onClick={() => setDuration(10)} className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-colors ${duration === 10 ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-zinc-600 hover:text-zinc-400'}`}>10s</button>
                      </div>
                  </div>

                  {/* Audio */}
                  <div className="flex items-center justify-between gap-4">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase">Audio</span>
                      <div className="flex bg-black rounded-lg p-0.5 w-32">
                          <button
                            onClick={() => setGenerateAudio(true)}
                            disabled={!selectedModelConfig.capabilities.audio}
                            className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-colors ${generateAudio && selectedModelConfig.capabilities.audio ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-zinc-600 hover:text-zinc-400'} ${!selectedModelConfig.capabilities.audio ? 'cursor-not-allowed opacity-40' : ''}`}
                          >
                            On
                          </button>
                          <button
                            onClick={() => setGenerateAudio(false)}
                            className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-colors ${!generateAudio ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-zinc-600 hover:text-zinc-400'}`}
                          >
                            Off
                          </button>
                      </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Resolution</label>
                      <select
                        value={resolution}
                        onChange={(event) => setResolution(event.target.value)}
                        aria-label="Video resolution"
                        disabled={!selectedModelConfig.capabilities.resolution}
                        className="w-full rounded-lg bg-black border border-zinc-800 px-3 py-2 text-xs text-white disabled:opacity-40"
                      >
                        <option value="720p">720p</option>
                        <option value="1080p">1080p</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">CFG / Seed</label>
                      {selectedModelConfig.capabilities.cfgScale ? (
                        <input
                          value={cfgScale}
                          onChange={(event) => setCfgScale(event.target.value)}
                          className="w-full rounded-lg bg-black border border-zinc-800 px-3 py-2 text-xs text-white"
                          placeholder="0.5"
                        />
                      ) : (
                        <input
                          value={seed}
                          onChange={(event) => setSeed(event.target.value)}
                          disabled={!selectedModelConfig.capabilities.seed}
                          className="w-full rounded-lg bg-black border border-zinc-800 px-3 py-2 text-xs text-white disabled:opacity-40"
                          placeholder="Optional seed"
                        />
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Shot Type</label>
                      <input
                        value={shotType}
                        onChange={(event) => setShotType(event.target.value)}
                        disabled={!selectedModelConfig.capabilities.shotType}
                        className="w-full rounded-lg bg-black border border-zinc-800 px-3 py-2 text-xs text-white disabled:opacity-40"
                        placeholder="customize"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Prompt Expansion</label>
                      <button
                        type="button"
                        onClick={() => setEnablePromptExpansion((current) => !current)}
                        disabled={!selectedModelConfig.capabilities.promptExpansion}
                        className={`w-full rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${enablePromptExpansion && selectedModelConfig.capabilities.promptExpansion ? 'border-blue-500 bg-blue-500/10 text-white' : 'border-zinc-800 bg-black text-zinc-500'} ${!selectedModelConfig.capabilities.promptExpansion ? 'cursor-not-allowed opacity-40' : ''}`}
                      >
                        {enablePromptExpansion ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                  </div>

                  {/* Aspect Ratio */}
                  <div className="flex items-center justify-between gap-4 z-20">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase">Aspect ratio</span>
                      <div className="relative">
                          <button 
                            onClick={() => setIsAspectRatioOpen(!isAspectRatioOpen)}
                            className="flex items-center gap-2 hover:text-zinc-300 transition-colors group"
                          >
                               <div className={`${aspectRatios.find(ar => ar.value === aspectRatio)?.width} ${aspectRatios.find(ar => ar.value === aspectRatio)?.height} border-2 border-zinc-500 rounded-sm group-hover:border-zinc-300 transition-colors`} />
                               <span className="text-xs font-bold text-white">{aspectRatios.find(ar => ar.value === aspectRatio)?.label}</span>
                               <ChevronDown size={14} className={`text-zinc-500 ml-1 transition-transform ${isAspectRatioOpen ? 'rotate-180' : ''}`} />
                          </button>
                          
                          {isAspectRatioOpen && (
                            <div className="absolute right-0 top-full mt-2 w-48 bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl z-50 py-1">
                                {aspectRatios.map((ratio) => (
                                    <button
                                        key={ratio.value}
                                        onClick={() => {
                                            setAspectRatio(ratio.value);
                                            setIsAspectRatioOpen(false);
                                        }}
                                        className={`w-full flex items-center gap-3 px-4 py-3 transition-colors ${
                                            aspectRatio === ratio.value ? 'bg-zinc-900' : 'hover:bg-zinc-900'
                                        }`}
                                    >
                                        <div className={`flex items-center justify-center w-6`}>
                                            <div 
                                                className={`border-2 rounded-sm transition-all ${
                                                    ratio.width
                                                } ${
                                                    ratio.height
                                                } ${
                                                    aspectRatio === ratio.value 
                                                        ? 'border-blue-500 bg-blue-500/10' 
                                                        : 'border-zinc-600'
                                                }`} 
                                            />
                                        </div>
                                        <span className={`text-xs font-bold ${aspectRatio === ratio.value ? 'text-white' : 'text-zinc-400'}`}>{ratio.label}</span>
                                    </button>
                                ))}
                            </div>
                          )}
                      </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {generationError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {generationError}
            </div>
          )}

          {generatedVideoUrl && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
              <video src={generatedVideoUrl} controls className="w-full rounded-xl border border-zinc-800" />
            </div>
          )}

          {/* Create Button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className={`w-full py-4 rounded-2xl font-bold text-sm border transition-all shadow-lg hover:shadow-black/50 ${canGenerate ? 'bg-blue-600 text-white border-blue-500 hover:bg-blue-500' : 'bg-zinc-800 text-zinc-600 cursor-not-allowed border-zinc-800'}`}
          >
            {isGenerating ? 'Generating Video...' : 'Create'}
          </button>
          
          <div className="flex items-center justify-center gap-1.5 opacity-50">
              <div className="w-3 h-3 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              </div>
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest leading-none">200 credits will be charged</span>
          </div>
        </div>

        {/* --- Column 3: History/Gallery Panel --- */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
            <div className="flex gap-6">
               <button 
                  onClick={() => setActiveHistoryTab('Video')}
                  className={`text-sm font-bold relative pb-2 transition-colors flex items-center gap-1.5 ${
                    activeHistoryTab === 'Video' ? "text-white border-b-2 border-blue-500" : "text-zinc-500 hover:text-zinc-300"
                  }`}
               >
                  <Video size={14} />
                  Video
               </button>
               <button 
                  onClick={() => setActiveHistoryTab('Image')}
                  className={`text-sm font-bold relative pb-2 transition-colors flex items-center gap-1.5 ${
                    activeHistoryTab === 'Image' ? "text-white border-b-2 border-blue-500" : "text-zinc-500 hover:text-zinc-300"
                  }`}
               >
                  <LucideImage size={14} />
                  Image
               </button>
               <button 
                  onClick={() => setActiveHistoryTab('Album')}
                  className={`text-sm font-bold relative pb-2 transition-colors flex items-center gap-1.5 ${
                    activeHistoryTab === 'Album' ? "text-white border-b-2 border-blue-500" : "text-zinc-500 hover:text-zinc-300"
                  }`}
               >
                  <Layers size={14} />
                  Album
               </button>
            </div>
            <button className="text-[11px] font-bold text-zinc-400 hover:text-white flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 px-3 py-1 rounded-lg transition-colors group">
               <Sparkles size={12} className="text-zinc-600 group-hover:text-zinc-400" />
               Feedback
            </button>
          </div>

          <div className="flex items-center gap-2">
             <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
                <input 
                  type="text" 
                  aria-label={`Search ${activeHistoryTab} assets`}
                  placeholder={`Search ${activeHistoryTab} assets...`}
                  className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl pl-9 pr-4 py-2 text-xs text-zinc-400 focus:outline-none focus:border-zinc-700"
                />
             </div>
             <button type="button" title="Filter by date" className="p-2 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white transition-all">
                <Calendar size={16} />
             </button>
             <button type="button" title="Filter by favorites" className="p-2 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white transition-all">
                <Star size={16} />
             </button>
          </div>

          <div className="flex-1 bg-zinc-950/50 border border-zinc-900 rounded-3xl p-6 overflow-hidden">
            {activeHistoryTab === 'Video' && (
              <div className="h-full flex flex-col gap-4">
                {historyError && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {historyError}
                  </div>
                )}

                {isHistoryLoading ? (
                  <div className="flex-1 flex items-center justify-center text-sm text-zinc-500">Loading recent videos...</div>
                ) : historyItems.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto pr-1">
                    {historyItems.map((item) => (
                      item.result_video_url ? <AssetCard key={item.id} id={item.id} type="video" url={item.result_video_url} /> : null
                    ))}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center space-y-3">
                    <h3 className="text-lg font-bold text-white uppercase tracking-wider">No Videos Found</h3>
                    <p className="text-sm text-zinc-500 max-w-60">Generate your first image-to-video clip and it will appear here.</p>
                  </div>
                )}
              </div>
            )}

            {activeHistoryTab === 'Image' && (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                {imagePreviewUrl ? (
                  <>
                    <img src={imagePreviewUrl} alt="Current source" className="max-h-80 w-full object-contain rounded-2xl border border-zinc-800 bg-black" />
                    <p className="text-sm text-zinc-400">Current source image preview</p>
                  </>
                ) : (
                  <>
                    <div className="w-20 h-20 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-600">
                      <LucideImage size={28} />
                    </div>
                    <p className="text-sm text-zinc-500 max-w-60">Upload an image to preview the source frame here before generation.</p>
                  </>
                )}
              </div>
            )}

            {activeHistoryTab === 'Album' && (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-3">
                <h3 className="text-lg font-bold text-white uppercase tracking-wider">Empty Album</h3>
                <p className="text-sm text-zinc-500 max-w-60">Album support is not wired into image-to-video yet.</p>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-4 px-2">
             <Search size={14} className="text-zinc-600" />
             <div className="flex-1 h-1 bg-zinc-900 rounded-full relative">
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-zinc-700 rounded-full border-2 border-black" />
             </div>
          </div>
        </div>
      </div>
  );
}
