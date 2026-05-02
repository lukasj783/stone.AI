"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { 
  Home, Undo, Redo, Cloud, LayoutTemplate, Film, 
  Play, Download, Share, Zap, Info, Video, 
  Image as ImageIcon, Music, Mic, Type, Search, 
  UploadCloud, ChevronRight, Volume2, Gauge, 
  TrendingUp, TrendingDown, ZoomIn, ZoomOut, X,
  Search as SearchIcon, ArrowRight
} from 'lucide-react';

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

export default function TimelineEditorPage() {
  return (
    <div className="flex flex-col h-screen bg-[#09090b] text-zinc-300 font-sans selection:bg-blue-500/30 overflow-hidden">
      <TopNav />
      
      {/* Top Main Workspace (3 columns) */}
      <main className="flex-1 flex gap-4 p-4 min-h-0 bg-[#09090b]">
        
        {/* Left Panel: Library Options */}
        <aside className="w-80 bg-[#18181b] rounded-xl border border-zinc-800 overflow-hidden flex flex-col shrink-0">
          {/* Tabs */}
          <div className="flex items-center justify-between p-2 pb-0 border-b border-zinc-800">
             <button aria-label="Video" className="flex-1 p-2 text-zinc-400 hover:text-white flex items-center justify-center"><Video size={18}/></button>
             <button aria-label="Image" className="flex-1 p-2 text-zinc-400 hover:text-white flex items-center justify-center"><ImageIcon size={18}/></button>
             <button aria-label="Music" className="flex-1 p-2 flex items-center justify-center text-white border-b-2 border-white gap-2 font-bold text-sm">
                <Music size={16} /> Music
             </button>
             <button aria-label="Voice" className="flex-1 p-2 text-zinc-400 hover:text-white flex items-center justify-center"><Mic size={18}/></button>
             <button aria-label="Text" className="flex-1 p-2 text-zinc-400 hover:text-white flex items-center justify-center"><Type size={18}/></button>
          </div>
          
          <div className="p-4 flex flex-col gap-4">
             {/* Search */}
             <div className="relative">
               <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
               <input 
                 type="text" 
                 placeholder="Search 200+ songs in library" 
                 className="w-full bg-zinc-900 border border-zinc-800 text-sm text-zinc-200 placeholder:text-zinc-500 rounded-md py-2 pl-9 pr-4 outline-hidden focus:border-zinc-600 transition-colors"
               />
             </div>

             {/* Action Buttons */}
             <div className="flex gap-2">
                 <button className="flex-1 bg-zinc-800 hover:bg-zinc-700 transition-colors rounded-md text-sm font-medium text-zinc-300 py-2.5 flex items-center justify-center gap-2 border border-zinc-700">
                    <UploadCloud size={16} /> Upload
                 </button>
                 <button className="flex-1 bg-[#1d3368] hover:bg-[#2a4585] text-blue-200 transition-colors rounded-md text-sm font-bold flex items-center justify-center gap-2 border border-[#2e498c]">
                    <Search size={16} /> Browse <ArrowRight size={14} />
                 </button>
             </div>

             {/* Mock List */}
             <div className="mt-2 space-y-2">
                 <div className="bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 p-3 rounded-lg flex items-center justify-between group cursor-pointer transition-all">
                    <div className="flex items-center gap-3">
                       <button className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center border border-zinc-700" aria-label="Play sample">
                          <Play size={12} className="fill-white ml-0.5 text-white" />
                       </button>
                       <div className="space-y-0.5">
                          <p className="text-xs font-bold text-white leading-none">Papaoutai - Lovely Cover 😍....</p>
                          <p className="text-[10px] text-zinc-500">1:00</p>
                       </div>
                    </div>
                    <X size={14} className="text-zinc-600 hover:text-white" />
                 </div>
             </div>
          </div>
        </aside>

        {/* Center Canvas: Preview */}
        <section className="flex-1 bg-[#18181b] rounded-xl border border-zinc-800 flex flex-col items-center justify-center relative overflow-hidden min-w-0">
            {/* The vertical video preview mock */}
            <div className="w-[320px] h-[550px] bg-black shadow-2xl relative overflow-hidden border border-zinc-900 flex flex-col justify-between">
                
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
        <aside className="w-[300px] bg-[#18181b] rounded-xl border border-zinc-800 flex flex-col shrink-0 overflow-y-auto hide-scrollbar">
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
                <div className="flex-1 relative min-w-[1200px] pt-4 px-2">
                    
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
                       <div className="h-10 ml-4 w-[400px] bg-[#253e7d] border border-blue-500/50 rounded-md overflow-hidden flex items-center px-1">
                          {/* Fake Waveform Gen */}
                          {[...Array(80)].map((_, i) => (
                             <div key={i} className="w-1 bg-blue-300/30 rounded-full mx-[1px]" style={{ height: `${Math.max(20, Math.random() * 80)}%` }}></div>
                          ))}
                       </div>
                    </div>

                    {/* Playhead Marker */}
                    <div className="absolute top-0 bottom-0 left-[240px] w-px bg-white z-10 pointer-events-none">
                       {/* Playhead Grabber */}
                       <div className="absolute -top-3 -left-1.5 w-3.5 h-4 bg-white rounded-[2px] cursor-grab pointer-events-auto shadow-md">
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
