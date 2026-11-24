"use client";
import React from 'react';
import { Home, FolderOpen, BookOpen, Video, Image, UserCircle, Music, ChevronLeft, ChevronRight, Settings, Users, Clapperboard } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface SidebarProps {
  collapsed: boolean;
  setCollapsed: (val: boolean) => void;
}

export default function Sidebar({ collapsed, setCollapsed }: SidebarProps) {
  const pathname = usePathname();
  
  const navItems = [
    { label: 'Home', icon: Home, href: '/' },
    { label: 'Assets', icon: FolderOpen, href: '/assets' },
    { label: 'Story', icon: BookOpen, href: '/story', badge: 'Beta' },
    { label: 'Studio', icon: Clapperboard, href: '/studio', badge: 'New' },
    { label: 'Video', icon: Video, href: '/video' },
    { label: 'Image', icon: Image, href: '/image' },
    { label: 'Character', icon: UserCircle, href: '/image/character', badge: 'New' },
    { label: 'Audio', icon: Music, href: '/audio' },
  ];

  const managementItems = [
    { label: 'Community', icon: Users, href: '/community' },
    { label: 'Settings', icon: Settings, href: '/settings' },
  ];

  const renderNavItem = (item: typeof navItems[0]) => {
    const Icon = item.icon;
    const isActive = pathname === item.href;
    
    return (
      <Link key={item.label} href={item.href}
        className={cn(
          "group relative flex items-center rounded-xl transition-all duration-300",
          collapsed ? "flex-col justify-center gap-1 h-16" : "flex-row justify-between gap-3 p-3",
          isActive 
            ? "bg-zinc-900 text-white shadow-xl shadow-white/5 border border-zinc-800" 
            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50"
        )}
      >
        <div className={cn("transition-transform duration-300", isActive && "scale-110")}>
          <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
        </div>
        <span 
          className={cn(
            "font-medium whitespace-nowrap overflow-hidden transition-all duration-300",
            collapsed ? "text-[10px] text-center w-full px-0.5 truncate" : "text-sm",
            !collapsed && "flex-1"
          )}
        >
          {item.label}
        </span>

        {item.badge && !collapsed && (
          <span className="bg-zinc-800 text-[9px] font-black uppercase tracking-tighter text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700 animate-pulse">
            {item.badge}
          </span>
        )}

        {isActive && (
          <div 
            className={cn(
              "absolute bg-purple-500 rounded-full transition-all duration-300",
              collapsed ? "left-1 top-1/2 -translate-y-1/2 w-1 h-8 opacity-0" : "left-0 w-1 h-4"
            )}
          />
        )}
      </Link>
    );
  };

  return (
    <aside 
      className={cn(
        "fixed left-0 top-16 h-[calc(100vh-64px)] bg-black border-r border-zinc-900 transition-all duration-500 ease-in-out z-40 overflow-hidden",
        collapsed ? "w-25" : "w-56"
      )}
    >
      <div className="flex flex-col h-full py-6 px-2 gap-1.5 scrollbar-none overflow-y-auto">
        {/* Navigation Section Header - Hide when collapsed */}
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mb-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-4"
            >
              Navigation
            </motion.div>
          )}
        </AnimatePresence>
        {navItems.map(renderNavItem)}

        <div className="my-6 border-t border-zinc-900 mx-2" />
        
        {/* Management Section Header - Hide when collapsed */}
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-4 mb-2"
            >
              Management
            </motion.div>
          )}
        </AnimatePresence>

        {managementItems.map(renderNavItem)}

        <button 
          onClick={() => setCollapsed(!collapsed)}
          className="mt-auto mb-4 flex items-center justify-center p-3 rounded-xl bg-zinc-900/30 border border-zinc-900 text-zinc-500 hover:text-white hover:bg-zinc-900 transition-all group"
        >
          {collapsed ? (
            <ChevronRight size={20} className="group-hover:translate-x-0.5 transition-transform" />
          ) : (
            <div className="flex items-center gap-3 w-full animate-in fade-in slide-in-from-left-2">
              <ChevronLeft size={20} className="group-hover:-translate-x-0.5 transition-transform" />
              <span className="font-medium">Collapse Sidebar</span>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
}
