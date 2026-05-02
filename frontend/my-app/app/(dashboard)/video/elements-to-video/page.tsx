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
  Plus,
  Search,
  Calendar,
  Star,
  Check,
  Sparkles,
  Volume2,
} from 'lucide-react';
import Link from 'next/link';

export default function ElementsToVideoPage() {
  const pathname = usePathname();
  
  const secondaryNav = [
    { label: "Video Home", href: "/video" },
    { label: "Text to Video", href: "/video/text-to-video" },
    { label: "Image to Video", href: "/video/image-to-video" },
    { label: "Elements to Video", href: "/video/elements-to-video" },
    { label: "Motion-Transfer & Lypsinc", href: "/video/video-to-video" },
  ];

  const [selectedModel, setSelectedModel] = useState('kling-2.6');
  const [isModelSelectorExpanded, setIsModelSelectorExpanded] = useState(false);

  const models = [
    { 
      id: 'seedance-1.5-pro', 
      name: 'Seedance 1.5 Pro', 
      description: 'The highest motion quality, and is consistent over long duration',
      tag: 'NEW',
      tagColor: 'bg-orange-500',
      hasAudio: true,
      color: 'bg-orange-500'
    },
    { 
      id: 'kling-2.6', 
      name: 'Kling 2.6', 
      description: 'Optimized for high-fidelity video generation with excellent motion',
      color: 'bg-emerald-500'
    },
    { 
      id: 'veo-3', 
      name: 'Veo 3', 
      description: 'Advanced temporal consistency and artistic style control',
      tag: 'BETA',
      tagColor: 'bg-blue-500',
      color: 'bg-blue-500'
    },
    { 
      id: 'gen-4', 
      name: 'Gen-4 Turbo', 
      description: 'Lightning fast generation with reliable physics',
      color: 'bg-purple-500'
    }
  ];

  return (
    <div className="flex flex-col lg:flex-row gap-5 h-full">
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
                  {models.map((model) => (
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

          <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-600">
                  <Plus size={32} />
              </div>
              <div className="space-y-1">
                  <h4 className="text-white font-bold">Add elements to your canvas</h4>
                  <p className="text-xs text-zinc-500 max-w-xs mx-auto font-medium">Position graphics, stickers, and shapes to be integrated into your video generation.</p>
              </div>
              <button className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold rounded-xl border border-zinc-700 transition-all">
                Open Element Library
              </button>
          </div>

           {/* Create Button */}
          <button className="w-full py-4 rounded-2xl bg-zinc-800 text-zinc-600 font-bold text-sm cursor-not-allowed border border-zinc-800">
            Create
          </button>
        </div>

        {/* --- History Panel --- */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
            <div className="flex gap-6">
               <button className="text-sm font-bold text-white relative pb-2 border-b-2 border-blue-500">Video</button>
               <button className="text-sm font-bold text-zinc-500 hover:text-zinc-300 transition-colors pb-2">Image</button>
               <button className="text-sm font-bold text-zinc-500 hover:text-zinc-300 transition-colors pb-2">Album</button>
            </div>
          </div>
          
          <div className="flex-1 bg-zinc-950/50 border border-zinc-900 rounded-3xl flex flex-col items-center justify-center p-8 text-center space-y-6">
             <div className="opacity-20 grayscale scale-75">
                 <img src="https://api.dicebear.com/7.x/bottts/svg?seed=elements" alt="Mascot" className="w-32 h-32 mx-auto" />
             </div>
             <p className="text-sm text-zinc-500 font-medium">No elements in this project yet.</p>
          </div>
        </div>

      </div>
  );
}
