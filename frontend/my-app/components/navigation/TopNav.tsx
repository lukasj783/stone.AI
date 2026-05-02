"use client";
import React from 'react';
import { Bell, HelpCircle, Plus, Wallet, Search, Menu, ChevronDown, Zap } from 'lucide-react';

export default function TopNav() {
  return (
    <nav className="fixed top-0 left-0 right-0 h-16 bg-black/80 backdrop-blur-md border-b border-zinc-900 flex items-center justify-between px-6 z-50">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center bg-linear-to-tr from-purple-500 to-indigo-600 rounded-lg shadow-lg shadow-purple-500/20">
            <div className="w-4 h-4 bg-white/30 rounded-full blur-[2px]" />
          </div>
          <span className="font-bold text-xl tracking-tighter text-white">GENESIS</span>
          <div className="flex items-center gap-2 px-2 py-0.5 rounded-full bg-zinc-900 text-[10px] font-bold text-zinc-400 border border-zinc-800">
            <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
            PRO
          </div>
        </div>

        {/* Workspace Selector */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition-all cursor-pointer group">
          <div className="w-5 h-5 rounded-md bg-emerald-500/20 text-emerald-500 flex items-center justify-center font-bold text-[10px]">C</div>
          <span className="text-xs font-bold text-zinc-300 group-hover:text-white">Chagarawe&apos;s Workspace</span>
          <ChevronDown size={14} className="text-zinc-500 group-hover:text-zinc-300" />
        </div>
      </div>

      <div className="flex-1 max-w-sm mx-8 hidden lg:flex items-center relative">
        <Search className="absolute left-3 text-zinc-500" size={16} />
        <input 
          type="text" 
          placeholder="Search tools..." 
          className="w-full bg-zinc-900/40 border border-zinc-900 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-zinc-700 transition-colors"
        />
      </div>

      <div className="flex items-center gap-5">
        <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900/40 border border-zinc-800">
          <Wallet size={14} className="text-zinc-500" />
          <span className="text-xs font-semibold text-zinc-300">1,240</span>
          <span className="text-[10px] text-zinc-500 font-medium">Credits</span>
        </div>
        
        <div className="flex items-center gap-1.5 text-zinc-400">
          <button type="button" title="Notifications" className="p-2 hover:bg-zinc-900 hover:text-white rounded-lg transition-colors"><Bell size={18}/></button>
          <button type="button" title="Help" className="p-2 hover:bg-zinc-900 hover:text-white rounded-lg transition-colors"><HelpCircle size={18}/></button>
        </div>

        <div className="h-6 w-px bg-zinc-800 mx-1 hidden sm:block" />

        <div className="flex items-center gap-3">
          {/* Upgrade Button - Highlighted */}
          <button className="hidden sm:flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-full font-bold text-sm transition-all hover:scale-105 active:scale-95 shadow-lg shadow-purple-500/20 border border-purple-400/20">
            <Zap size={14} fill="currentColor" strokeWidth={0} />
            <span>Upgrade</span>
          </button>

          <button className="hidden sm:flex items-center gap-2 bg-white text-black px-4 py-2 rounded-full font-bold text-sm hover:bg-zinc-100 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-white/10">
            <Plus size={16} strokeWidth={3} />
            <span>Create</span>
          </button>
        </div>
        
        {/* Profile with Dropdown */}
        <div className="flex items-center gap-2 pl-2 border-l border-zinc-800 group cursor-pointer">
          <div className="w-8 h-8 rounded-full bg-linear-to-tr from-zinc-800 to-zinc-700 border border-zinc-700 overflow-hidden ring-2 ring-zinc-950 group-hover:ring-zinc-800 transition-all">
            <div className="w-full h-full bg-[url('https://avatar.vercel.sh/genesis?size=100')] bg-cover" />
          </div>
          <ChevronDown size={14} className="text-zinc-600 group-hover:text-zinc-300 transition-colors" />
        </div>
        
        <button type="button" title="Menu" className="lg:hidden p-2 text-zinc-400"><Menu size={20}/></button>
      </div>
    </nav>
  );
}
