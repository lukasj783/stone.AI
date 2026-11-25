import React, { useRef, useEffect, useState } from 'react';
import Image from 'next/image';
import {
  Video, ImageIcon, Music, Mic, Type, Search as SearchIcon, UploadCloud,
  Loader, CheckCircle, Plus, X, Play
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import { UploadedAsset, AssetTab } from './types';
import { AudioWaveform } from './AudioWaveform';
import { ErrorBanner } from '@/components/ui/ErrorBanner';

// ─── Constants ───────────────────────────────────────────────────────────────
const ACCEPT_MAP: Record<AssetTab, string> = {
  video: 'video/*',
  image: 'image/*',
  music: 'audio/*',
  voice: 'audio/*',
  text: '.txt,.srt,.vtt',
};

// ─── Asset Thumbnail Components ──────────────────────────────────────────────
export function VideoThumbnail({ asset }: { asset: UploadedAsset }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLVideoElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !mediaRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: 'rgba(255, 255, 255, 0.4)',
      progressColor: 'rgba(255, 255, 255, 0.9)',
      cursorColor: '#ffffff',
      barWidth: 2,
      barGap: 1,
      height: 30,
      media: mediaRef.current, // Sync perfectly with the video element
    });
    
    wavesurferRef.current = ws;

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => setIsPlaying(false));

    return () => {
      ws.destroy();
    };
  }, [asset.url]);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause();
    }
  };

  return (
    <div className="relative w-full aspect-video bg-zinc-900 rounded-md overflow-hidden border border-zinc-700 group cursor-pointer" onClick={togglePlay}>
      <video ref={mediaRef} src={asset.url} className="w-full h-full object-cover" preload="metadata" />
      
      {/* Waveform Overlay at the bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-7.5 bg-linear-to-t from-black/80 to-transparent pointer-events-none">
        <div ref={containerRef} className="w-full h-full opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Play Icon Overlay */}
      <div className={`absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none transition-opacity ${isPlaying ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'}`}>
        <Play size={24} className="fill-white text-white drop-shadow-md" />
      </div>
    </div>
  );
}

export function ImageThumbnail({ asset }: { asset: UploadedAsset }) {
  return (
    <div className="relative w-full aspect-square bg-zinc-900 rounded-md overflow-hidden border border-zinc-700 group">
      <Image src={asset.url} alt={asset.name} fill className="object-cover" unoptimized />
    </div>
  );
}

export function AudioThumbnail({ asset, onAddToTimeline }: { asset: UploadedAsset; onAddToTimeline?: (asset: UploadedAsset) => void }) {
  return (
    <div className="bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 p-3 rounded-lg flex flex-col gap-2 group cursor-pointer transition-all relative">
      <div className="flex items-center justify-between min-w-0">
        <div className="space-y-0.5 min-w-0">
          <p className="text-xs font-bold text-white leading-none truncate">{asset.name}</p>
          <p className="text-[10px] text-zinc-500">{(asset.size / (1024 * 1024)).toFixed(1)} MB</p>
        </div>
        {onAddToTimeline && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddToTimeline(asset); }}
            className="w-6 h-6 rounded bg-blue-600/20 border border-blue-600/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-600/40"
            title="Add to timeline"
          >
            <Plus size={12} className="text-blue-400" />
          </button>
        )}
      </div>
      <div className="w-full relative" onClick={(e) => e.stopPropagation()}>
         <AudioWaveform url={asset.url} />
      </div>
    </div>
  );
}

// ─── Asset Library Props ──────────────────────────────────────────────────
export interface AssetLibraryProps {
  activeTab: AssetTab;
  assets: Record<AssetTab, UploadedAsset[]>;
  uploadStatus: Record<AssetTab, 'idle' | 'uploading' | 'success' | 'error'>;
  uploadError: Record<AssetTab, string | null>;
  setActiveTab: (tab: AssetTab) => void;
  handleUpload: (tab: AssetTab, files: FileList | null) => void;
  handleRemoveAsset: (tab: AssetTab, assetId: string) => void;
  handleDragStart: (e: React.DragEvent, asset: UploadedAsset) => void;
  handleAddToTimeline: (asset: UploadedAsset, tab: AssetTab) => void;
}

export function AssetLibrary({
  activeTab,
  assets,
  uploadStatus,
  uploadError,
  setActiveTab,
  handleUpload,
  handleRemoveAsset,
  handleDragStart,
  handleAddToTimeline,
}: AssetLibraryProps) {
  const tabs: { key: AssetTab; label: string; icon: LucideIcon; iconOnly: boolean }[] = [
    { key: 'video', label: 'Video', icon: Video, iconOnly: true },
    { key: 'image', label: 'Image', icon: ImageIcon, iconOnly: true },
    { key: 'music', label: 'Music', icon: Music, iconOnly: false },
    { key: 'voice', label: 'Voice', icon: Mic, iconOnly: true },
    { key: 'text', label: 'Text', icon: Type, iconOnly: true },
  ];

  // Hidden file input refs per tab
  const fileInputRefs: Record<AssetTab, React.RefObject<HTMLInputElement | null>> = {
    video: useRef<HTMLInputElement>(null),
    image: useRef<HTMLInputElement>(null),
    music: useRef<HTMLInputElement>(null),
    voice: useRef<HTMLInputElement>(null),
    text: useRef<HTMLInputElement>(null),
  };

  const triggerFileInput = (tab: AssetTab) => {
    fileInputRefs[tab].current?.click();
  };

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

        <div className="flex flex-col gap-2 shrink-0">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <SearchIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder={`Search ${tab}...`}
                className="w-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 placeholder:text-zinc-500 rounded-md py-1.5 pl-8 pr-3 outline-none focus:border-zinc-600 transition-colors"
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
          </div>
        </div>

        <ErrorBanner error={error} compact className="shrink-0" />

        {status === 'success' && !error && (
          <div className="flex items-center gap-2 text-green-400 text-xs bg-green-900/20 border border-green-900/30 rounded-md p-2 shrink-0">
            <CheckCircle size={14} />
            <span>Upload complete!</span>
          </div>
        )}

        {hasAssets ? (
          <div className={`flex-1 overflow-y-auto pr-1 scrollbar-visible ${
            (tab === 'video' || tab === 'image')
              ? 'grid grid-cols-2 gap-2 content-start'
              : 'space-y-2'
          }`}>
            {tabAssets.map((asset) => (
              <div key={asset.id} className="relative group h-fit"
                draggable
                onDragStart={(e) => handleDragStart(e, asset)}
              >
                {tab === 'video' && <VideoThumbnail asset={asset} />}
                {tab === 'image' && <ImageThumbnail asset={asset} />}
                {(tab === 'music' || tab === 'voice') && (
                  <AudioThumbnail asset={asset} onAddToTimeline={() => handleAddToTimeline(asset, tab)} />
                )}
                {tab === 'text' && (
                  <div
                    onClick={() => handleAddToTimeline(asset, tab)}
                    className="bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 p-3 rounded-lg flex items-center justify-between group cursor-pointer transition-all"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Type size={16} className="text-zinc-500 shrink-0" />
                      <div className="space-y-0.5 min-w-0">
                        <p className="text-xs font-bold text-white leading-none truncate">{asset.name}</p>
                        <p className="text-[10px] text-zinc-500">{(asset.size / 1024).toFixed(1)} KB</p>
                      </div>
                    </div>
                  </div>
                )}

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
    <aside className="w-80 bg-[#18181b] rounded-xl border border-zinc-800 overflow-hidden flex flex-col shrink-0">
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
  );
}
