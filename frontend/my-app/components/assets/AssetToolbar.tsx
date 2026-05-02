"use client";
import React from 'react';
import { Search, SlidersHorizontal, LayoutGrid, List, Star, SquareCheck, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AssetToolbarProps {
  zoom: number;
  setZoom: (val: number) => void;
  view: 'grid' | 'list';
  setView: (val: 'grid' | 'list') => void;
  isSelectionMode: boolean;
  toggleSelectionMode: () => void;
  selectedCount: number;
  handleDeleteSelected: () => void;
  activeTab?: string;
}

export default function AssetToolbar({ zoom, setZoom, view, setView, isSelectionMode, toggleSelectionMode, selectedCount, handleDeleteSelected, activeTab }: AssetToolbarProps) {
  return (
    <div className="sticky top-16 bg-black flex flex-col items-center justify-between gap-6 py-4 z-30 transition-shadow">
      <div className="w-full flex flex-col md:flex-row items-center gap-4">
        {/* Search Bar */}
        <div className="flex-1 w-full relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} strokeWidth={2.5}/>
          <input 
            type="text" 
            placeholder="Search image by prompt and similarity" 
            className="w-full bg-zinc-900/40 border border-zinc-800/80 rounded-xl py-3.5 pl-12 pr-4 text-sm font-medium text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-700 focus:bg-zinc-900/60 transition-all focus:ring-1 focus:ring-zinc-700/50"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto no-scrollbar pb-1 md:pb-0">
          <button className="flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-zinc-900/40 border border-zinc-800/80 hover:border-zinc-700 transition-all text-sm font-bold text-zinc-400 hover:text-white whitespace-nowrap active:scale-95 group">
            <SlidersHorizontal size={18} strokeWidth={2.5} className="group-hover:rotate-12 transition-transform" />
            Filters
          </button>

          <div className="flex items-center gap-1 p-1 bg-zinc-900/40 border border-zinc-800/80 rounded-xl h-12.5">
             <button 
               onClick={() => setView('grid')}
               title="Grid view"
               aria-label="Switch to grid view"
               className={cn("p-2.5 rounded-lg transition-all", view === 'grid' ? "bg-zinc-800 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300")}
             >
               <LayoutGrid size={18} strokeWidth={2.5} />
             </button>
             <button 
               onClick={() => setView('list')}
               title="List view"
               aria-label="Switch to list view"
               className={cn("p-2.5 rounded-lg transition-all", view === 'list' ? "bg-zinc-800 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300")}
             >
               <List size={18} strokeWidth={2.5} />
             </button>
          </div>

          <button 
            title="Favorite"
            aria-label="Toggle favorite"
            className="p-3.5 rounded-xl bg-zinc-900/40 border border-zinc-800/80 hover:border-zinc-700 transition-all text-zinc-500 hover:text-yellow-500 active:scale-90 h-12.5 aspect-square flex items-center justify-center">
            <Star size={18} strokeWidth={2.5} />
          </button>

          {isSelectionMode && selectedCount > 0 && (
             <button
               onClick={handleDeleteSelected}
               className="flex items-center justify-center px-4 py-3.5 rounded-xl text-sm font-bold tracking-tight bg-red-500 text-white hover:bg-red-600 transition-all duration-300 h-12.5 whitespace-nowrap active:scale-95 shadow-sm"
             >
               Delete Selected ({selectedCount})
             </button>
          )}

          <button 
            onClick={toggleSelectionMode}
            className={cn("flex items-center gap-2.5 px-6 py-3.5 rounded-xl transition-all text-sm font-bold whitespace-nowrap active:scale-95 h-12.5 shadow-sm",
              isSelectionMode 
                ? "bg-blue-500/20 border border-blue-500/50 text-blue-400 hover:bg-blue-500/30" 
                : "bg-zinc-900/40 border border-zinc-800/80 hover:border-zinc-700 text-zinc-300 hover:text-white"
            )}>
            <SquareCheck size={18} strokeWidth={2.5} className={isSelectionMode ? "text-blue-400" : "text-zinc-500"} />
            {isSelectionMode ? "Exit Selection" : `Select ${activeTab || 'Asset'}`}
          </button>
        </div>

        {/* Zoom Slider */}
        <div className="hidden lg:flex items-center gap-4 ml-2 pl-4 border-l border-zinc-900 h-7.5">
          <Minus size={14} className="text-zinc-600" strokeWidth={3} />
          <input 
            type="range" 
            min="2" 
            max="8" 
            step="1"
            value={zoom}
            onChange={(e) => setZoom(parseInt(e.target.value))}
            title="Zoom level"
            aria-label="Adjust zoom level"
            className="w-32 accent-zinc-500 transition-opacity opacity-50 hover:opacity-100 h-1 rounded-full bg-zinc-800 appearance-none cursor-pointer"
          />
          <Plus size={14} className="text-zinc-600" strokeWidth={3} />
        </div>
      </div>
    </div>
  );
}
