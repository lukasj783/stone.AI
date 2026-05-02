"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { 
  Home, Undo, Redo, Cloud, LayoutTemplate, Film, 
  Play, Download, Share, Monitor, Paintbrush, 
  Star, Focus, Link2, Image as ImageIcon, Wand2, Eraser, 
  Trash2, Plus, Video, ChevronRight, Zap, Info, GripVertical, Check,
  ChevronDown
} from 'lucide-react';

const TopNav = () => (
  <header className="h-14 bg-[#18181b] border-b border-zinc-800 flex items-center justify-between px-4 shrink-0">
    <div className="flex items-center gap-4">
      <Link href="/story" className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-white">
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
      <Link href="/storyboard" className="flex items-center gap-2 px-4 py-1.5 bg-zinc-800 rounded-md shadow-sm text-sm font-bold text-white">
        <LayoutTemplate size={16} />
        Storyboard
      </Link>
      <Link href="/editor" className="flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium text-zinc-400 hover:text-white transition-colors">
        <Film size={16} />
        Timeline
      </Link>
    </div>

    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-green-900/30 bg-green-900/10 text-green-500 text-xs font-bold">
        <Zap size={14} className="fill-green-500" /> 0 
        <Info size={12} className="text-green-600 ml-1" />
      </div>
      <button className="px-4 py-1.5 rounded-full bg-white text-black text-xs font-bold hover:bg-zinc-200 transition-colors">
        Upgrade
      </button>
      <div className="flex items-center gap-1 ml-2 border-l border-zinc-800 pl-3">
        <button aria-label="Play" className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-white transition-colors">
          <Play size={14} className="fill-white ml-0.5" />
        </button>
        <button aria-label="Download" className="w-8 h-8 rounded-lg hover:bg-zinc-800 flex items-center justify-center text-zinc-400 transition-colors">
          <Download size={16} />
        </button>
        <button className="flex items-center gap-2 px-4 py-1.5 ml-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-bold transition-colors shadow-lg shadow-blue-600/20">
          Share
          <Share size={14} />
        </button>
      </div>
    </div>
  </header>
);

const Toolbar = () => (
  <div className="h-12 bg-[#121214] border-b border-zinc-800/50 flex items-center justify-between px-6 shrink-0 shadow-sm z-10 w-full overflow-x-auto hide-scrollbar">
      <div className="flex items-center gap-6 text-xs font-bold text-zinc-400">
        <button className="flex items-center gap-2 hover:text-white transition-colors">
          <Monitor size={14} /> 16:9
        </button>
        <button className="flex items-center gap-2 hover:text-white transition-colors">
          <Paintbrush size={14} /> Visual Style
        </button>
        <button className="flex items-center gap-2 hover:text-white transition-colors">
          <Star size={14} /> Character
        </button>
        <button className="flex items-center gap-2 hover:text-white transition-colors">
          <Focus size={14} /> Recurring Prop ( 0 )
        </button>
      </div>
      <button className="flex items-center gap-2 text-xs font-bold text-zinc-400 hover:text-white transition-colors whitespace-nowrap">
        <Link2 size={14} /> Connect current shots
      </button>
  </div>
);

const ShotCard = ({ index }: { index: number }) => (
  <div className="relative group w-full mb-8">
     {/* Main Card */}
    <div className="flex bg-[#18181b]/60 border border-zinc-800 rounded-xl overflow-hidden shadow-xl">
      
      {/* Left Handle / Index */}
      <div className="w-10 bg-zinc-900/80 border-r border-zinc-800/50 flex flex-col items-center py-4 shrink-0">
        <GripVertical size={16} className="text-zinc-600 cursor-grab hover:text-zinc-300" />
        <div className="mt-8 text-xs font-black text-zinc-500">{index}</div>
      </div>

      {/* Two Column Layout Grid */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-2">
        
        {/* Left Column (Image setup) */}
        <div className="p-5 border-b xl:border-b-0 xl:border-r border-zinc-800/50 flex flex-col relative">
          <div className="flex items-center justify-between mb-4">
             <div className="flex items-center gap-2">
               <ImageIcon size={18} className="text-zinc-200" />
               <h3 className="font-bold text-sm text-zinc-100">What should this shot look like?</h3>
               <span className="text-[10px] font-bold text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded ml-2">Uploaded</span>
             </div>
             <div className="flex items-center gap-1">
               <button aria-label="Paintbrush" className="p-1.5 rounded bg-zinc-800/50 hover:bg-zinc-700 text-zinc-400 transition-colors"><Paintbrush size={14}/></button>
               <button aria-label="Eraser" className="p-1.5 rounded bg-zinc-800/50 hover:bg-zinc-700 text-zinc-400 transition-colors"><Eraser size={14}/></button>
               <button aria-label="Download" className="p-1.5 rounded bg-zinc-800/50 hover:bg-zinc-700 text-zinc-400 transition-colors"><Download size={14}/></button>
             </div>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center min-h-[260px]">
             {/* Center visualizer mock */}
             <div className="w-40 h-56 bg-zinc-800 rounded-lg overflow-hidden relative shadow-lg">
                {/* Simulated Image Content based on index */}
                <div className={`absolute inset-0 bg-linear-to-b ${index === 1 ? 'from-emerald-700/60 to-emerald-900/80' : 'from-orange-800/60 to-orange-950/80'} mix-blend-overlay`}></div>
                <div className="absolute inset-0 flex flex-col items-center justify-center opacity-30">
                     <ImageIcon size={32} className="mb-2" />
                     <div className="w-16 h-1.5 bg-white/50 rounded-full"></div>
                </div>
             </div>
          </div>

          {/* Bottom Thumbnails */}
           <div className="flex items-center gap-2 mt-4">
              <button aria-label="Add thumbnail" className="w-12 h-12 rounded-lg border border-dashed border-zinc-600 hover:border-zinc-400 flex items-center justify-center text-zinc-400 transition-colors">
                 <Plus size={16} />
              </button>
              <div className="w-12 h-12 rounded-lg bg-zinc-800 relative border-2 border-blue-600 overflow-hidden cursor-pointer shadow-sm shadow-blue-500/20">
                 <div className={`absolute inset-0 bg-linear-to-b ${index === 1 ? 'from-emerald-700/60 to-emerald-900/80' : 'from-orange-800/60 to-orange-950/80'}`}></div>
                 <div className="absolute -bottom-1.5 -right-1.5 bg-blue-600 rounded-full text-white p-0.5 border-2 border-zinc-900 scale-75">
                    <Check size={12} strokeWidth={4} />
                 </div>
              </div>
           </div>

           {/* Arrow separating panels */}
           <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center z-10 shadow-md hidden xl:flex">
             <ChevronRight size={14} className="text-zinc-400" />
           </div>
        </div>

        {/* Right Column (Video generation) */}
        <div className="p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
             <div className="flex items-center gap-2">
                <Video size={18} className="text-zinc-200" />
                <h3 className="font-bold text-sm text-zinc-100">Generate this shot with image</h3>
             </div>
             <button className="bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/20 text-white text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-2 transition-colors">
               Create Video <div className="flex items-center gap-0.5 border-l border-blue-400 pl-2 ml-1"><Zap size={12} className="fill-white" /> 100</div>
             </button>
          </div>

          <div className="flex-1 flex flex-col">
            <textarea 
               className="w-full h-32 bg-transparent resize-none outline-hidden text-sm text-zinc-200 placeholder:text-zinc-600 p-2"
               placeholder="Describe the motion here..."
               defaultValue={index === 2 ? "a scene ijd" : ""}
            />

            {/* Keyframe UI */}
            <div className="mt-auto border-t border-zinc-800/50 pt-4 flex gap-4 overflow-x-auto hide-scrollbar">
               <div className="flex items-center gap-4">
                  <div className="space-y-1 shrink-0 px-2">
                     <div className="text-[10px] font-black uppercase text-zinc-400 tracking-wider bg-zinc-800 px-2 py-0.5 rounded inline-block">KeyFrame</div>
                     <div className="text-[10px] font-bold text-zinc-600 uppercase mt-1">Reference</div>
                  </div>
                  
                  {/* Start Kframe */}
                  <div className="flex flex-col items-center gap-2 group cursor-pointer">
                     <div className="w-[84px] h-[48px] bg-zinc-800 rounded-md overflow-hidden relative shadow-inner border border-transparent group-hover:border-zinc-600 transition-colors">
                        <div className={`absolute inset-0 bg-linear-to-b ${index === 1 ? 'from-emerald-700/60 to-emerald-900/80' : 'from-orange-800/60 to-orange-950/80'} mix-blend-overlay`}></div>
                     </div>
                     <span className="text-[10px] font-bold text-zinc-300">Start</span>
                  </div>

                  <ChevronRight size={14} className="text-zinc-600 shrink-0 mx-1" />

                  {/* End Kframe */}
                  <div className="flex flex-col items-center gap-2">
                     <div className="w-[84px] h-[48px] border border-dashed border-zinc-700 bg-zinc-900/30 rounded-md flex items-center justify-center text-zinc-500 hover:bg-zinc-800 hover:border-zinc-500 transition-colors cursor-pointer relative group">
                        <Plus size={16} />
                        <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <Link2 size={10} className="text-emerald-500" />
                        </div>
                     </div>
                     <span className="text-[10px] font-bold text-zinc-500">End <span className="opacity-60">(Optional)</span></span>
                  </div>

               </div>
            </div>
          </div>
        </div>

      </div>
    </div>

    {/* Central Add/Delete controls between shots */}
    <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-20">
       <button aria-label="Add shot" className="w-8 h-8 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] border border-[#3f3f46] text-white flex items-center justify-center shadow-lg transition-colors">
         <Plus size={14} />
       </button>
       <button aria-label="Delete shot" className="w-8 h-8 rounded-lg bg-[#27272a] hover:bg-red-500/20 hover:text-red-400 border border-[#3f3f46] hover:border-red-500/30 text-white flex items-center justify-center shadow-lg transition-colors">
         <Trash2 size={14} />
       </button>
    </div>
  </div>
);


export default function StoryboardPage() {
  const [shots] = useState([1, 2]);

  return (
    <div className="flex flex-col h-screen bg-[#09090b] text-zinc-300 font-sans selection:bg-blue-500/30 overflow-hidden">
      
      <TopNav />
      <Toolbar />

      {/* Main Canvas */}
      <main className="flex-1 overflow-y-auto relative bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.05),rgba(255,255,255,0))] hide-scrollbar pb-32">
         {/* subtle background styling */}
         <div className="absolute inset-0 border-x border-dashed border-zinc-800/30 mx-8 pointer-events-none"></div>

         <div className="max-w-[1200px] w-full mx-auto px-4 md:px-8 py-8 h-full flex flex-col relative z-10">
            
            {shots.map((shot) => (
               <ShotCard key={shot} index={shot} />
            ))}

            {/* Add Blank Shot Dropzone */}
            <div className="w-full mt-4 h-28 rounded-xl border border-dashed border-zinc-700 bg-[#18181b]/40 hover:bg-zinc-900/60 hover:border-zinc-500 flex flex-col items-center justify-center cursor-pointer transition-all group shadow-sm">
               <h3 className="text-sm font-bold text-zinc-300 group-hover:text-white transition-colors flex items-center gap-2">
                 <Plus size={16} /> Add Blank Shot
               </h3>
               <p className="text-xs font-medium text-zinc-500 mt-2">
                 Drop image/video here to create a new shot <span className="opacity-60">(bulk upload is supported)</span>
               </p>
            </div>

         </div>
      </main>

      {/* Fixed Bottom Action Footer */}
      <footer className="fixed bottom-0 left-0 right-0 py-4 bg-[#09090b]/90 backdrop-blur-xl border-t border-zinc-800 flex flex-col justify-center z-50">
         <div className="flex gap-4 w-full max-w-[1200px] mx-auto px-8">
            
            {/* Image Gen Block */}
            <div className="flex-1 flex flex-col md:flex-row items-center justify-between gap-4 bg-[#18181b] px-4 py-2.5 rounded-lg border border-zinc-800">
               <div className="flex items-center gap-3 w-full md:w-auto overflow-hidden">
                  <ImageIcon size={16} className="text-zinc-400 shrink-0" />
                  <span className="text-xs font-bold text-zinc-400 shrink-0 hidden sm:block">Image Model</span>
                  <button className="flex items-center justify-between gap-2 px-3 py-1.5 bg-zinc-800 rounded font-bold text-zinc-200 text-xs hover:bg-zinc-700 truncate shadow-sm">
                    Z Imag...
                  </button>
                  <button className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs font-bold text-zinc-400 transition-colors shadow-sm ml-2">
                     Reference
                  </button>
               </div>
               <div className="w-full md:w-auto">
                  <button className="w-full md:w-auto px-5 py-2.5 bg-[#313f70] hover:bg-[#3c4a85] text-[#93a2e3] text-sm font-bold flex items-center justify-center gap-4 rounded-md transition-colors shadow-inner">
                     Generate All Images 
                     <div className="text-blue-300 border-l border-[#4d5e9c] pl-3 flex items-center gap-1 text-xs">
                        <Zap size={14} className="fill-blue-300"/> 5 x 2=10
                     </div>
                  </button>
               </div>
            </div>

            {/* Video Gen Block */}
            <div className="flex-1 flex flex-col md:flex-row items-center justify-between gap-4 bg-[#18181b] px-4 py-2.5 rounded-lg border border-zinc-800">
               <div className="flex items-center gap-3 w-full md:w-auto">
                  <Video size={16} className="text-zinc-400 shrink-0" />
                  <span className="text-xs font-bold text-zinc-400 shrink-0 hidden sm:block">Video Model</span>
                  <button className="flex items-center justify-between gap-6 px-3 py-1.5 bg-zinc-800 rounded font-bold text-zinc-200 text-xs hover:bg-zinc-700 shadow-sm">
                    Kling 2.6
                    <ChevronDown size={14} className="text-zinc-500" />
                  </button>
               </div>
               <div className="w-full md:w-auto">
                  <button className="w-full md:w-auto px-5 py-2.5 bg-[#313f70] hover:bg-[#3c4a85] text-[#93a2e3] text-sm font-bold flex items-center justify-center gap-4 rounded-md transition-colors shadow-inner">
                     Generate All Videos 
                     <div className="text-blue-300 border-l border-[#4d5e9c] pl-3 flex items-center gap-1 text-xs">
                        <Zap size={14} className="fill-blue-300"/> 100 x 2=200
                     </div>
                  </button>
               </div>
            </div>

         </div>
      </footer>

      {/* Global CSS for scrollbars */}
      <style dangerouslySetInnerHTML={{__html: `
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;  /* IE and Edge */
          scrollbar-width: none;  /* Firefox */
        }
      `}} />
    </div>
  );
}
