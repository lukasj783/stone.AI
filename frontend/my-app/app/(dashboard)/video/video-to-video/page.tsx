"use client";
import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  CreditCard,
  Video,
  Image as LucideImage,
  Layers,
  ChevronDown,
  PlayCircle,
  Volume2,
  Search,
  Calendar,
  Star,
  Settings,
  Sparkles,
  Check,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import VideoTrimmerModal from '@/components/ui/VideoTrimmerModal';

const checkVideoDuration = (file: File): Promise<number> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      window.URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.onerror = () => reject('Failed to load video metadata');
    video.src = URL.createObjectURL(file);
  });
};

export default function VideoToVideoPage() {
  const pathname = usePathname();
  
  const secondaryNav = [
    { label: "Video Home", href: "/video" },
    { label: "Text to Video", href: "/video/text-to-video" },
    { label: "Image to Video", href: "/video/image-to-video" },
    { label: "Elements to Video", href: "/video/elements-to-video" },
    { label: "Motion-Transfer & Lypsinc", href: "/video/video-to-video" },
  ];

  const [activeHistoryTab, setActiveHistoryTab] = useState('Video');
  const [selectedModel, setSelectedModel] = useState('kwaivgi/kling-v3.0-std/motion-control');
  const [isModelSelectorExpanded, setIsModelSelectorExpanded] = useState(false);
  const [activeFeatureTab, setActiveFeatureTab] = useState('Motion Transfer');
  const [prompt, setPrompt] = useState("");
  const [sourceImage, setSourceImage] = useState<File | null>(null);
  const [referenceVideo, setReferenceVideo] = useState<File | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [leftAudio, setLeftAudio] = useState<File | null>(null);
  const [rightAudio, setRightAudio] = useState<File | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [untrimmedVideo, setUntrimmedVideo] = useState<File | null>(null);
  const [generatedVideos, setGeneratedVideos] = useState<string[]>([]);
  const [selectedVideoIndex, setSelectedVideoIndex] = useState(0);

  const getMaxDuration = () => {
    if (selectedModel.includes('kling')) return 30;
    if (selectedModel.includes('wan') || selectedModel.includes('animate')) return 120;
    return 60;
  };

  const getMinDuration = () => {
    return 3;
  };

  const isReadyToGenerate = activeFeatureTab === 'Motion Transfer' 
    ? sourceImage && referenceVideo
    : true; // Lipsync validation happens inside the handler

  const handleGenerate = async () => {
    if (!selectedModel) return;

    if (activeFeatureTab === 'Motion Transfer' && (!sourceImage || !referenceVideo)) {
      alert('Please upload both an image and a video for motion transfer.');
      return;
    }

    if (activeFeatureTab === 'Lip Sync') {
      const isMulti = selectedModel.includes('multi');
      const isVideo = selectedModel.includes('video');
      
      if (isVideo && !referenceVideo) return alert('Video is required.');
      if (!isVideo && !sourceImage) return alert('Image is required.');
      if (isMulti && (!leftAudio || !rightAudio)) return alert('Both left and right audio files are required.');
      if (!isMulti && !audio) return alert('Audio file is required.');
    }

    if (referenceVideo) {
      try {
        const duration = await checkVideoDuration(referenceVideo);
        const maxDur = getMaxDuration();
        if (duration > maxDur) {
          const modelName = models.find(m => m.id === selectedModel)?.name || 'the selected model';
          alert(`The selected video exceeds the maximum allowed duration of ${maxDur} seconds for ${modelName}. Please select a shorter video or trim it.`);
          return;
        }
      } catch (e) {
        console.error('Duration check failed:', e);
      }
    }

    setIsGenerating(true);
    try {
      const formData = new FormData();
      formData.append('model', selectedModel);
      if (prompt) formData.append('prompt', prompt);

      let url = 'http://127.0.0.1:8000/video/motion-transfer';

      if (activeFeatureTab === 'Motion Transfer') {
        if (referenceVideo) formData.append('video', referenceVideo);
        if (sourceImage) formData.append('image', sourceImage);
      } else {
        url = 'http://127.0.0.1:8000/video/lipsync';
        if (sourceImage) formData.append('image', sourceImage);
        if (referenceVideo) formData.append('video', referenceVideo);
        if (audio) formData.append('audio', audio);
        if (leftAudio) formData.append('left_audio', leftAudio);
        if (rightAudio) formData.append('right_audio', rightAudio);
      }

      // Modify this URL if your FastAPI backend runs on a different port/route
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Generation failed: ${errorText}`;
        try {
          const errorJson = JSON.parse(errorText);
          const rawMessage = errorJson.detail || errorJson.message || errorText;
          
          if (typeof rawMessage === 'string' && rawMessage.includes('HTTP 400:')) {
            try {
              const nestedJsonStr = rawMessage.substring(rawMessage.indexOf('HTTP 400:') + 9).trim();
              const nestedJson = JSON.parse(nestedJsonStr);
              if (nestedJson.message) {
                 errorMessage = nestedJson.message;
              } else {
                 errorMessage = rawMessage;
              }
            } catch {
               errorMessage = rawMessage;
            }
          } else {
             errorMessage = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage);
          }
        } catch {
          // Ignore parse error, use original message
        }
        alert(errorMessage);
        return;
      }

      const data = await response.json();
      console.log('Generation started:', data);
      
      const newVideoUrl = data.video_url || data.url || data.output_url || data.output || data.result;
      if (newVideoUrl) {
        setGeneratedVideos((prev) => [newVideoUrl, ...prev]);
        setSelectedVideoIndex(0);
        setActiveHistoryTab('Video');
      }
      
      alert('Generation request was sent successfully!');
    } catch (error: unknown) {
      console.error('Error starting generation:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to start generation. Check the console and make sure the backend is running.';
      alert(errorMessage);
    } finally {
      setIsGenerating(false);
    }
  };
  
  const models = [
    { 
      id: 'kwaivgi/kling-v3.0-std/motion-control', 
      name: 'Kling 3 Motion Control', 
      description: 'Advanced motion mapping from a reference video to a source image',
      tag: 'NEW',
      tagColor: 'bg-emerald-500',
      hasAudio: true,
      color: 'bg-emerald-500',
      type: 'motion-transfer'
    },
    { 
      id: 'wavespeed-ai/wan-2.2/animate', 
      name: 'Wan Animate', 
      description: 'High-fidelity temporal consistency mapping for animation',
      color: 'bg-blue-500',
      type: 'motion-transfer'
    },
    { 
      id: 'wavespeed-ai/steady-dancer', 
      name: 'Steady Dance', 
      description: 'Optimized specifically for full body dance motion transfer',
      color: 'bg-purple-500',
      type: 'motion-transfer'
    },
    { 
      id: 'wavespeed-ai/infinitetalk-fast', 
      name: 'InfiniteTalk Fast', 
      description: 'Audio + Image lip sync',
      color: 'bg-emerald-500',
      type: 'lip-sync'
    },
    { 
      id: 'wavespeed-ai/infinitetalk-fast/multi', 
      name: 'InfiniteTalk Fast Multi', 
      description: 'Dual Audio + Image lip sync',
      color: 'bg-blue-500',
      type: 'lip-sync'
    },
    { 
      id: 'wavespeed-ai/infinitetalk-fast/video-to-video', 
      name: 'InfiniteTalk Video-to-Video', 
      description: 'Audio + Video lip sync',
      color: 'bg-purple-500',
      type: 'lip-sync'
    },
    { 
      id: 'wavespeed-ai/infinitetalk/video-to-video-multi', 
      name: 'InfiniteTalk Video Multi', 
      description: 'Dual Audio + Video lip sync',
      color: 'bg-orange-500',
      type: 'lip-sync'
    },
    { 
      id: 'wavespeed-ai/longcat-avatar', 
      name: 'Longcat Avatar', 
      description: 'Audio + Image avatar generation',
      color: 'bg-teal-500',
      type: 'lip-sync'
    }
  ];

  const visibleModels = activeFeatureTab === 'Motion Transfer' 
    ? models.filter(m => m.type === 'motion-transfer')
    : models.filter(m => m.type === 'lip-sync');

  return (
    <div className="flex flex-col lg:flex-row gap-5 h-full relative">
        {/* Sidebar */}
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

        {/* --- Main Content Area --- */}
        <div className="w-full lg:w-100 shrink-0 flex flex-col gap-4">
          
          {/* Feature Tabs: Motion Transfer / Lip Sync */}
          <div className="bg-zinc-900/50 p-1 rounded-xl flex items-center gap-1 border border-zinc-800">
            <button
              onClick={() => setActiveFeatureTab('Motion Transfer')}
              className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all ${
                activeFeatureTab === 'Motion Transfer'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Motion Transfer
            </button>
            <button
              onClick={() => setActiveFeatureTab('Lip Sync')}
              className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all ${
                activeFeatureTab === 'Lip Sync'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Lip Sync
            </button>
          </div>

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
                    <div className={`w-2 h-2 rounded-full ${models.find(m => m.id === selectedModel)?.color || 'bg-emerald-500'} ${!isModelSelectorExpanded ? 'animate-pulse' : ''}`} />
                    <span className="font-bold text-white text-sm">{models.find(m => m.id === selectedModel)?.name}</span>
                    {models.find(m => m.id === selectedModel)?.tag && (
                      <span className={`${models.find(m => m.id === selectedModel)?.tagColor} text-[7px] font-black px-1.5 py-0.5 rounded text-white tracking-widest`}>
                        {models.find(m => m.id === selectedModel)?.tag}
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
                  {visibleModels.map((model) => (
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
                        {model.hasAudio && (
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

          <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-4">
              <div className="space-y-1 mb-2">
                 <p className="text-sm font-bold text-white">Generate with Prompt (Optional)</p>
                 <div className="relative">
                   <textarea
                     value={prompt}
                     onChange={(e) => setPrompt(e.target.value)}
                     placeholder="A beautiful cinematic motion..."
                     className="w-full h-20 bg-zinc-950/50 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-300 focus:outline-none focus:border-zinc-600 resize-none transition-colors"
                   />
                 </div>
              </div>

              {activeFeatureTab === 'Motion Transfer' && (
                <div className="flex flex-col gap-4">
                  {untrimmedVideo && (
                    <VideoTrimmerModal
                      file={untrimmedVideo}
                      maxDuration={getMaxDuration()}
                      minDuration={getMinDuration()}
                      onClose={() => setUntrimmedVideo(null)}
                      onTrim={(trimmedFile) => {
                        setReferenceVideo(trimmedFile);
                        setUntrimmedVideo(null);
                      }}
                    />
                  )}
                  <div className="flex gap-4">
                    <label className="flex-1 border-2 border-dashed border-zinc-800 rounded-xl flex flex-col items-center justify-center text-center hover:border-zinc-700 transition-all cursor-pointer group relative overflow-hidden aspect-4/3">
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => setSourceImage(e.target.files?.[0] || null)} />
                      {sourceImage ? (
                        <>
                          <Image src={URL.createObjectURL(sourceImage)} alt="Source" fill className="object-cover" unoptimized />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                            <span className="text-white text-xs font-bold bg-black/50 px-3 py-1.5 rounded-lg backdrop-blur-md">Change Image</span>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center gap-4 p-6 w-full h-full justify-center">
                          <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 group-hover:text-zinc-300 group-hover:bg-zinc-750 transition-all">
                              <LucideImage size={24} />
                          </div>
                          <div className="space-y-1">
                              <p className="text-sm font-bold text-white truncate max-w-37.5">Upload Source Image</p>
                              <p className="text-xs text-zinc-500 uppercase font-bold tracking-widest leading-relaxed">JPG, PNG, WEBP</p>
                          </div>
                        </div>
                      )}
                  </label>
                  <label className="flex-1 border-2 border-dashed border-zinc-800 rounded-xl flex flex-col items-center justify-center text-center hover:border-zinc-700 transition-all cursor-pointer group relative overflow-hidden aspect-4/3">
                      <input type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={(e) => setUntrimmedVideo(e.target.files?.[0] || null)} />
                      {referenceVideo ? (
                        <>
                          <video src={URL.createObjectURL(referenceVideo)} className="w-full h-full object-cover" autoPlay muted loop playsInline />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                            <span className="text-white text-xs font-bold bg-black/50 px-3 py-1.5 rounded-lg backdrop-blur-md">Change Video</span>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center gap-4 p-6 w-full h-full justify-center">
                          <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 group-hover:text-zinc-300 group-hover:bg-zinc-750 transition-all">
                              <Video size={24} />
                          </div>
                          <div className="space-y-1">
                              <p className="text-sm font-bold text-white truncate max-w-37.5">Upload Reference Video</p>
                              <p className="text-xs text-zinc-500 uppercase font-bold tracking-widest leading-relaxed">MAX 60S, 500MB</p>
                          </div>
                        </div>
                      )}
                  </label>
                </div>
              </div>
              )}

              {activeFeatureTab === 'Lip Sync' && (
                <div className="flex flex-col gap-4">
                  {selectedModel.includes('video') ? (
                    <label className="flex-1 border-2 border-dashed border-zinc-800 rounded-xl flex flex-col items-center justify-center text-center hover:border-zinc-700 transition-all cursor-pointer group relative overflow-hidden aspect-video">
                        <input type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={(e) => setReferenceVideo(e.target.files?.[0] || null)} />
                        {referenceVideo ? (
                          <>
                            <video src={URL.createObjectURL(referenceVideo)} className="w-full h-full object-contain bg-black" autoPlay muted loop playsInline controls />
                            <div className="absolute top-2 right-2 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm rounded-lg overflow-hidden">
                              <span className="text-white text-xs font-bold bg-black/50 px-3 py-1.5 hover:bg-white/20 transition-colors pointer-events-none">Change Video</span>
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col items-center gap-4 p-6 w-full h-full justify-center">
                            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 group-hover:text-zinc-300 group-hover:bg-zinc-750 transition-all">
                                <Video size={24} />
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-bold text-white truncate max-w-37.5">Upload Reference Video</p>
                            </div>
                          </div>
                        )}
                    </label>
                  ) : (
                    <label className="flex-1 border-2 border-dashed border-zinc-800 rounded-xl flex flex-col items-center justify-center text-center hover:border-zinc-700 transition-all cursor-pointer group relative overflow-hidden aspect-video">
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => setSourceImage(e.target.files?.[0] || null)} />
                        {sourceImage ? (
                          <>
                            <Image src={URL.createObjectURL(sourceImage)} alt="Source Image Preview for Lipsync" fill className="object-contain bg-black" unoptimized />
                            <div className="absolute top-2 right-2 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm rounded-lg overflow-hidden">
                              <span className="text-white text-xs font-bold bg-black/50 px-3 py-1.5 hover:bg-white/20 transition-colors pointer-events-none">Change Image</span>
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col items-center gap-4 p-6 w-full h-full justify-center">
                            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 group-hover:text-zinc-300 group-hover:bg-zinc-750 transition-all">
                                <LucideImage size={24} />
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-bold text-white truncate max-w-37.5">Upload Avatar/Source Image</p>
                            </div>
                          </div>
                        )}
                    </label>
                  )}

                  <div className="flex gap-4">
                    {selectedModel.includes('multi') ? (
                      <>
                        <label className="flex-1 border-2 border-dashed border-zinc-800 rounded-xl p-4 flex flex-col items-center cursor-pointer hover:border-zinc-700 transition-all">
                          <input type="file" accept="audio/mp3,audio/wav,audio/mpeg" className="hidden" onChange={(e) => setLeftAudio(e.target.files?.[0] || null)} />
                          <Volume2 size={24} className="text-zinc-500 mb-2" />
                          <p className="text-sm font-bold text-white">Left Audio</p>
                          {leftAudio ? (
                            <div className="mt-2 w-full px-4" onClick={(e) => e.preventDefault()}>
                              <audio controls src={URL.createObjectURL(leftAudio)} className="w-full h-8" />
                            </div>
                          ) : (
                            <p className="text-xs text-zinc-500 mt-1">Upload left side audio</p>
                          )}
                        </label>
                        <label className="flex-1 border-2 border-dashed border-zinc-800 rounded-xl p-4 flex flex-col items-center cursor-pointer hover:border-zinc-700 transition-all">
                          <input type="file" accept="audio/mp3,audio/wav,audio/mpeg" className="hidden" onChange={(e) => setRightAudio(e.target.files?.[0] || null)} />
                          <Volume2 size={24} className="text-zinc-500 mb-2" />
                          <p className="text-sm font-bold text-white">Right Audio</p>
                          {rightAudio ? (
                            <div className="mt-2 w-full px-4" onClick={(e) => e.preventDefault()}>
                              <audio controls src={URL.createObjectURL(rightAudio)} className="w-full h-8" />
                            </div>
                          ) : (
                            <p className="text-xs text-zinc-500 mt-1">Upload right side audio</p>
                          )}
                        </label>
                      </>
                    ) : (
                      <label className="flex-1 border-2 border-dashed border-zinc-800 rounded-xl p-4 flex flex-col items-center cursor-pointer hover:border-zinc-700 transition-all">
                        <input type="file" accept="audio/mp3,audio/wav,audio/mpeg" className="hidden" onChange={(e) => setAudio(e.target.files?.[0] || null)} />
                        <Volume2 size={24} className="text-zinc-500 mb-2" />
                        <p className="text-sm font-bold text-white">Audio File</p>
                        {audio ? (
                          <div className="mt-2 w-full px-4" onClick={(e) => e.preventDefault()}>
                            <audio controls src={URL.createObjectURL(audio)} className="w-full h-8" />
                          </div>
                        ) : (
                          <p className="text-xs text-zinc-500 mt-1">Upload speech audio</p>
                        )}
                      </label>
                    )}
                  </div>
                </div>
              )}
          </div>

          <div className="space-y-2">
              <div className="flex items-center gap-2">
                  <Settings size={12} className="text-zinc-400" />
                  <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Settings</span>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
                  {/* Style Strength */}
                  <div className="flex items-center justify-between gap-4">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase min-w-25">Style Strength</span>
                      <div className="flex-1 h-1 bg-zinc-800 rounded-full relative group cursor-pointer">
                         <div className="absolute left-[70%] top-1/2 -translate-y-1/2 w-3 h-3 bg-zinc-600 group-hover:bg-zinc-400 group-hover:scale-125 transition-all rounded-full border border-black shadow shadow-black" />
                      </div>
                  </div>

                  {/* Preserve Content */}
                  <div className="flex items-center justify-between gap-4">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase min-w-25">Preserve Content</span>
                      <div className="flex-1 h-1 bg-zinc-800 rounded-full relative group cursor-pointer">
                         <div className="absolute left-[30%] top-1/2 -translate-y-1/2 w-3 h-3 bg-blue-500 group-hover:bg-blue-400 group-hover:scale-125 transition-all rounded-full border border-black shadow shadow-black" />
                      </div>
                  </div>
              </div>
          </div>

          <button 
            onClick={handleGenerate}
            disabled={!isReadyToGenerate || isGenerating}
            className={`w-full py-4 rounded-2xl font-bold text-sm border flex items-center justify-center gap-2 transition-all ${
              isReadyToGenerate && !isGenerating
                ? 'bg-white text-black hover:bg-zinc-200 border-white shadow-lg shadow-white/10 cursor-pointer'
                : 'bg-zinc-800 text-zinc-600 cursor-not-allowed border-zinc-800'
            }`}
          >
            {isGenerating ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-zinc-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                   <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                   <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Generating...
              </>
            ) : (
              'Generate New Styles'
            )}
          </button>
        </div>

        {/* --- History/Right Panel --- */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
            <div className="flex gap-6">
               <button 
                onClick={() => setActiveHistoryTab('Video')}
                className={`text-sm font-bold transition-colors pb-2 flex items-center gap-2 ${activeHistoryTab === 'Video' ? 'text-white border-b-2 border-blue-500' : 'text-zinc-500 hover:text-zinc-300'}`}
               >
                <Video size={14} />
                Video
               </button>
               <button 
                onClick={() => setActiveHistoryTab('Image')}
                className={`text-sm font-bold transition-colors pb-2 flex items-center gap-2 ${activeHistoryTab === 'Image' ? 'text-white border-b-2 border-blue-500' : 'text-zinc-500 hover:text-zinc-300'}`}
               >
                <LucideImage size={14} />
                Image
               </button>
               <button 
                onClick={() => setActiveHistoryTab('Album')}
                className={`text-sm font-bold transition-colors pb-2 flex items-center gap-2 ${activeHistoryTab === 'Album' ? 'text-white border-b-2 border-blue-500' : 'text-zinc-500 hover:text-zinc-300'}`}
               >
                <Layers size={14} />
                Album
               </button>
            </div>
            <button className="text-[11px] font-bold text-zinc-400 hover:text-white flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 px-3 py-1 rounded-lg transition-colors">
               Feedback
            </button>
          </div>

          <div className="flex items-center gap-2">
             <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
                <input 
                  type="text" 
                  placeholder="Search assets..." 
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

          <div className={`flex-1 bg-zinc-950/50 border border-zinc-900 rounded-3xl flex flex-col overflow-hidden relative ${activeHistoryTab === 'Video' && generatedVideos.length > 0 ? 'p-5' : 'items-center justify-center p-8 text-center space-y-6'}`}>
             {activeHistoryTab === 'Video' && (
                generatedVideos.length > 0 ? (
                  <div className="w-full h-full flex flex-col gap-4 overflow-hidden">
                    {/* Main Preview Player */}
                    <div className="relative w-full aspect-video bg-black rounded-2xl border border-zinc-800 overflow-hidden shadow-2xl shrink-0 group">
                      <video 
                        key={generatedVideos[selectedVideoIndex]}
                        src={generatedVideos[selectedVideoIndex]} 
                        className="w-full h-full object-contain" 
                        controls 
                        autoPlay 
                        loop 
                        muted 
                        playsInline
                      />
                      <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 flex items-center gap-2 pointer-events-none transition-opacity duration-500 group-hover:opacity-0 delay-1000">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]"></span>
                        <span className="text-[10px] font-bold text-white uppercase tracking-widest drop-shadow-md">Active Preview</span>
                      </div>
                    </div>
                    
                    {/* Thumbnails Grid */}
                    <div className="w-full grid grid-cols-3 gap-3 overflow-y-auto pb-4 pr-1 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                      {generatedVideos.map((videoUrl, idx) => (
                        <div 
                          key={idx} 
                          onClick={() => setSelectedVideoIndex(idx)}
                          className={`relative aspect-video rounded-xl overflow-hidden cursor-pointer group transition-all duration-300 border-2 ${selectedVideoIndex === idx ? 'border-blue-500 scale-[0.98]' : 'border-zinc-800 hover:border-zinc-600 hover:scale-[1.02]'}`}
                        >
                          <video 
                            src={videoUrl} 
                            className={`w-full h-full object-cover transition-opacity duration-300 ${selectedVideoIndex === idx ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'}`} 
                            muted 
                            playsInline 
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="opacity-10 grayscale brightness-75 bg-linear-to-b from-transparent via-zinc-800/20 to-transparent p-12 rounded-full">
                        <PlayCircle size={80} className="text-zinc-500" />
                    </div>
                    <div className="space-y-1">
                        <p className="text-sm font-bold text-zinc-400">Transform your videos</p>
                        <p className="text-xs text-zinc-600 max-w-50 font-medium leading-relaxed">Your transformed video assets will appear here.</p>
                    </div>
                  </>
                )
             )}
             {activeHistoryTab === 'Image' && (
                <>
                  <div className="opacity-10 grayscale brightness-75 bg-linear-to-b from-transparent via-zinc-800/20 to-transparent p-12 rounded-full">
                      <LucideImage size={80} className="text-zinc-500" />
                  </div>
                  <div className="space-y-1">
                      <p className="text-sm font-bold text-zinc-400">No Image Assets</p>
                      <p className="text-xs text-zinc-600 max-w-50 font-medium leading-relaxed">Images used for video generation will appear here.</p>
                  </div>
                 </>
             )}
             {activeHistoryTab === 'Album' && (
                <>
                  <div className="opacity-10 grayscale brightness-75 bg-linear-to-b from-transparent via-zinc-800/20 to-transparent p-12 rounded-full">
                      <Layers size={80} className="text-zinc-500" />
                  </div>
                  <div className="space-y-1">
                      <p className="text-sm font-bold text-zinc-400">Empty Album</p>
                      <p className="text-xs text-zinc-600 max-w-50 font-medium leading-relaxed">Your collection of generated assets.</p>
                  </div>
                 </>
             )}
          </div>
        </div>
      </div>
  );
}
