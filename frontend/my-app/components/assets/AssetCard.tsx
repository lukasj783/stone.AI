"use client";
import React from 'react';
import { Download, Trash2, Share2, MoreVertical, Star, CheckSquare } from 'lucide-react';
import { motion } from 'framer-motion';

interface AssetCardProps {
  id: number;
  generationId?: number;
  type: string;
  url?: string;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onToggleSelect?: () => void;
  onDelete?: (assetId: number, generationId: number, url: string) => void;
}

export default function AssetCard({ id, generationId, type, url, isSelected, isSelectionMode, onToggleSelect, onDelete }: AssetCardProps) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -4 }}
      onClick={() => {
        if (isSelectionMode) {
          onToggleSelect?.();
        }
      }}
      className={`group relative aspect-square rounded-2xl bg-zinc-900 border overflow-hidden shadow-2xl shadow-black/40 transition-all ${
        isSelectionMode ? 'cursor-pointer' : 'cursor-default'
      } ${
        isSelected ? 'border-blue-500 ring-2 ring-blue-500/50' : 'border-zinc-800/50 hover:border-zinc-700 ring-1 ring-white/5'
      }`}
    >
      {/* Thumbnail Placeholder */}
      {type === 'video' ? (
        <video 
          src={url} 
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          loop
          muted
          playsInline
          onMouseOver={e => (e.target as HTMLVideoElement).play()}
          onMouseOut={e => (e.target as HTMLVideoElement).pause()}
        />
      ) : (
        <div
          className="w-full h-full bg-cover bg-center transition-transform duration-500 hover:scale-105 asset-thumbnail"
          style={{ backgroundImage: `url('${url || `https://avatar.vercel.sh/${type}-${id}?size=400`}')` }}
        />
      )}

      {/* Hover Overlay */}
      <div className="absolute inset-x-0 bottom-0 p-3 bg-linear-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button type="button" title="Download asset" className="p-2.5 rounded-xl bg-zinc-900 shadow-xl border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all active:scale-95">
              <Download size={16} strokeWidth={2.5}/>
            </button>
            <button 
              type="button" 
              title="Delete asset" 
              onClick={(e) => {
                e.stopPropagation();
                if (onDelete && generationId && url) {
                  onDelete(id, generationId, url);
                }
              }}
              className="p-2.5 rounded-xl bg-zinc-900 shadow-xl border border-zinc-800 text-zinc-400 hover:text-red-500 hover:bg-zinc-800 transition-all active:scale-95"
            >
              <Trash2 size={16} strokeWidth={2.5}/>
            </button>
          </div>
          <button type="button" title="Share asset" className="p-2.5 rounded-xl bg-zinc-900 shadow-xl border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all active:scale-95">
            <Share2 size={16} strokeWidth={2.5}/>
          </button>
        </div>
      </div>

      {/* Top Left Selection Indicator */}
      {isSelectionMode && (
        <button 
          type="button" 
          title="Select asset"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.();
          }}
          className={`absolute top-2.5 left-2.5 p-2 rounded-xl backdrop-blur-md transition-all border ${
            isSelected 
              ? 'bg-blue-500/80 border-blue-400 text-white opacity-100' 
              : 'bg-black/40 border-white/10 text-white/60 opacity-60 hover:opacity-100 hover:text-white hover:border-white/30'
          }`}
        >
          <CheckSquare size={14} strokeWidth={2.5} />
        </button>
      )}

      <button type="button" title="More options" className="absolute top-2.5 right-2.5 p-2 rounded-xl bg-black/40 backdrop-blur-md opacity-0 group-hover:opacity-100 transition-all border border-white/10 text-white/60 hover:text-white">
        <MoreVertical size={14} strokeWidth={2.5}/>
      </button>
    </motion.div>
  );
}
