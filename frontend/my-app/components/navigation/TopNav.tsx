"use client";
import React, { useMemo, useState } from 'react';
import { Bell, HelpCircle, Plus, Wallet, Search, Menu, ChevronDown, Zap } from 'lucide-react';
import Link from 'next/link';

type Workspace = {
  id: string;
  name: string;
  initial: string;
  accentClass?: string;
};

type TopNavProps = {
  brandName?: string;
  planLabel?: string;
  credits?: number;
  workspaces?: Workspace[];
  activeWorkspaceId?: string;
  onWorkspaceChange?: (workspaceId: string) => void;
  onSearch?: (query: string) => void;
  onCreateClick?: () => void;
  onUpgradeClick?: () => void;
  onNotificationsClick?: () => void;
  onHelpClick?: () => void;
  onMenuClick?: () => void;
};

const defaultWorkspaces: Workspace[] = [
  {
    id: 'changarawe',
    name: "Changarawe's Workspace",
    initial: 'C',
    accentClass: 'bg-emerald-500/20 text-emerald-500',
  },
  {
    id: 'genesis',
    name: 'Genesis Studio',
    initial: 'G',
    accentClass: 'bg-purple-500/20 text-purple-400',
  },
  {
    id: 'personal',
    name: 'Personal Projects',
    initial: 'P',
    accentClass: 'bg-sky-500/20 text-sky-400',
  },
];

export default function TopNav({
  brandName = 'GENESIS',
  planLabel = 'PRO',
  credits = 1240,
  workspaces = defaultWorkspaces,
  activeWorkspaceId,
  onWorkspaceChange,
  onSearch,
  onCreateClick,
  onUpgradeClick,
  onNotificationsClick,
  onHelpClick,
  onMenuClick,
}: TopNavProps) {
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [localWorkspaceId, setLocalWorkspaceId] = useState(activeWorkspaceId ?? workspaces[0]?.id ?? '');
  const [searchValue, setSearchValue] = useState('');

  const selectedWorkspaceId = activeWorkspaceId ?? localWorkspaceId;
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? workspaces[0],
    [selectedWorkspaceId, workspaces],
  );

  const handleWorkspaceSelect = (workspaceId: string) => {
    setLocalWorkspaceId(workspaceId);
    onWorkspaceChange?.(workspaceId);
    setIsWorkspaceOpen(false);
  };

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchValue.trim();
    if (!query) {
      return;
    }

    onSearch?.(query);
  };

  return (
    <nav className="fixed top-0 left-0 right-0 h-16 bg-black/80 backdrop-blur-md border-b border-zinc-900 flex items-center justify-between px-6 z-50">
      <div className="flex items-center gap-6">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 flex items-center justify-center bg-linear-to-tr from-purple-500 to-indigo-600 rounded-lg shadow-lg shadow-purple-500/20">
            <div className="w-4 h-4 bg-white/30 rounded-full blur-[2px]" />
          </div>
          <span className="font-bold text-xl tracking-tighter text-white group-hover:text-zinc-200 transition-colors">{brandName}</span>
          <div className="flex items-center gap-2 px-2 py-0.5 rounded-full bg-zinc-900 text-[10px] font-bold text-zinc-400 border border-zinc-800">
            <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
            {planLabel}
          </div>
        </Link>

        {/* Workspace Selector */}
        <div className="relative hidden md:block">
          <button
            type="button"
            onClick={() => setIsWorkspaceOpen((open) => !open)}
            aria-expanded={isWorkspaceOpen}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition-all group"
          >
            <div className={`w-5 h-5 rounded-md flex items-center justify-center font-bold text-[10px] ${activeWorkspace?.accentClass ?? 'bg-emerald-500/20 text-emerald-500'}`}>
              {activeWorkspace?.initial ?? 'W'}
            </div>
            <span className="text-xs font-bold text-zinc-300 group-hover:text-white">
              {activeWorkspace?.name ?? 'Workspace'}
            </span>
            <ChevronDown
              size={14}
              className={`text-zinc-500 group-hover:text-zinc-300 transition-transform ${isWorkspaceOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {isWorkspaceOpen && (
            <div className="absolute left-0 top-10 w-60 rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/40 overflow-hidden">
              {workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => handleWorkspaceSelect(workspace.id)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-300 hover:bg-zinc-900 hover:text-white transition-colors"
                >
                  <span className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${workspace.accentClass ?? 'bg-zinc-800 text-zinc-300'}`}>
                    {workspace.initial}
                  </span>
                  <span className="flex-1 truncate">{workspace.name}</span>
                  {workspace.id === activeWorkspace?.id && (
                    <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handleSearchSubmit} className="flex-1 max-w-sm mx-8 hidden lg:flex items-center relative">
        <Search className="absolute left-3 text-zinc-500" size={16} />
        <input 
          type="text" 
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          placeholder="Search tools..." 
          className="w-full bg-zinc-900/40 border border-zinc-900 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-zinc-700 transition-colors"
        />
      </form>

      <div className="flex items-center gap-5">
        <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900/40 border border-zinc-800">
          <Wallet size={14} className="text-zinc-500" />
          <span className="text-xs font-semibold text-zinc-300">{credits.toLocaleString()}</span>
          <span className="text-[10px] text-zinc-500 font-medium">Credits</span>
        </div>
        
        <div className="flex items-center gap-1.5 text-zinc-400">
          <button type="button" title="Notifications" onClick={onNotificationsClick} className="p-2 hover:bg-zinc-900 hover:text-white rounded-lg transition-colors"><Bell size={18}/></button>
          <button type="button" title="Help" onClick={onHelpClick} className="p-2 hover:bg-zinc-900 hover:text-white rounded-lg transition-colors"><HelpCircle size={18}/></button>
        </div>

        <div className="h-6 w-px bg-zinc-800 mx-1 hidden sm:block" />

        <div className="flex items-center gap-3">
          {/* Upgrade Button - Highlighted */}
          <button type="button" onClick={onUpgradeClick} className="hidden sm:flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-full font-bold text-sm transition-all hover:scale-105 active:scale-95 shadow-lg shadow-purple-500/20 border border-purple-400/20">
            <Zap size={14} fill="currentColor" strokeWidth={0} />
            <span>Upgrade</span>
          </button>

          <button type="button" onClick={onCreateClick} className="hidden sm:flex items-center gap-2 bg-white text-black px-4 py-2 rounded-full font-bold text-sm hover:bg-zinc-100 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-white/10">
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
        
        <button type="button" title="Menu" onClick={onMenuClick} className="lg:hidden p-2 text-zinc-400"><Menu size={20}/></button>
      </div>
    </nav>
  );
}
