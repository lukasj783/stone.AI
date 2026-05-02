"use client";
import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  CreditCard,
  Video,
  Type,
  Image as LucideImage,
  Layers,
  ChevronDown,
  Clock,
  Volume2,
  Trash2,
  Search,
  Calendar,
  Star,
  Maximize2,
  MoreVertical,
  Sparkles,
  Settings,
  PlayCircle,
  Check,
} from 'lucide-react';
import Link from 'next/link';

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
  id: string;
  name: string;
  description: string;
  color: string;
  tag?: string;
  tagColor?: string;
  capabilities: ModelCapabilities;
};

function parseLines(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

const VIDEO_MODELS: VideoModelOption[] = [
  {
    id: 'kwaivgi/kling-v3.0-pro/text-to-video',
    name: 'Kling 3.0 Pro',
    description: 'The highest motion quality, and is consistent over long duration',
    tag: 'NEW',
    tagColor: 'bg-orange-500',
    color: 'bg-orange-500',
    capabilities: {
      audio: true,
      cfgScale: true,
      shotType: true,
      multiPrompt: true,
      elementList: true,
    },
  },
  {
    id: 'kwaivgi/kling-v2.6-std/text-to-video',
    name: 'Kling 2.6 Std',
    description: 'Optimized for high-fidelity video generation with excellent motion',
    color: 'bg-emerald-500',
    capabilities: {},
  },
  {
    id: 'google/veo3',
    name: 'Veo 3',
    description: 'Advanced temporal consistency and artistic style control',
    tag: 'BETA',
    tagColor: 'bg-blue-500',
    color: 'bg-blue-500',
    capabilities: {
      audio: true,
      resolution: true,
    },
  },
  {
    id: 'google/veo3.1-fast/text-to-video',
    name: 'Veo 3.1 Fast',
    description: 'High-speed generation with high fidelity',
    color: 'bg-indigo-500',
    capabilities: {
      audio: true,
      resolution: true,
    },
  },
  {
    id: 'google/veo3.1-lite/text-to-video',
    name: 'Veo 3.1 Lite',
    description: 'Lightweight generation for fast turnarounds',
    color: 'bg-indigo-400',
    capabilities: {
      resolution: true,
    },
  },
  {
    id: 'alibaba/wan-2.7/text-to-video',
    name: 'Wan 2.7',
    description: 'Top-tier motion consistency and image prompt expansion',
    color: 'bg-yellow-500',
    capabilities: {
      resolution: true,
      promptExpansion: true,
      seed: true,
    },
  },
];

export default function TextToVideoPage() {
  const pathname = usePathname();
  
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
  const [selectedModel, setSelectedModel] = useState('kwaivgi/kling-v2.6-std/text-to-video');
  const [isModelSelectorExpanded, setIsModelSelectorExpanded] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  
  // Settings States
  const [duration, setDuration] = useState<5 | 10>(5);
  const [generateAudio, setGenerateAudio] = useState<boolean>(false);
  const [resolution, setResolution] = useState('720p');
  const [cfgScale, setCfgScale] = useState(0.5);
  const [shotType, setShotType] = useState('');
  const [enablePromptExpansion, setEnablePromptExpansion] = useState(false);
  const [seed, setSeed] = useState('');
  const [multiPromptInput, setMultiPromptInput] = useState('');
  const [elementListInput, setElementListInput] = useState('');

  const selectedModelConfig = VIDEO_MODELS.find((model) => model.id === selectedModel) ?? VIDEO_MODELS[0];

  const handleGenerate = async () => {
    if (!prompt.trim() || isLoading) return;

    const payload: Record<string, unknown> = {
      model: selectedModel,
      prompt,
      aspect_ratio: aspectRatio,
      duration,
    };

    if (selectedModelConfig.capabilities.audio) {
      payload.generate_audio = generateAudio;
    }

    if (selectedModelConfig.capabilities.resolution) {
      payload.resolution = resolution;
    }

    if (selectedModelConfig.capabilities.cfgScale) {
      payload.cfg_scale = cfgScale;
    }

    if (selectedModelConfig.capabilities.shotType && shotType) {
      payload.shot_type = shotType;
    }

    if (selectedModelConfig.capabilities.promptExpansion) {
      payload.enable_prompt_expansion = enablePromptExpansion;
    }

    if (selectedModelConfig.capabilities.seed && seed.trim()) {
      payload.seed = Number(seed);
    }

    if (selectedModelConfig.capabilities.multiPrompt) {
      const multiPrompt = parseLines(multiPromptInput);
      if (multiPrompt.length > 0) {
        payload.multi_prompt = multiPrompt;
      }
    }

    if (selectedModelConfig.capabilities.elementList) {
      const elementList = parseLines(elementListInput);
      if (elementList.length > 0) {
        payload.element_list = elementList;
      }
    }
    
    setIsLoading(true);
    setGeneratedVideoUrl(null);
    try {
      const res = await fetch("http://localhost:8000/video/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if (res.ok) {
        setGeneratedVideoUrl(data.video_url);
      } else {
        alert(data.detail || "Failed to generate video");
      }
    } catch (err) {
      console.error(err);
      alert("Error generating video");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const res = await fetch("http://localhost:8000/video/upload-input", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        alert("File uploaded successfully to Supabase input-videos: " + data.url);
      } else {
        alert("Upload failed: " + data.detail);
      }
    } catch (err) {
      console.error(err);
      alert("Error uploading file");
    }
  };

  const aspectRatios = [
    { label: 'Cinema (16:9)', value: '16:9', width: 'w-4', height: 'h-2.5' },
    { label: 'Portrait (9:16)', value: '9:16', width: 'w-2.5', height: 'h-4' },
    { label: 'Square (1:1)', value: '1:1', width: 'w-3.5', height: 'h-3.5' },
    { label: 'Classic (4:3)', value: '4:3', width: 'w-4', height: 'h-3' },
  ];

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
              <div className="text-2xl font-black text-white">0 / 40</div>
              <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div className="w-[40%] h-full bg-yellow-500" />
              </div>
            </div>
            <button className="w-full py-3 rounded-xl bg-yellow-400 text-black text-xs font-bold hover:bg-yellow-300 transition-colors shadow-lg shadow-yellow-500/10">
              Upgrade
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
                    <div className={`w-2 h-2 rounded-full ${selectedModelConfig.color || 'bg-emerald-500'} ${!isModelSelectorExpanded ? 'animate-pulse' : ''}`} />
                    <span className="font-bold text-white text-sm">{selectedModelConfig.name}</span>
                    {selectedModelConfig.tag && (
                      <span className={`${selectedModelConfig.tagColor} text-[7px] font-black px-1.5 py-0.5 rounded text-white tracking-widest`}>
                        {selectedModelConfig.tag}
                      </span>
                    )}
                  </div>
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

          {/* Prompt Area */}
          <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-4">
              <textarea 
                className="flex-1 bg-transparent border-none outline-none text-zinc-300 text-sm resize-none placeholder:text-zinc-600 font-medium leading-relaxed"
                placeholder="Describe your video. For example: A 3D image of a little girl, wearing a flight jacket, skateboarding in a park."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <div className="flex items-center justify-between pt-4 border-t border-zinc-800/50">
                   <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition-all cursor-pointer">
                      <Video size={14} />
                      Attach Media
                      <input 
                        type="file" 
                        accept="video/*,image/*" 
                        className="hidden" 
                        onChange={handleFileUpload} 
                      />
                   </label>
                   <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">{prompt.length} / 2000</span>
              </div>
          </div>

          {/* Settings Section */}
          <div className="space-y-2">
              <div className="flex items-center gap-2">
                  <Settings size={12} className="text-zinc-400" />
                  <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Settings</span>
              </div>
              
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
                  {/* Duration */}
                  <div className="flex items-center justify-between gap-4">
                       <span className="text-[10px] font-bold text-zinc-500 uppercase">Duration</span>
                       <div className="flex bg-black rounded-lg p-0.5 w-32">
                          <button 
                            onClick={() => setDuration(5)}
                            className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all ${
                              duration === 5 ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-zinc-600 hover:text-zinc-400'
                            }`}
                          >
                            5s
                          </button>
                          <button 
                            onClick={() => setDuration(10)}
                            className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all ${
                              duration === 10 ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-zinc-600 hover:text-zinc-400'
                            }`}
                          >
                            10s
                          </button>
                      </div>
                  </div>

                  {selectedModelConfig.capabilities.audio && (
                    <div className="flex items-center justify-between gap-4">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase">Audio</span>
                        <div className="flex bg-black rounded-lg p-0.5 w-32">
                            <button 
                              onClick={() => setGenerateAudio(true)}
                              className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all ${
                                generateAudio ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-zinc-600 hover:text-zinc-400'
                              }`}
                            >
                              On
                            </button>
                            <button 
                              onClick={() => setGenerateAudio(false)}
                              className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all ${
                                !generateAudio ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-zinc-600 hover:text-zinc-400'
                              }`}
                            >
                              Off
                            </button>
                        </div>
                    </div>
                  )}

                  {selectedModelConfig.capabilities.resolution && (
                    <div className="flex items-center justify-between gap-4">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase">Resolution</span>
                        <select
                          title="Video resolution"
                          aria-label="Video resolution"
                          value={resolution}
                          onChange={(e) => setResolution(e.target.value)}
                          className="bg-black border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-white outline-none"
                        >
                          <option value="720p">720p</option>
                          <option value="1080p">1080p</option>
                        </select>
                    </div>
                  )}

                  {selectedModelConfig.capabilities.cfgScale && (
                    <div className="flex items-center justify-between gap-4">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase">CFG Scale</span>
                        <div className="flex items-center gap-3 w-40">
                          <input
                            type="range"
                            title="CFG scale"
                            aria-label="CFG scale"
                            min="0"
                            max="1"
                            step="0.1"
                            value={cfgScale}
                            onChange={(e) => setCfgScale(Number(e.target.value))}
                            className="flex-1 accent-blue-500"
                          />
                          <span className="text-xs font-bold text-white w-8 text-right">{cfgScale.toFixed(1)}</span>
                        </div>
                    </div>
                  )}

                  {selectedModelConfig.capabilities.shotType && (
                    <div className="flex items-center justify-between gap-4">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase">Shot Type</span>
                        <select
                          title="Shot type"
                          aria-label="Shot type"
                          value={shotType}
                          onChange={(e) => setShotType(e.target.value)}
                          className="bg-black border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-white outline-none"
                        >
                          <option value="">Auto</option>
                          <option value="close-up">Close-up</option>
                          <option value="medium">Medium</option>
                          <option value="wide">Wide</option>
                        </select>
                    </div>
                  )}

                  {selectedModelConfig.capabilities.promptExpansion && (
                    <div className="flex items-center justify-between gap-4">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase">Prompt Expansion</span>
                        <div className="flex bg-black rounded-lg p-0.5 w-32">
                            <button 
                              onClick={() => setEnablePromptExpansion(true)}
                              className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all ${
                                enablePromptExpansion ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-zinc-600 hover:text-zinc-400'
                              }`}
                            >
                              On
                            </button>
                            <button 
                              onClick={() => setEnablePromptExpansion(false)}
                              className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all ${
                                !enablePromptExpansion ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-zinc-600 hover:text-zinc-400'
                              }`}
                            >
                              Off
                            </button>
                        </div>
                    </div>
                  )}

                  {selectedModelConfig.capabilities.seed && (
                    <div className="flex items-center justify-between gap-4">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase">Seed</span>
                        <input
                          type="number"
                          title="Seed"
                          aria-label="Seed"
                          min="0"
                          value={seed}
                          onChange={(e) => setSeed(e.target.value)}
                          placeholder="Optional"
                          className="w-32 bg-black border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-white outline-none"
                        />
                    </div>
                  )}

                  {selectedModelConfig.capabilities.multiPrompt && (
                    <div className="space-y-2">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase">Multi Prompt</span>
                        <textarea
                          value={multiPromptInput}
                          onChange={(e) => setMultiPromptInput(e.target.value)}
                          placeholder="One prompt per line"
                          className="w-full min-h-20 bg-black border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-300 outline-none resize-none"
                        />
                    </div>
                  )}

                  {selectedModelConfig.capabilities.elementList && (
                    <div className="space-y-2">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase">Element List</span>
                        <textarea
                          value={elementListInput}
                          onChange={(e) => setElementListInput(e.target.value)}
                          placeholder="One element per line"
                          className="w-full min-h-20 bg-black border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-300 outline-none resize-none"
                        />
                    </div>
                  )}

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

          {/* Create Button */}
          <button 
            onClick={handleGenerate}
            disabled={!prompt.trim() || isLoading}
            className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all shadow-inner ${
              !prompt.trim() || isLoading 
                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700' 
                : 'bg-emerald-600 text-white hover:bg-emerald-500 border border-emerald-500 shadow-emerald-900/50'
            }`}
          >
            {isLoading ? "Generating..." : "Create"}
          </button>
          
          <div className="flex items-center justify-center gap-2">
              <Sparkles size={14} className="text-emerald-500" />
              <span className="text-[11px] font-bold text-emerald-500 uppercase tracking-wide">200 credits will be charged</span>
          </div>
        </div>

        {/* --- Column 3: History/Gallery Panel --- */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {/* Header & Tabs */}
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

          {/* Filtering & Search */}
          <div className="flex items-center gap-2">
             <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
                <input 
                  type="text" 
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

          {/* Empty State / Content */}
          <div className="flex-1 bg-zinc-950/50 border border-zinc-900 rounded-3xl flex flex-col items-center justify-center p-8 text-center space-y-6 overflow-hidden relative">
            {generatedVideoUrl ? (
              <video 
                src={generatedVideoUrl} 
                controls 
                autoPlay 
                loop 
                className="w-full h-full object-contain"
              />
            ) : (
              <>
                <div className="relative">
                    <div className="absolute inset-0 bg-blue-500/10 blur-3xl rounded-full" />
                    <img 
                       src="https://api.dicebear.com/7.x/bottts/svg?seed=magic" 
                       alt="Mascot" 
                       className="w-48 h-48 relative z-10 drop-shadow-2xl grayscale brightness-75 opacity-50 contrast-125"
                    />
                    <div className="absolute -top-4 -right-4 p-2 bg-zinc-900 border border-zinc-800 rounded-xl animate-bounce">
                       <Star className="text-yellow-500" size={16} fill="currentColor" />
                    </div>
                </div>
                
                <div className="space-y-2">
                   <h3 className="text-lg font-bold text-white uppercase tracking-wider">
                     {activeHistoryTab === 'Video' && "No Videos Found"}
                     {activeHistoryTab === 'Image' && "No Images Found"}
                     {activeHistoryTab === 'Album' && "Empty Album"}
                   </h3>
                   <p className="text-sm text-zinc-500 max-w-60 mx-auto">
                     {activeHistoryTab === 'Video' && "Start creating cinematic animations and bring your ideas to screen."}
                     {activeHistoryTab === 'Image' && "Upload or generate images to populate your creative history."}
                     {activeHistoryTab === 'Album' && "Organize your favorite generations into collaborative albums."}
                   </p>
                </div>
              </>
            )}
          </div>
          
          {/* Zoom Slider Mockup */}
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
