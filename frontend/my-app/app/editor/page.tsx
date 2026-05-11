"use client";

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import { 
  Home, Undo, Redo, Cloud, LayoutTemplate, Film, 
  Play, Download, Share, Zap, Info, Video, 
  Image as ImageIcon, Music, Mic, Type, Search, 
  UploadCloud, ChevronRight, Volume2, Gauge, 
  TrendingUp, TrendingDown, ZoomIn, ZoomOut, X,
  Search as SearchIcon, ArrowRight, Loader, CheckCircle, AlertCircle
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

// ─── Types ───────────────────────────────────────────────────────────────────
interface UploadedAsset {
  id: string;
  name: string;
  url: string;
  type: 'video' | 'image' | 'audio';
  size: number;
  uploadedAt: number;
}

type AssetTab = 'video' | 'image' | 'music' | 'voice' | 'text';

// ─── Constants ───────────────────────────────────────────────────────────────
const MAX_FILE_SIZE_MB = 100;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
const STORAGE_BUCKET = 'user-images';

const ACCEPT_MAP: Record<AssetTab, string> = {
  video: 'video/*',
  image: 'image/*',
  music: 'audio/*',
  voice: 'audio/*',
  text: '.txt,.srt,.vtt',
};

const TopNav = () => (
  <header className="h-14 bg-[#18181b] border-b border-zinc-800 flex items-center justify-between px-4 shrink-0 z-50">
    <div className="flex items-center gap-4">
      <Link href="/story" aria-label="Go home" className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-white">
        <Home size={18} />
      </Link>
      <div className="flex items-center gap-2">
        <span className="font-bold text-white text-sm">Untitled</span>
        <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
      </div>
      <div className="flex items-center gap-1 ml-4 border-l border-zinc-800 pl-4">
        <button aria-label="Undo" className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400">
          <Undo size={16} />
        </button>
        <button aria-label="Redo" className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400">
          <Redo size={16} />
        </button>
      </div>
      <div className="flex items-center gap-2 ml-2 text-zinc-300 font-medium text-sm">
        <Cloud size={16} />
        <span>Save</span>
      </div>
    </div>

    <div className="flex items-center bg-zinc-900 rounded-lg p-1 border border-zinc-800">
      <Link href="/storyboard" className="flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium text-zinc-400 hover:text-white transition-colors">
        <LayoutTemplate size={16} />
        Storyboard
      </Link>
      <Link href="/editor" className="flex items-center gap-2 px-4 py-1.5 bg-zinc-800 rounded-md shadow-sm text-sm font-bold text-white">
        <Film size={16} />
        Timeline
      </Link>
    </div>

    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-green-900/30 bg-green-900/10 text-green-500 text-xs font-bold">
        <Zap size={14} className="fill-green-500" /> 0 
        <Info size={12} className="text-green-600 ml-1" />
      </div>
      <button aria-label="Upgrade" className="px-4 py-1.5 rounded-full bg-zinc-700 text-white text-xs font-bold hover:bg-zinc-600 transition-colors">
        Upgrade
      </button>
      <div className="flex items-center gap-1 ml-2 border-l border-zinc-800 pl-3">
        <button aria-label="Play" className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-white transition-colors">
          <Play size={14} className="fill-white ml-0.5" />
        </button>
        <button aria-label="Download" className="w-8 h-8 rounded-lg hover:bg-zinc-800 flex items-center justify-center text-zinc-400 transition-colors">
          <Download size={16} />
        </button>
        <button aria-label="Share" className="flex items-center gap-2 px-4 py-1.5 ml-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-bold transition-colors shadow-lg shadow-blue-600/20">
          Share
          <Share size={14} />
        </button>
      </div>
    </div>
  </header>
);

// ─── Asset Thumbnail Components ──────────────────────────────────────────────
function VideoThumbnail({ asset }: { asset: UploadedAsset }) {
  return (
    <div className="relative w-full aspect-video bg-zinc-900 rounded-md overflow-hidden border border-zinc-700 group">
      <video src={asset.url} className="w-full h-full object-cover" muted preload="metadata" />
      <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
        <Play size={16} className="fill-white text-white" />
      </div>
    </div>
  );
}

function ImageThumbnail({ asset }: { asset: UploadedAsset }) {
  return (
    <div className="relative w-full aspect-square bg-zinc-900 rounded-md overflow-hidden border border-zinc-700 group">
      <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" loading="lazy" />
    </div>
  );
}

function AudioThumbnail({ asset }: { asset: UploadedAsset }) {
  return (
    <div className="bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 p-3 rounded-lg flex items-center justify-between group cursor-pointer transition-all">
      <div className="flex items-center gap-3 min-w-0">
        <button
          className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center border border-zinc-700 shrink-0"
          aria-label="Play sample"
          onClick={(e) => {
            e.stopPropagation();
            const audio = document.getElementById(`audio-${asset.id}`) as HTMLAudioElement;
            if (audio) {
              if (audio.paused) {
                audio.play();
              } else {
                audio.pause();
              }
            }
          }}
        >
          <Play size={12} className="fill-white ml-0.5 text-white" />
        </button>
        <div className="space-y-0.5 min-w-0">
          <p className="text-xs font-bold text-white leading-none truncate">{asset.name}</p>
          <p className="text-[10px] text-zinc-500">{(asset.size / (1024 * 1024)).toFixed(1)} MB</p>
        </div>
      </div>
      <audio id={`audio-${asset.id}`} src={asset.url} preload="metadata" className="hidden" />
    </div>
  );
}

// ─── Upload Status Badge ─────────────────────────────────────────────────────
function UploadStatus({ status }: { status: 'idle' | 'uploading' | 'success' | 'error' }) {
  if (status === 'idle') return null;
  return (
    <div className="absolute top-2 right-2 z-10">
      {status === 'uploading' && <Loader size={16} className="animate-spin text-blue-400" />}
      {status === 'success' && <CheckCircle size={16} className="text-green-400" />}
      {status === 'error' && <AlertCircle size={16} className="text-red-400" />}
    </div>
  );
}

// ─── Main Page Component ─────────────────────────────────────────────────────
export default function TimelineEditorPage() {
  const [activeTab, setActiveTab] = useState<AssetTab>('music');

  // Upload state per tab
  const [assets, setAssets] = useState<Record<AssetTab, UploadedAsset[]>>({
    video: [],
    image: [],
    music: [],
    voice: [],
    text: [],
  });
  const [uploadStatus, setUploadStatus] = useState<Record<AssetTab, 'idle' | 'uploading' | 'success' | 'error'>>({
    video: 'idle',
    image: 'idle',
    music: 'idle',
    voice: 'idle',
    text: 'idle',
  });
  const [uploadError, setUploadError] = useState<Record<AssetTab, string | null>>({
    video: null,
    image: null,
    music: null,
    voice: null,
    text: null,
  });

  // Hidden file input refs per tab
  const fileInputRefs: Record<AssetTab, React.RefObject<HTMLInputElement | null>> = {
    video: useRef<HTMLInputElement>(null),
    image: useRef<HTMLInputElement>(null),
    music: useRef<HTMLInputElement>(null),
    voice: useRef<HTMLInputElement>(null),
    text: useRef<HTMLInputElement>(null),
  };

  // ─── Upload Handler ──────────────────────────────────────────────────────
  const handleUpload = async (tab: AssetTab, files: FileList | null) => {
    if (!files || files.length === 0) return;

    const validFiles = Array.from(files).filter((f) => {
      // Validate file size
      if (f.size > MAX_FILE_SIZE) {
        setUploadError((prev) => ({ ...prev, [tab]: `File "${f.name}" exceeds ${MAX_FILE_SIZE_MB}MB limit` }));
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    setUploadStatus((prev) => ({ ...prev, [tab]: 'uploading' }));
    setUploadError((prev) => ({ ...prev, [tab]: null }));

    const newAssets: UploadedAsset[] = [];

    for (const file of validFiles) {
      try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
        const filePath = `${fileName}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(filePath);

        let assetType: 'video' | 'image' | 'audio' = 'image';
        if (file.type.startsWith('video/')) assetType = 'video';
        else if (file.type.startsWith('audio/')) assetType = 'audio';

        newAssets.push({
          id: `${Date.now()}-${Math.random().toString(36).substring(2)}`,
          name: file.name,
          url: publicUrlData.publicUrl,
          type: assetType,
          size: file.size,
          uploadedAt: Date.now(),
        });
      } catch (err: any) {
        setUploadError((prev) => ({ ...prev, [tab]: err.message || 'Upload failed' }));
        setUploadStatus((prev) => ({ ...prev, [tab]: 'error' }));
        return;
      }
    }

    setAssets((prev) => ({
      ...prev,
      [tab]: [...prev[tab], ...newAssets],
    }));
    setUploadStatus((prev) => ({ ...prev, [tab]: 'success' }));

    // Reset status after 3 seconds
    setTimeout(() => {
      setUploadStatus((prev) => ({ ...prev, [tab]: 'idle' }));
    }, 3000);
  };

  // ─── Remove Asset ────────────────────────────────────────────────────────
  const handleRemoveAsset = (tab: AssetTab, assetId: string) => {
    setAssets((prev) => ({
      ...prev,
      [tab]: prev[tab].filter((a) => a.id !== assetId),
    }));
  };

  // ─── Trigger File Input ──────────────────────────────────────────────────
  const triggerFileInput = (tab: AssetTab) => {
    fileInputRefs[tab].current?.click();
  };

  // ─── Tab Definitions ─────────────────────────────────────────────────────
  const tabs: { key: AssetTab; label: string; icon: LucideIcon; iconOnly: boolean }[] = [
    { key: 'video', label: 'Video', icon: Video, iconOnly: true },
    { key: 'image', label: 'Image', icon: ImageIcon, iconOnly: true },
    { key: 'music', label: 'Music', icon: Music, iconOnly: false },
    { key: 'voice', label: 'Voice', icon: Mic, iconOnly: true },
    { key: 'text', label: 'Text', icon: Type, iconOnly: true },
  ];

  // ─── Render Tab Content ──────────────────────────────────────────────────
  const renderTabContent = (tab: AssetTab) => {
    const tabAssets = assets[tab];
    const status = uploadStatus[tab];
    const error = uploadError[tab];
    const hasAssets = tabAssets.length > 0;

    const EmptyState = ({ icon: Icon, label }: { icon: LucideIcon; label: string }) => (
      <div className="mt-2 text-center text-zinc-500 text-sm py-8">
        <Icon size={32} className="mx-auto mb-2 text-zinc-600" />
        <p>No {label} assets yet</p>
        <p className="text-xs mt-1">Upload or browse to add {label}</p>
      </div>
    );

    return (
      <div className="flex-1 min-h-0 p-4 flex flex-col gap-4">
        {/* Hidden file input */}
        <input
          ref={fileInputRefs[tab]}
          type="file"
          accept={ACCEPT_MAP[tab]}
          multiple
          className="hidden"
          aria-label={`Upload ${tab} file`}
          title={`Upload ${tab} file`}
          onChange={(e) => handleUpload(tab, e.target.files)}
        />

        {/* Search & Actions */}
        <div className="flex flex-col gap-2 shrink-0">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <SearchIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input 
                type="text" 
                placeholder={`Search ${tab}...`}
                className="w-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 placeholder:text-zinc-500 rounded-md py-1.5 pl-8 pr-3 outline-hidden focus:border-zinc-600 transition-colors"
              />
            </div>
            <button
              onClick={() => triggerFileInput(tab)}
              disabled={status === 'uploading'}
              title="Upload files"
              className="w-9 h-9 shrink-0 bg-zinc-800 hover:bg-zinc-700 transition-colors rounded-md flex items-center justify-center border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === 'uploading' ? (
                <Loader size={16} className="animate-spin text-blue-400" />
              ) : (
                <UploadCloud size={16} className="text-zinc-300" />
              )}
            </button>
            <button 
              title="Browse Stock"
              className="w-9 h-9 shrink-0 bg-[#1d3368] hover:bg-[#2a4585] text-blue-200 transition-colors rounded-md flex items-center justify-center border border-[#2e498c]"
            >
              <Search size={16} />
            </button>
          </div>
        </div>

        {/* Upload Error */}
        {error && (
          <div className="flex items-center gap-2 text-red-400 text-xs bg-red-900/20 border border-red-900/30 rounded-md p-2 shrink-0">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* Upload Success Indicator */}
        {status === 'success' && !error && (
          <div className="flex items-center gap-2 text-green-400 text-xs bg-green-900/20 border border-green-900/30 rounded-md p-2 shrink-0">
            <CheckCircle size={14} />
            <span>Upload complete!</span>
          </div>
        )}

        {/* Asset Grid / List */}
        {hasAssets ? (
          <div className={`flex-1 overflow-y-auto pr-1 scrollbar-visible ${
            (tab === 'video' || tab === 'image') 
              ? 'grid grid-cols-2 gap-2 content-start' 
              : 'space-y-2'
          }`}>
            {tabAssets.map((asset) => (
              <div key={asset.id} className="relative group h-fit">
                {/* Video Tab: thumbnails */}
                {tab === 'video' && <VideoThumbnail asset={asset} />}
                {/* Image Tab: thumbnails */}
                {tab === 'image' && <ImageThumbnail asset={asset} />}
                {/* Music / Voice Tabs: audio player rows */}
                {(tab === 'music' || tab === 'voice') && <AudioThumbnail asset={asset} />}
                {/* Text Tab: simple row */}
                {tab === 'text' && (
                  <div className="bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 p-3 rounded-lg flex items-center justify-between group cursor-pointer transition-all">
                    <div className="flex items-center gap-3 min-w-0">
                      <Type size={16} className="text-zinc-500 shrink-0" />
                      <div className="space-y-0.5 min-w-0">
                        <p className="text-xs font-bold text-white leading-none truncate">{asset.name}</p>
                        <p className="text-[10px] text-zinc-500">{(asset.size / 1024).toFixed(1)} KB</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Remove button */}
                <button
                  onClick={() => handleRemoveAsset(tab, asset.id)}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-zinc-900/80 border border-zinc-700 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-900/50 hover:border-red-700 z-10"
                  aria-label={`Remove ${asset.name}`}
                >
                  <X size={12} className="text-zinc-400 hover:text-red-400" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={
              tab === 'video' ? Video :
              tab === 'image' ? ImageIcon :
              tab === 'music' ? Music :
              tab === 'voice' ? Mic :
              Type
            }
            label={
              tab === 'video' ? 'video' :
              tab === 'image' ? 'image' :
              tab === 'music' ? 'music' :
              tab === 'voice' ? 'voice recordings' :
              'text overlays'
            }
          />
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-[#09090b] text-zinc-300 font-sans selection:bg-blue-500/30 overflow-hidden">
      <TopNav />
      
      {/* Top Main Workspace (3 columns) */}
      <main className="flex-1 flex gap-4 p-4 min-h-0 bg-[#09090b]">
        
        {/* Left Panel: Library Options */}
        <aside className="w-80 bg-[#18181b] rounded-xl border border-zinc-800 overflow-hidden flex flex-col shrink-0">
          {/* Tabs */}
          <div className="flex items-center justify-between p-2 pb-0 border-b border-zinc-800">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              const assetCount = assets[tab.key].length;
              return (
                <button
                  key={tab.key}
                  aria-label={tab.label}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 p-2 flex items-center justify-center gap-2 transition-colors relative ${
                    isActive
                      ? 'text-white border-b-2 border-white font-bold text-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Icon size={tab.iconOnly ? 18 : 16} />
                  {!tab.iconOnly && tab.label}
                  {assetCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-blue-600 text-[10px] font-bold flex items-center justify-center text-white">
                      {assetCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          
          {renderTabContent(activeTab)}
        </aside>

        {/* Center Canvas: Preview */}
        <section className="flex-1 bg-[#18181b] rounded-xl border border-zinc-800 flex flex-col items-center justify-center relative overflow-hidden min-w-0">
            {/* The vertical video preview mock */}
            <div className="w-[320px] h-137.5 bg-black shadow-2xl relative overflow-hidden border border-zinc-900 flex flex-col justify-between">
                
                <div className="absolute top-12 left-0 right-0 flex flex-col items-center z-10 px-4">
                   <div className="bg-white text-black px-2 py-0.5 text-xs font-black uppercase tracking-tight text-center leading-tight shadow-md">SIKILIZENI MAONI YA</div>
                   <div className="bg-white text-black px-2 py-0.5 text-xs font-black uppercase tracking-tight text-center leading-tight shadow-md mt-0.5">WANANCHII WA TANZANIA</div>
                </div>

                <div className="flex-1 w-full bg-linear-to-b from-blue-900/30 to-black overflow-hidden relative">
                    <div className="absolute inset-0 opacity-40 mix-blend-screen bg-[url('https://images.unsplash.com/photo-1517404215738-15263e9f9178?q=80&w=600&auto=format&fit=crop')] bg-cover bg-center"></div>
                </div>

                <div className="absolute bottom-16 left-0 right-0 flex flex-col items-center z-10">
                   <h2 className="text-blue-400 font-extrabold text-xl leading-tight text-center drop-shadow-md">Wosia wa Mwalimu</h2>
                   <h2 className="text-blue-400 font-extrabold text-xl leading-tight text-center drop-shadow-md">Julius Kambarage</h2>
                   <h2 className="text-blue-400 font-extrabold text-xl leading-tight text-center drop-shadow-md">Nyerere</h2>
                </div>
            </div>
        </section>

        {/* Right Panel: Inspector */}
        <aside className="w-75 bg-[#18181b] rounded-xl border border-zinc-800 flex flex-col shrink-0 overflow-y-auto hide-scrollbar">
           <div className="p-4 border-b border-zinc-800 flex items-center gap-2 text-xs font-bold text-zinc-400">
               <span className="flex items-center gap-1 hover:text-white cursor-pointer"><ImageIcon size={14}/> Still Image <ChevronRight size={14} className="text-zinc-600"/></span>
               <span className="flex items-center gap-1 text-white border-b-2 border-white pb-0.5"><Video size={14}/> Video</span>
           </div>

           <div className="p-5 flex flex-col gap-6">
              <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800/50 border-dashed">
                 <p className="text-xs text-zinc-500 font-medium leading-relaxed">
                    Select a shot to edit its voiceover script.
                 </p>
              </div>

              {/* Adjustments */}
              <div className="space-y-6 mt-2">
                 <div className="space-y-3">
                    <label className="flex items-center gap-2 text-xs font-bold text-zinc-200">
                        <Volume2 size={16} /> Audio Volume
                    </label>
                    <div className="flex items-center gap-3">
                       <input aria-label="Audio Volume" type="range" defaultValue="40" className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                       <div className="w-14 px-2 py-1 bg-zinc-700/50 rounded-md text-xs font-bold text-center border border-zinc-700">40%</div>
                    </div>
                 </div>

                 <div className="space-y-3">
                    <label className="flex items-center gap-2 text-xs font-bold text-zinc-200">
                        <Gauge size={16} /> Audio Speed
                    </label>
                    <div className="flex items-center gap-3">
                       <input aria-label="Audio Speed" type="range" defaultValue="100" min="50" max="200" className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                       <div className="w-14 px-2 py-1 bg-zinc-700/50 rounded-md text-xs font-bold text-center border border-zinc-700">1.00x</div>
                    </div>
                 </div>

                 <div className="space-y-3">
                    <label className="flex items-center gap-2 text-xs font-bold text-zinc-200 mt-4">
                        <TrendingUp size={16} /> Fade In
                    </label>
                    <div className="flex items-center gap-3">
                       <input aria-label="Fade In" type="range" defaultValue="0" className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                       <div className="w-14 px-2 py-1 bg-zinc-700/50 rounded-md text-xs font-bold text-center border border-zinc-700">0.00s</div>
                    </div>
                 </div>

                 <div className="space-y-3">
                    <label className="flex items-center gap-2 text-xs font-bold text-zinc-200">
                        <TrendingDown size={16} /> Fade Out
                    </label>
                    <div className="flex items-center gap-3">
                       <input aria-label="Fade Out" type="range" defaultValue="0" className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                       <div className="w-14 px-2 py-1 bg-zinc-700/50 rounded-md text-xs font-bold text-center border border-zinc-700">0.00s</div>
                    </div>
                 </div>
              </div>
           </div>
        </aside>

      </main>

      {/* Bottom Timeline Section */}
      <footer className="h-72 bg-[#121214] border-t border-zinc-800 flex flex-col shrink-0 z-10 w-full relative">
        
        {/* Timeline Header Ops */}
        <div className="h-12 border-b border-zinc-800/80 flex items-center justify-between px-6 shrink-0 relative">
            <div className="text-xs font-bold text-zinc-400 w-48 font-mono">
               <span className="text-blue-500">00:16:24</span> / 00:33:01
            </div>
            
            <div className="absolute left-1/2 -translate-x-1/2">
                <button className="text-zinc-300 hover:text-white transition-colors p-1" aria-label="Play timeline">
                    <Play size={18} className="fill-current" />
                </button>
            </div>

            <div className="flex items-center gap-3 w-48 justify-end">
                <ZoomOut size={16} className="text-zinc-500" />
                <input aria-label="Zoom timeline" type="range" defaultValue="30" className="w-24 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                <ZoomIn size={16} className="text-zinc-500" />
            </div>
        </div>

        {/* Tracks Viewer */}
        <div className="flex-1 relative flex flex-col overflow-hidden bg-[#18181b]/30">
            
            {/* Timeline Ruler */}
            <div className="h-6 w-full flex items-end px-16 border-b border-zinc-800/50 relative shrink-0">
               <div className="flex-1 flex justify-between uppercase text-[10px] text-zinc-600 font-bold px-2 relative font-mono">
                  {/* Ticks representation */}
                  <span className="relative">0 <div className="absolute -bottom-1 left-1.5 w-px h-1 bg-zinc-700"></div></span>
                  <span className="relative">10s <div className="absolute -bottom-1 left-1/2 w-px h-1 bg-zinc-700"></div></span>
                  <span className="relative">20s <div className="absolute -bottom-1 left-1/2 w-px h-1 bg-zinc-700"></div></span>
                  <span className="relative">30s <div className="absolute -bottom-1 left-1/2 w-px h-1 bg-zinc-700"></div></span>
                  <span className="relative">40s <div className="absolute -bottom-1 left-1/2 w-px h-1 bg-zinc-700"></div></span>
               </div>
            </div>

            {/* Tracks List */}
            <div className="flex-1 overflow-x-auto relative flex hide-scrollbar">
                
                {/* Left Track Icons Fixed column */}
                <div className="w-16 shrink-0 border-r border-zinc-800 bg-[#121214] flex flex-col pt-4 sticky left-0 z-20">
                    <div className="h-16 w-full flex flex-col items-center justify-center gap-1">
                        <Video size={16} className="text-blue-500" />
                    </div>
                    <div className="h-16 w-full flex flex-col items-center justify-center gap-1">
                        <Mic size={16} className="text-emerald-500" />
                    </div>
                </div>

                {/* Track Content Timeline items */}
                <div className="flex-1 relative min-w-300 pt-4 px-2">
                    
                    {/* Video Track line */}
                    <div className="h-16 flex items-center gap-0.5">
                       {/* Mock clip slices */}
                       <div className="h-14 w-12 bg-zinc-800 rounded border border-zinc-700 border-l-2 border-l-blue-500 shrink-0"></div>
                       <div className="h-14 w-12 bg-zinc-700 rounded border border-zinc-600 shrink-0"></div>
                       <div className="h-14 w-12 bg-zinc-800 rounded border border-zinc-700 shrink-0"></div>
                       
                       {/* Longer repeated block */}
                       {[...Array(6)].map((_, i) => (
                           <div key={i} className="h-14 w-12 bg-zinc-800 rounded border border-zinc-700 border-x-zinc-600/50 shrink-0 flex items-center justify-center text-[8px] font-bold text-zinc-500 overflow-hidden relative">
                              <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1517404215738-15263e9f9178?q=20&w=100&auto=format&fit=crop')] bg-cover opacity-30 mix-blend-screen"></div>
                           </div>
                       ))}
                    </div>

                    {/* Audio Track line */}
                    <div className="h-12 mt-4">
                       <div className="h-10 ml-4 w-100 bg-[#253e7d] border border-blue-500/50 rounded-md overflow-hidden flex items-center px-1">
                          {/* Fake Waveform Gen */}
                          {[...Array(80)].map((_, i) => {
                             // Deterministic pseudo-random heights to avoid hydration mismatch
                             const seed = (i * 2654435761) & 0xFFFFFFFF;
                             const pseudoRandom = ((seed * 1103515245 + 12345) >>> 0) / 0xFFFFFFFF;
                             const height = Math.max(20, pseudoRandom * 80);
                             return (
                               <div key={i} className="w-1 bg-blue-300/30 rounded-full mx-px" style={{ height: `${height}%` }}></div>
                             );
                          })}
                       </div>
                    </div>

                    {/* Playhead Marker */}
                    <div className="absolute top-0 bottom-0 left-60 w-px bg-white z-10 pointer-events-none">
                       {/* Playhead Grabber */}
                       <div className="absolute -top-3 -left-1.5 w-3.5 h-4 bg-white rounded-xs cursor-grab pointer-events-auto shadow-md">
                          <div className="w-0.5 h-2 bg-black/30 mx-auto mt-1"></div>
                       </div>
                    </div>

                </div>

            </div>

        </div>
      </footer>

      {/* Global styling */}
      <style dangerouslySetInnerHTML={{__html: `
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}} />
    </div>
  );
}